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
//   - Journaled one-step execution for a resumable Blooket write plan.
// - Must-Not:
//   - Loop, auto-retry, infer ambiguous success, or choose persistence paths.
// - Allows:
//   - Inputs: Trusted checkpoint/journal paths, plan, and execution
//     dependencies.
//   - Outputs: Durable advancement, explicit recovery, or stable failures.
//   - Side effects: Local recovery plus at most one journaled remote write.
// - Split-When:
//   - Pacing or provider reconciliation becomes independently versioned.
// - Merge-When:
//   - Remote and local progress become one transactional provider primitive.
// - Summary:
//   - Journals the exact mutation window before persisting confirmed progress.
// - Description:
//   - Recovery precedes browser work; ambiguous attempts block future writes.
// - Usage:
//   - Supply trusted sibling or otherwise owned checkpoint and journal paths.
// - Defaults:
//   - No retry or pacing delay is guessed.
//
import { tryAcquireFileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import {
  beginWriteAttempt,
  clearWriteAttempt,
  confirmWriteAttempt,
  writeAttemptExecutionLockPath,
  type WriteAttemptFileMutationResult,
  type WriteAttemptRecord,
} from
  "../../../platforms/write-attempt-files/adapter-outbound/file.ts";
import {
  saveWriteCheckpointFile,
  type WriteCheckpointFileSaveResult,
} from
  "../../../platforms/write-checkpoint-files/adapter-outbound/file.ts";
import type { BlooketWriteCheckpoint } from
  "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import type { BlooketBrowserSessionPort } from
  "../../blooket-session/contract/browser-session.ts";
import {
  attemptBlooketWrite,
  completeBlooketWriteAttempt,
  prepareNextBlooketWrite,
  type ExecuteNextBlooketWriteResult,
  type PrepareNextBlooketWriteResult,
} from "./execute-next.ts";
import {
  recoverPersistedBlooketWriteUnderLock,
  type RecoverPersistedBlooketWriteResult,
} from "./recover-persisted.ts";
import type { BlooketWriteExecutionPort } from
  "../contract/write-execution.ts";

type PrepareTerminal = Exclude<
  PrepareNextBlooketWriteResult,
  {
    readonly ok: true;
    readonly kind: "ready";
  }
>;

type AdvancedWrite = Extract<
  ExecuteNextBlooketWriteResult,
  {
    readonly ok: true;
    readonly kind: "advanced";
  }
>;

type RecoveryTerminal = Extract<
  RecoverPersistedBlooketWriteResult,
  {
    readonly ok: true;
    readonly kind: "recovered" | "reconciliation-required";
  }
>;

type RecoveryFailure = Extract<
  RecoverPersistedBlooketWriteResult,
  { readonly ok: false }
>;

export interface BlooketWritePersistencePaths {
  readonly checkpoint: string;
  readonly attempt: string;
}

export type ExecutePersistedBlooketWriteResult =
  | PrepareTerminal
  | AdvancedWrite
  | RecoveryTerminal
  | RecoveryFailure
  | {
      readonly ok: true;
      readonly kind: "reconciliation-required";
      readonly reason: "write-not-confirmed";
      readonly attempt: WriteAttemptRecord;
      readonly checkpoint: BlooketWriteCheckpoint;
      readonly outcome: ExecuteNextBlooketWriteResult;
    }
  | {
      readonly ok: false;
      readonly stage: "attempt-begin";
      readonly code: "write-attempt-not-started";
      readonly cause: Exclude<
        WriteAttemptFileMutationResult,
        { readonly ok: true }
      >;
    }
  | {
      readonly ok: false;
      readonly stage: "attempt-confirm-after-confirmed-write";
      readonly code: "confirmed-write-not-journaled";
      readonly operationId: string;
      readonly cause: Exclude<
        WriteAttemptFileMutationResult,
        { readonly ok: true }
      >;
    }
  | {
      readonly ok: false;
      readonly stage: "checkpoint-after-confirmed-write";
      readonly code: "confirmed-write-checkpoint-invariant";
      readonly operationId: string;
    }
  | {
      readonly ok: false;
      readonly stage: "checkpoint-save-after-confirmed-write";
      readonly code: "confirmed-write-not-persisted";
      readonly operationId: string;
      readonly checkpoint: BlooketWriteCheckpoint;
      readonly cause: Exclude<
        WriteCheckpointFileSaveResult,
        { readonly ok: true }
      >;
    }
  | {
      readonly ok: false;
      readonly stage: "attempt-cleanup-after-checkpoint";
      readonly code: "confirmed-write-journal-not-cleared";
      readonly operationId: string;
      readonly checkpoint: BlooketWriteCheckpoint;
      readonly cause: Exclude<
        WriteAttemptFileMutationResult,
        { readonly ok: true }
      >;
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

export async function executePersistedBlooketWrite(
  paths: BlooketWritePersistencePaths,
  plan: BlooketWritePlan,
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  writes: BlooketWriteExecutionPort,
): Promise<ExecutePersistedBlooketWriteResult> {
  const acquired = await tryAcquireFileLock(
    writeAttemptExecutionLockPath(paths.attempt),
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

  let result: ExecutePersistedBlooketWriteResult;
  let threw = false;
  let unexpected: unknown;
  try {
    result = await executePersistedBlooketWriteLocked(
      paths,
      plan,
      browser,
      secrets,
      writes,
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

async function executePersistedBlooketWriteLocked(
  paths: BlooketWritePersistencePaths,
  plan: BlooketWritePlan,
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  writes: BlooketWriteExecutionPort,
): Promise<ExecutePersistedBlooketWriteResult> {
  const recovery = await recoverPersistedBlooketWriteUnderLock(
    paths.checkpoint,
    paths.attempt,
    plan,
  );
  if (!recovery.ok || recovery.kind !== "ready") {
    return recovery;
  }

  const prepared = await prepareNextBlooketWrite(
    plan,
    recovery.checkpoint,
    browser,
    secrets,
  );
  if (!prepared.ok || prepared.kind !== "ready") {
    return prepared;
  }

  const begun = await beginWriteAttempt(
    paths.attempt,
    plan,
    prepared.checkpoint.nextOperationIndex,
  );
  if (!begun.ok) {
    return {
      ok: false,
      stage: "attempt-begin",
      code: "write-attempt-not-started",
      cause: begun,
    };
  }
  if (begun.record === undefined) {
    return {
      ok: false,
      stage: "attempt-begin",
      code: "write-attempt-not-started",
      cause: {
        ok: false,
        kind: "io",
        code: "write-attempt-write-failed",
      },
    };
  }

  const attempted = await attemptBlooketWrite(
    writes,
    prepared.operation,
    prepared.checkpoint.remoteSetId,
  );
  const completed = completeBlooketWriteAttempt(
    plan,
    prepared.checkpoint,
    prepared.operation,
    attempted,
  );

  if (!attempted.ok) {
    return {
      ok: true,
      kind: "reconciliation-required",
      reason: "write-not-confirmed",
      attempt: begun.record,
      checkpoint: prepared.checkpoint,
      outcome: completed,
    };
  }

  const confirmed = await confirmWriteAttempt(
    paths.attempt,
    plan,
    prepared.operation.operationId,
    attempted.receipt,
  );
  if (!confirmed.ok) {
    return {
      ok: false,
      stage: "attempt-confirm-after-confirmed-write",
      code: "confirmed-write-not-journaled",
      operationId: prepared.operation.operationId,
      cause: confirmed,
    };
  }

  if (!completed.ok || completed.kind !== "advanced") {
    return {
      ok: false,
      stage: "checkpoint-after-confirmed-write",
      code: "confirmed-write-checkpoint-invariant",
      operationId: prepared.operation.operationId,
    };
  }

  const saved = await saveWriteCheckpointFile(
    paths.checkpoint,
    plan,
    completed.checkpoint,
  );
  if (!saved.ok) {
    return {
      ok: false,
      stage: "checkpoint-save-after-confirmed-write",
      code: "confirmed-write-not-persisted",
      operationId: completed.operationId,
      checkpoint: completed.checkpoint,
      cause: saved,
    };
  }

  const cleared = await clearWriteAttempt(paths.attempt, plan);
  if (!cleared.ok) {
    return {
      ok: false,
      stage: "attempt-cleanup-after-checkpoint",
      code: "confirmed-write-journal-not-cleared",
      operationId: completed.operationId,
      checkpoint: completed.checkpoint,
      cause: cleared,
    };
  }

  return completed;
}
