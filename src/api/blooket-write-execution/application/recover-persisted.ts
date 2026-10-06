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
//   - Local recovery decisions for durable write checkpoints and attempt
//     journals.
// - Must-Not:
//   - Execute remote writes or infer success from an attempting journal.
// - Allows:
//   - Inputs: Trusted checkpoint/journal paths and one exact write plan.
//   - Outputs: Ready, recovered, reconciliation-required, or stable failures.
//   - Side effects: May advance confirmed checkpoints and clear valid journals.
// - Split-When:
//   - Remote reconciliation gains provider-specific verification logic.
// - Merge-When:
//   - Attempt journals are integrated into a single durable execution record.
// - Summary:
//   - Auto-recovers only outcomes already durably marked confirmed.
// - Description:
//   - Ambiguous attempting journals always require explicit reconciliation.
// - Usage:
//   - Run before any new remote write attempt for the same plan.
// - Defaults:
//   - Missing journals permit normal execution from the loaded checkpoint.
//
import { tryAcquireFileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import {
  clearWriteAttempt,
  loadWriteAttemptFile,
  writeAttemptExecutionLockPath,
  type WriteAttemptFileMutationResult,
  type WriteAttemptRecord,
} from
  "../../../platforms/write-attempt-files/adapter-outbound/file.ts";
import {
  loadWriteCheckpointFile,
  saveWriteCheckpointFile,
  type WriteCheckpointFileLoadResult,
  type WriteCheckpointFileSaveResult,
} from
  "../../../platforms/write-checkpoint-files/adapter-outbound/file.ts";
import {
  advanceBlooketWriteCheckpoint,
  type BlooketWriteCheckpoint,
} from "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";

export type RecoverPersistedBlooketWriteResult =
  | {
      readonly ok: true;
      readonly kind: "ready";
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: true;
      readonly kind: "recovered";
      readonly operationId: string;
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: true;
      readonly kind: "reconciliation-required";
      readonly reason:
        | "ambiguous-attempt"
        | "inconsistent-attempt-state";
      readonly attempt: WriteAttemptRecord;
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: false;
      readonly stage: "checkpoint-load";
      readonly cause: Exclude<
        WriteCheckpointFileLoadResult,
        { readonly ok: true }
      >;
    }
  | {
      readonly ok: false;
      readonly stage: "attempt-load";
      readonly cause: Exclude<
        Awaited<ReturnType<typeof loadWriteAttemptFile>>,
        { readonly ok: true }
      >;
    }
  | {
      readonly ok: false;
      readonly stage: "checkpoint-recovery-save";
      readonly cause: Exclude<
        WriteCheckpointFileSaveResult,
        { readonly ok: true }
      >;
    }
  | {
      readonly ok: false;
      readonly stage: "attempt-cleanup";
      readonly cause: Exclude<
        WriteAttemptFileMutationResult,
        { readonly ok: true }
      >;
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: false;
      readonly stage: "execution-lock";
      readonly code:
        | "write-execution-locked"
        | "write-execution-lock-unsafe"
        | "write-execution-lock-failed";
    }
  | {
      readonly ok: false;
      readonly stage: "execution-lock-release";
      readonly code: "write-execution-lock-release-failed";
    };

export async function recoverPersistedBlooketWrite(
  checkpointPath: string,
  attemptPath: string,
  plan: BlooketWritePlan,
): Promise<RecoverPersistedBlooketWriteResult> {
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

  let result: RecoverPersistedBlooketWriteResult;
  let threw = false;
  let unexpected: unknown;
  try {
    result = await recoverPersistedBlooketWriteUnderLock(
      checkpointPath,
      attemptPath,
      plan,
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
export async function recoverPersistedBlooketWriteUnderLock(
  checkpointPath: string,
  attemptPath: string,
  plan: BlooketWritePlan,
): Promise<RecoverPersistedBlooketWriteResult> {
  const checkpointLoaded = await loadWriteCheckpointFile(
    checkpointPath,
    plan,
  );
  if (!checkpointLoaded.ok) {
    return {
      ok: false,
      stage: "checkpoint-load",
      cause: checkpointLoaded,
    };
  }
  const checkpoint = checkpointLoaded.checkpoint;

  const attemptLoaded = await loadWriteAttemptFile(
    attemptPath,
    plan,
  );
  if (!attemptLoaded.ok) {
    return {
      ok: false,
      stage: "attempt-load",
      cause: attemptLoaded,
    };
  }
  if (attemptLoaded.kind === "missing") {
    return {
      ok: true,
      kind: "ready",
      checkpoint,
    };
  }

  const attempt = attemptLoaded.record;
  if (attempt.phase === "attempting") {
    return {
      ok: true,
      kind: "reconciliation-required",
      reason: checkpoint.nextOperationIndex === attempt.operationIndex
        ? "ambiguous-attempt"
        : "inconsistent-attempt-state",
      attempt,
      checkpoint,
    };
  }

  if (checkpoint.nextOperationIndex === attempt.operationIndex) {
    const advanced = advanceBlooketWriteCheckpoint(
      plan,
      checkpoint,
      attempt.operationId,
      attempt.receipt,
    );
    if (!advanced.ok) {
      return {
        ok: true,
        kind: "reconciliation-required",
        reason: "inconsistent-attempt-state",
        attempt,
        checkpoint,
      };
    }
    const saved = await saveWriteCheckpointFile(
      checkpointPath,
      plan,
      advanced.value,
    );
    if (!saved.ok) {
      return {
        ok: false,
        stage: "checkpoint-recovery-save",
        cause: saved,
      };
    }
    return await clearConfirmedAttempt(
      attemptPath,
      plan,
      attempt,
      advanced.value,
      true,
    );
  }

  if (
    checkpoint.nextOperationIndex
    === attempt.operationIndex + 1
  ) {
    if (!checkpointMatchesConfirmedAttempt(plan, checkpoint, attempt)) {
      return {
        ok: true,
        kind: "reconciliation-required",
        reason: "inconsistent-attempt-state",
        attempt,
        checkpoint,
      };
    }
    return await clearConfirmedAttempt(
      attemptPath,
      plan,
      attempt,
      checkpoint,
      false,
    );
  }

  return {
    ok: true,
    kind: "reconciliation-required",
    reason: "inconsistent-attempt-state",
    attempt,
    checkpoint,
  };
}

function checkpointMatchesConfirmedAttempt(
  plan: BlooketWritePlan,
  checkpoint: BlooketWriteCheckpoint,
  attempt: WriteAttemptRecord,
): boolean {
  const operation = plan.operations[attempt.operationIndex];
  if (operation === undefined) {
    return false;
  }
  if (operation.kind === "question") {
    return attempt.receipt === null
      && checkpoint.remoteSetId !== null;
  }
  return attempt.receipt !== null
    && checkpoint.remoteSetId === attempt.receipt.remoteSetId;
}

async function clearConfirmedAttempt(
  attemptPath: string,
  plan: BlooketWritePlan,
  attempt: WriteAttemptRecord,
  checkpoint: BlooketWriteCheckpoint,
  recovered: boolean,
): Promise<RecoverPersistedBlooketWriteResult> {
  const cleared = await clearWriteAttempt(attemptPath, plan);
  if (!cleared.ok) {
    return {
      ok: false,
      stage: "attempt-cleanup",
      cause: cleared,
      checkpoint,
    };
  }
  return recovered
    ? {
        ok: true,
        kind: "recovered",
        operationId: attempt.operationId,
        checkpoint,
      }
    : {
        ok: true,
        kind: "ready",
        checkpoint,
      };
}
