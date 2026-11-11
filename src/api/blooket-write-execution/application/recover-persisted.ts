// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - MIT
// Confidential:
//   - false
// License-File:
//   - LICENSE
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
import type { BlooketWriteCheckpoint } from
  "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import { decideWriteRecovery } from
  "../../../projects/blooket-write-plans/domain/recovery-automaton.ts";
import { executeDurableRecovery } from
  "../../../ir/protocol-kernel/domain/durable-recovery.ts";
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
  const decision = decideWriteRecovery(plan, checkpoint, attempt);
  if (decision.action === "reconcile") {
    return {
      ok: true,
      kind: "reconciliation-required",
      reason: decision.reason,
      attempt,
      checkpoint,
    };
  }
  // The generic durable protocol runtime owns persistence-before-cleanup.
  // The caller already holds the exact write-attempt execution lock.
  const instruction = decision.action === "persist-confirmed"
    ? { kind: "commit-and-finalize" as const,
        checkpoint, next: decision.checkpoint }
    : decision.action === "clear-confirmed"
      ? { kind: "finalize" as const, checkpoint }
      : { kind: "hold" as const, checkpoint,
          reason: "inconsistent-attempt-state" as const };
  const settled = await executeDurableRecovery(instruction, {
    persist: async (_before, next) => {
      const result = await saveWriteCheckpointFile(checkpointPath, plan, next);
      return result.ok ? { ok: true as const }
        : { ok: false as const, cause: result };
    },
    finalize: async () => {
      const result = await clearWriteAttempt(attemptPath, plan);
      return result.ok ? { ok: true as const }
        : { ok: false as const, cause: result };
    },
  });
  if (!settled.ok) {
    return settled.stage === "persist"
      ? { ok: false, stage: "checkpoint-recovery-save", cause: settled.cause }
      : { ok: false, stage: "attempt-cleanup",
          cause: settled.cause, checkpoint: settled.checkpoint };
  }
  if (settled.kind === "recovered") {
    return { ok: true, kind: "recovered", operationId: attempt.operationId,
      checkpoint: settled.checkpoint };
  }
  if (settled.kind === "finalized") {
    return { ok: true, kind: "ready", checkpoint: settled.checkpoint };
  }
  return { ok: true, kind: "reconciliation-required",
    reason: "inconsistent-attempt-state", attempt, checkpoint };
}
