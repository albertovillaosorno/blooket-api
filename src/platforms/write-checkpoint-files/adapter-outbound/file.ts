// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - MIT
// Confidential:
//   - false
// License-File:
//   - LICENSE-MIT
//
// Boundary-Contract:
// - Owns:
//   - Durable one-file persistence for resumable Blooket write checkpoints.
// - Must-Not:
//   - Execute remote writes, choose product paths, or skip checkpoint steps.
// - Allows:
//   - Inputs: Trusted file paths, exact plans, and checkpoint candidates.
//   - Outputs: Initial/persisted checkpoints or stable validation/I/O failures.
//   - Side effects: Reads and atomically replaces one local checkpoint file.
// - Split-When:
//   - Parallel execution requires non-sequential persistence semantics.
// - Merge-When:
//   - Resumable write execution no longer persists local progress.
// - Summary:
//   - Persists monotonic plan-bound progress without skipped operations.
// - Description:
//   - Missing files imply index zero; saves may hold or advance one step.
// - Usage:
//   - Save an advanced checkpoint before requesting another remote step.
// - Defaults:
//   - Successful replacements retain one previous checkpoint backup.
//
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  decodeBlooketWriteCheckpoint,
  initialBlooketWriteCheckpoint,
  type BlooketWriteCheckpoint,
} from "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import { writeAtomicFile } from
  "../../atomic-files/adapter-outbound/atomic-file.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";

export type WriteCheckpointFileLoadResult =
  | {
      readonly ok: true;
      readonly checkpoint: BlooketWriteCheckpoint;
      readonly source: "initial" | "file";
    }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code:
        | "checkpoint-file-unsafe"
        | "checkpoint-file-unreadable";
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly ValidationIssue[];
    };

export type WriteCheckpointFileSaveResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code:
        | "checkpoint-file-locked"
        | "checkpoint-file-unsafe"
        | "checkpoint-write-failed";
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly ValidationIssue[];
    };

export async function loadWriteCheckpointFile(
  path: string,
  plan: BlooketWritePlan,
): Promise<WriteCheckpointFileLoadResult> {
  const read = await readOwnedTextFile(path);
  if (read.kind === "missing") {
    return {
      ok: true,
      checkpoint: initialBlooketWriteCheckpoint(plan),
      source: "initial",
    };
  }
  if (read.kind === "unsafe") {
    return loadIoFailure("checkpoint-file-unsafe");
  }
  if (read.kind === "unreadable") {
    return loadIoFailure("checkpoint-file-unreadable");
  }

  const decoded = decodeStoredCheckpoint(read.value, plan);
  if (!decoded.ok) {
    return {
      ok: false,
      kind: "invalid",
      issues: decoded.issues,
    };
  }
  return {
    ok: true,
    checkpoint: decoded.value,
    source: "file",
  };
}

export async function saveWriteCheckpointFile(
  path: string,
  plan: BlooketWritePlan,
  checkpointCandidate: unknown,
): Promise<WriteCheckpointFileSaveResult> {
  const decoded = decodeBlooketWriteCheckpoint(
    checkpointCandidate,
    plan,
  );
  if (!decoded.ok) {
    return {
      ok: false,
      kind: "invalid",
      issues: decoded.issues,
    };
  }

  const acquired = await tryAcquireFileLock(path + ".lock");
  if (!acquired.ok) {
    if (acquired.reason === "busy") {
      return saveIoFailure("checkpoint-file-locked");
    }
    return saveIoFailure(
      acquired.reason === "unsafe"
        ? "checkpoint-file-unsafe"
        : "checkpoint-write-failed",
    );
  }

  let result: WriteCheckpointFileSaveResult;
  try {
    result = await saveWriteCheckpointFileLocked(
      path,
      plan,
      decoded.value,
    );
  } catch {
    result = saveIoFailure("checkpoint-write-failed");
  }

  try {
    await acquired.lock.release();
  } catch {
    return saveIoFailure("checkpoint-write-failed");
  }
  return result;
}

async function saveWriteCheckpointFileLocked(
  path: string,
  plan: BlooketWritePlan,
  checkpoint: BlooketWriteCheckpoint,
): Promise<WriteCheckpointFileSaveResult> {
  const existing = await readOwnedTextFile(path);
  if (existing.kind === "unsafe") {
    return saveIoFailure("checkpoint-file-unsafe");
  }
  if (existing.kind === "unreadable") {
    return saveIoFailure("checkpoint-write-failed");
  }

  let previousIndex = 0;
  let previousRemoteSetId: string | null = null;
  if (existing.kind === "text") {
    const decoded = decodeStoredCheckpoint(existing.value, plan);
    if (!decoded.ok) {
      return {
        ok: false,
        kind: "invalid",
        issues: decoded.issues,
      };
    }
    previousIndex = decoded.value.nextOperationIndex;
    previousRemoteSetId = decoded.value.remoteSetId;
  }

  if (checkpoint.nextOperationIndex < previousIndex) {
    return progressFailure(
      "$.nextOperationIndex",
      "checkpoint-regression",
      "Checkpoint progress cannot move backward.",
    );
  }
  if (checkpoint.nextOperationIndex > previousIndex + 1) {
    return progressFailure(
      "$.nextOperationIndex",
      "checkpoint-skip",
      "Checkpoint progress may advance only one operation.",
    );
  }

  // A saved Create Set identity must survive both idempotent saves and
  // subsequent question progress; a different remote set needs reconciliation.
  if (existing.kind === "text" && previousIndex > 0 &&
      previousRemoteSetId !== checkpoint.remoteSetId)
    return progressFailure("$.remoteSetId",
      "checkpoint-remote-identity-mismatch",
      "Checkpoint may not switch a previously confirmed remote set.");
  if (existing.kind === "text" &&
      checkpoint.nextOperationIndex === previousIndex)
    return { ok: true };

  const contents = JSON.stringify(checkpoint, null, 2) + "\n";
  try {
    await writeAtomicFile(
      path,
      contents,
      existing.kind === "text"
        ? { backupPath: path + ".bak" }
        : {},
    );
    return { ok: true };
  } catch {
    return saveIoFailure("checkpoint-write-failed");
  }
}

function decodeStoredCheckpoint(
  source: string, plan: BlooketWritePlan,
):
  | { readonly ok: true; readonly value: BlooketWriteCheckpoint }
  | { readonly ok: false; readonly kind: "invalid";
      readonly issues: readonly ValidationIssue[] } {
  const parsed = parseCheckpointJson(source);
  if (!parsed.ok) return parsed;
  const decoded = decodeBlooketWriteCheckpoint(parsed.value, plan);
  if (!decoded.ok) return { ok: false, kind: "invalid",
    issues: decoded.issues };
  const raw = parsed.value as Record<string, unknown>;
  // Current checkpoints are always atomically written in one exact order.
  // Historical v1 files may use compact or indented JSON with/without LF.
  // Never turn duplicate indexes or set IDs into trusted progress.
  const compact = JSON.stringify(parsed.value);
  const pretty = JSON.stringify(parsed.value, null, 2);
  const canonical = JSON.stringify(decoded.value, null, 2) + "\n";
  const valid = raw["schemaVersion"] === 2
    ? source === canonical
    : [compact, compact + "\n", pretty, pretty + "\n"]
      .includes(source);
  if (!valid) return progressFailure("$", "checkpoint-noncanonical",
    "Checkpoint bytes differ from the admitted record.");
  return { ok: true, value: decoded.value };
}

function parseCheckpointJson(
  source: string,
):
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly ValidationIssue[];
    } {
  try {
    return {
      ok: true,
      value: JSON.parse(source) as unknown,
    };
  } catch {
    return progressFailure(
      "$",
      "invalid-json",
      "Checkpoint file contains invalid JSON.",
    );
  }
}

function progressFailure(
  path: string,
  code: string,
  message: string,
): Extract<
  WriteCheckpointFileSaveResult,
  { readonly kind: "invalid" }
> {
  return {
    ok: false,
    kind: "invalid",
    issues: [{ path, code, message }],
  };
}

const MAX_CHECKPOINT_FILE_BYTES = 65_536;

async function readOwnedTextFile(path: string): Promise<
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unsafe" }
  | { readonly kind: "unreadable" }
> {
  // Open and inspect the same descriptor: lstat followed by readFile could
  // follow a symlink swapped in between the two filesystem operations.
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isMissingPathError(error)) return { kind: "missing" };
    if (error instanceof Error && "code" in error &&
        error.code === "ELOOP") return { kind: "unsafe" };
    return { kind: "unreadable" };
  }
  let result:
    | { readonly kind: "text"; readonly value: string }
    | { readonly kind: "unsafe" }
    | { readonly kind: "unreadable" } = { kind: "unreadable" };
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1 ||
        metadata.size > MAX_CHECKPOINT_FILE_BYTES) {
      result = { kind: "unsafe" };
    } else {
      const bytes = Buffer.alloc(MAX_CHECKPOINT_FILE_BYTES + 1);
      let size = 0;
      let complete = false;
      while (size < bytes.length) {
        const part = await handle.read(bytes, size, bytes.length - size, null);
        if (part.bytesRead === 0) {
          complete = true;
          break;
        }
        size += part.bytesRead;
      }
      const after = await handle.stat();
      const unchanged = complete && size === metadata.size &&
        after.isFile() && after.nlink === 1 &&
        after.size === metadata.size &&
        after.dev === metadata.dev && after.ino === metadata.ino &&
        after.mtimeMs === metadata.mtimeMs &&
        after.ctimeMs === metadata.ctimeMs;
      result = unchanged
        ? { kind: "text", value: bytes.subarray(0, size).toString("utf8") }
        : { kind: "unsafe" };
    }
  } catch { /* An unreadable descriptor cannot admit a new reservation. */ }
  try { await handle.close(); }
  catch { return { kind: "unreadable" }; }
  return result;
}

function loadIoFailure(
  code: "checkpoint-file-unsafe" | "checkpoint-file-unreadable",
): WriteCheckpointFileLoadResult {
  return { ok: false, kind: "io", code };
}

function saveIoFailure(
  code:
    | "checkpoint-file-locked"
    | "checkpoint-file-unsafe"
    | "checkpoint-write-failed",
): WriteCheckpointFileSaveResult {
  return { ok: false, kind: "io", code };
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}
