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
import {
  lstat,
  readFile,
} from "node:fs/promises";

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

  const parsed = parseCheckpointJson(read.value);
  if (!parsed.ok) {
    return parsed;
  }
  const decoded = decodeBlooketWriteCheckpoint(parsed.value, plan);
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
  if (existing.kind === "text") {
    const parsed = parseCheckpointJson(existing.value);
    if (!parsed.ok) {
      return parsed;
    }
    const decoded = decodeBlooketWriteCheckpoint(parsed.value, plan);
    if (!decoded.ok) {
      return {
        ok: false,
        kind: "invalid",
        issues: decoded.issues,
      };
    }
    previousIndex = decoded.value.nextOperationIndex;
    if (checkpoint.nextOperationIndex === previousIndex) {
      return { ok: true };
    }
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

async function readOwnedTextFile(path: string): Promise<
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unsafe" }
  | { readonly kind: "unreadable" }
> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return { kind: "unsafe" };
    }
    return {
      kind: "text",
      value: await readFile(path, "utf8"),
    };
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return { kind: "missing" };
    }
    return { kind: "unreadable" };
  }
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
