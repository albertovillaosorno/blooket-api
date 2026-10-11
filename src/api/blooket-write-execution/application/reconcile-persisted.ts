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
//   - Explicit resolution of one ambiguous persisted Blooket write attempt.
// - Must-Not:
//   - Infer remote outcomes, execute writes, or resolve inconsistent progress.
// - Allows:
//   - Inputs: Exact plan, persistence paths, and externally verified
//     resolution.
//   - Outputs: Ready/recovered progress or stable reconciliation failures.
//   - Side effects: May confirm or clear one journal and advance its
//     checkpoint.
// - Split-When:
//   - Provider-specific verification requires independently versioned evidence.
// - Merge-When:
//   - Write-attempt recovery owns external reconciliation directly.
// - Summary:
//   - Applies verified ambiguous-attempt outcomes without blind retries.
// - Description:
//   - Confirmation reuses durable receipt recovery; non-confirmation clears
//     only the exact still-pending attempt.
// - Usage:
//   - Call only after browser or human evidence resolves an ambiguous attempt.
// - Defaults:
//   - Mismatched or inconsistent evidence remains untouched.
//
import { tryAcquireFileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import {
  clearWriteAttempt,
  confirmWriteAttempt,
  writeAttemptExecutionLockPath,
  type WriteAttemptFileMutationResult,
} from
  "../../../platforms/write-attempt-files/adapter-outbound/file.ts";
import type {
  BlooketWriteCheckpoint,
  BlooketWriteReceipt,
} from "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import {
  recoverPersistedBlooketWriteUnderLock,
  type RecoverPersistedBlooketWriteResult,
} from "./recover-persisted.ts";

export type BlooketWriteReconciliationResolution =
  | {
      readonly operationId: string;
      readonly outcome: "confirmed";
      readonly receipt: BlooketWriteReceipt | null;
    }
  | {
      readonly operationId: string;
      readonly outcome: "not-confirmed";
    };

export type ReconcilePersistedBlooketWriteResult =
  | RecoverPersistedBlooketWriteResult
  | {
      readonly ok: false;
      readonly stage: "reconciliation";
      readonly code:
        | "reconciliation-not-required"
        | "reconciliation-state-inconsistent"
        | "reconciliation-operation-mismatch";
    }
  | {
      readonly ok: false;
      readonly stage: "reconciliation-confirm";
      readonly cause: Exclude<
        WriteAttemptFileMutationResult,
        { readonly ok: true }
      >;
    };

export async function reconcilePersistedBlooketWrite(
  checkpointPath: string,
  attemptPath: string,
  plan: BlooketWritePlan,
  resolution: BlooketWriteReconciliationResolution,
): Promise<ReconcilePersistedBlooketWriteResult> {
  const acquired = await tryAcquireFileLock(
    writeAttemptExecutionLockPath(attemptPath),
  );
  if (!acquired.ok) {
    return {
      ok: false,
      stage: "execution-lock",
      code: acquired.reason === "busy"
        ? "write-execution-locked"
        : acquired.reason === "unsafe"
          ? "write-execution-lock-unsafe"
          : "write-execution-lock-failed",
    };
  }

  let result: ReconcilePersistedBlooketWriteResult;
  let threw = false;
  let unexpected: unknown;
  try {
    result = await reconcilePersistedBlooketWriteUnderLock(
      checkpointPath,
      attemptPath,
      plan,
      resolution,
    );
  } catch (error: unknown) {
    threw = true;
    unexpected = error;
    result = {
      ok: false,
      stage: "execution-lock",
      code: "write-execution-lock-failed",
    };
  }

  try {
    await acquired.lock.release();
  } catch {
    return {
      ok: false,
      stage: "execution-lock-release",
      code: "write-execution-lock-release-failed",
    };
  }
  if (threw) {
    throw unexpected;
  }
  return result;
}

// Caller must hold the write-attempt execution lock.
export async function reconcilePersistedBlooketWriteUnderLock(
  checkpointPath: string,
  attemptPath: string,
  plan: BlooketWritePlan,
  resolution: BlooketWriteReconciliationResolution,
): Promise<ReconcilePersistedBlooketWriteResult> {
  const recovery = await recoverPersistedBlooketWriteUnderLock(
    checkpointPath,
    attemptPath,
    plan,
  );
  if (!recovery.ok) {
    return recovery;
  }
  if (recovery.kind !== "reconciliation-required") {
    return {
      ok: false,
      stage: "reconciliation",
      code: "reconciliation-not-required",
    };
  }
  if (recovery.reason !== "ambiguous-attempt") {
    return {
      ok: false,
      stage: "reconciliation",
      code: "reconciliation-state-inconsistent",
    };
  }
  // The public reconciliation API is callable without an IR decoder.
  // A malformed negative result must never erase a pending attempt.
  const validResolution = !!resolution &&
    typeof resolution === "object" && !Array.isArray(resolution) &&
    typeof resolution.operationId === "string" &&
    (resolution.outcome === "not-confirmed"
      ? Reflect.ownKeys(resolution).sort().join() ===
        "operationId,outcome"
      : resolution.outcome === "confirmed" &&
        Reflect.ownKeys(resolution).sort().join() ===
          "operationId,outcome,receipt");
  if (!validResolution) {
    return {
      ok: false,
      stage: "reconciliation",
      code: "reconciliation-state-inconsistent",
    };
  }
  if (recovery.attempt.operationId !== resolution.operationId) {
    return {
      ok: false,
      stage: "reconciliation",
      code: "reconciliation-operation-mismatch",
    };
  }

  if (resolution.outcome === "not-confirmed") {
    const cleared = await clearWriteAttempt(attemptPath, plan);
    if (!cleared.ok) {
      return cleanupFailure(cleared, recovery.checkpoint);
    }
    return {
      ok: true,
      kind: "ready",
      checkpoint: recovery.checkpoint,
    };
  }

  const confirmed = await confirmWriteAttempt(
    attemptPath,
    plan,
    resolution.operationId,
    resolution.receipt,
  );
  if (!confirmed.ok) {
    return {
      ok: false,
      stage: "reconciliation-confirm",
      cause: confirmed,
    };
  }
  return await recoverPersistedBlooketWriteUnderLock(
    checkpointPath,
    attemptPath,
    plan,
  );
}

function cleanupFailure(
  cause: Exclude<WriteAttemptFileMutationResult, { readonly ok: true }>,
  checkpoint: BlooketWriteCheckpoint,
): ReconcilePersistedBlooketWriteResult {
  return {
    ok: false,
    stage: "attempt-cleanup",
    cause,
    checkpoint,
  };
}
