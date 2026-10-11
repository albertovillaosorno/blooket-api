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
//   - Durable atomic reservation of plan-bound Blooket mutation task budgets.
// - Must-Not:
//   - Execute writes, choose product paths, sleep, or infer provider limits.
// - Allows:
//   - Inputs: Trusted file path, plan identity, policy, and current timestamp.
//   - Outputs: Persisted next budget state or a stable refusal/failure.
//   - Side effects: Locks and atomically replaces one small local state file.
// - Split-When:
//   - Multiple provider accounts require independently keyed durable budgets.
// - Merge-When:
//   - Mutation budgets become part of another durable execution primitive.
// - Summary:
//   - Persists attempt admission before a remote mutation can begin.
// - Description:
//   - Exact plan binding prevents accidental cross-plan budget reuse.
// - Usage:
//   - Reserve after pacing admission and before opening the attempt journal.
// - Defaults:
//   - Symlinks, oversized files, malformed state, and lock contention fail.
//
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import {
  admitBlooketMutationTaskStart,
  decodeBlooketMutationTaskBudgetState,
  type BlooketMutationTaskBudgetPolicy,
  type BlooketMutationTaskBudgetState,
} from
  "../../../projects/blooket-write-plans/domain/mutation-budget.ts";
import { writeAtomicFile } from
  "../../atomic-files/adapter-outbound/atomic-file.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";

const FILE_VERSION = 1 as const;
const MAX_FILE_BYTES = 4_096;

interface StoredMutationBudget {
  readonly schemaVersion: typeof FILE_VERSION;
  readonly planId: string;
  readonly state: BlooketMutationTaskBudgetState;
}

export type MutationBudgetFileReserveResult =
  | {
      readonly ok: true;
      readonly state: BlooketMutationTaskBudgetState;
    }
  | {
      readonly ok: false;
      readonly kind: "budget";
      readonly code:
        | "mutation-task-start-budget-exhausted"
        | "mutation-task-duration-exhausted"
        | "mutation-task-budget-invalid";
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly code:
        | "mutation-budget-file-invalid"
        | "mutation-budget-plan-mismatch";
    }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code:
        | "mutation-budget-file-locked"
        | "mutation-budget-file-unsafe"
        | "mutation-budget-file-unreadable"
        | "mutation-budget-write-failed";
    };

export type MutationBudgetFileFailure = Exclude<
  MutationBudgetFileReserveResult,
  { readonly ok: true }
>;

export type MutationBudgetFileLoadResult =
  | {
      readonly ok: true;
      readonly state: BlooketMutationTaskBudgetState | null;
    }
  | Exclude<MutationBudgetFileReserveResult, { readonly ok: true }>;

export async function reserveMutationBudgetStart(
  path: string,
  planId: string,
  policy: BlooketMutationTaskBudgetPolicy,
  nowMs: number,
): Promise<MutationBudgetFileReserveResult> {
  const acquired = await tryAcquireFileLock(path + ".lock");
  if (!acquired.ok) {
    return {
      ok: false,
      kind: "io",
      code: acquired.reason === "busy"
        ? "mutation-budget-file-locked"
        : acquired.reason === "unsafe"
          ? "mutation-budget-file-unsafe"
          : "mutation-budget-write-failed",
    };
  }

  let result: MutationBudgetFileReserveResult;
  try {
    result = await reserveUnderLock(path, planId, policy, nowMs);
  } catch {
    result = {
      ok: false,
      kind: "io",
      code: "mutation-budget-write-failed",
    };
  }

  try {
    await acquired.lock.release();
  } catch {
    return {
      ok: false,
      kind: "io",
      code: "mutation-budget-write-failed",
    };
  }
  return result;
}

export async function loadMutationBudgetFile(
  path: string,
  planId: string,
): Promise<MutationBudgetFileLoadResult> {
  const read = await readOwnedBudgetFile(path);
  if (read.kind === "missing") return { ok: true, state: null };
  if (read.kind === "unsafe")
    return ioFailure("mutation-budget-file-unsafe");
  if (read.kind === "unreadable")
    return ioFailure("mutation-budget-file-unreadable");
  return decodeStoredBudget(read.value, planId);
}

async function reserveUnderLock(
  path: string,
  planId: string,
  policy: BlooketMutationTaskBudgetPolicy,
  nowMs: number,
): Promise<MutationBudgetFileReserveResult> {
  const read = await readOwnedBudgetFile(path);
  if (read.kind === "unsafe")
    return ioFailure("mutation-budget-file-unsafe");
  if (read.kind === "unreadable")
    return ioFailure("mutation-budget-file-unreadable");

  let current: BlooketMutationTaskBudgetState | null = null;
  if (read.kind === "text") {
    const decoded = decodeStoredBudget(read.value, planId);
    if (!decoded.ok) return decoded;
    current = decoded.state;
  }

  const admitted = admitBlooketMutationTaskStart(current, policy, nowMs);
  if (!admitted.ok) {
    return {
      ok: false,
      kind: "budget",
      code: admitted.code,
    };
  }

  const stored: StoredMutationBudget = {
    schemaVersion: FILE_VERSION,
    planId,
    state: admitted.state,
  };
  try {
    await writeAtomicFile(path, JSON.stringify(stored, null, 2) + "\n");
  } catch {
    return ioFailure("mutation-budget-write-failed");
  }
  return { ok: true, state: admitted.state };
}

function decodeStoredBudget(
  source: string,
  planId: string,
): MutationBudgetFileLoadResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(source) as unknown;
  } catch {
    return invalidFailure("mutation-budget-file-invalid");
  }
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  )
    return invalidFailure("mutation-budget-file-invalid");

  const value = candidate as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "planId" ||
    keys[1] !== "schemaVersion" ||
    keys[2] !== "state" ||
    value["schemaVersion"] !== FILE_VERSION ||
    typeof value["planId"] !== "string"
  )
    return invalidFailure("mutation-budget-file-invalid");
  if (value["planId"] !== planId)
    return invalidFailure("mutation-budget-plan-mismatch");

  const state = decodeBlooketMutationTaskBudgetState(value["state"]);
  if (state === undefined || state === null)
    return invalidFailure("mutation-budget-file-invalid");
  return { ok: true, state };
}

async function readOwnedBudgetFile(path: string): Promise<
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
    if (error instanceof Error && "code" in error) {
      if (error.code === "ENOENT") return { kind: "missing" };
      if (error.code === "ELOOP") return { kind: "unsafe" };
    }
    return { kind: "unreadable" };
  }
  let result:
    | { readonly kind: "text"; readonly value: string }
    | { readonly kind: "unsafe" }
    | { readonly kind: "unreadable" } = { kind: "unreadable" };
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) {
      result = { kind: "unsafe" };
    } else {
      const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
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
      result = complete
        ? { kind: "text", value: bytes.subarray(0, size).toString("utf8") }
        : { kind: "unsafe" };
    }
  } catch { /* An unreadable descriptor cannot admit a new reservation. */ }
  try { await handle.close(); }
  catch { return { kind: "unreadable" }; }
  return result;
}

function invalidFailure(
  code: "mutation-budget-file-invalid" | "mutation-budget-plan-mismatch",
): Extract<MutationBudgetFileReserveResult, { readonly kind: "invalid" }> {
  return { ok: false, kind: "invalid", code };
}

function ioFailure(
  code:
    | "mutation-budget-file-unsafe"
    | "mutation-budget-file-unreadable"
    | "mutation-budget-write-failed",
): Extract<MutationBudgetFileReserveResult, { readonly kind: "io" }> {
  return { ok: false, kind: "io", code };
}
