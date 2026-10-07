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
//   - Side effects: Optional bounded pacing, recovery, and one remote write.
// - Split-When:
//   - Pacing or provider reconciliation becomes independently versioned.
// - Merge-When:
//   - Remote and local progress become one transactional provider primitive.
// - Summary:
//   - Journals the exact mutation window before persisting confirmed progress.
// - Description:
//   - Recovery precedes browser work; pre-write state is revalidated after
//     pacing and ambiguous attempts block future writes.
// - Usage:
//   - Supply owned persistence paths and one shared pacer when configured.
// - Defaults:
//   - Pacing is explicit; retries and ambiguous success are never guessed.
//
import {
  blooketNavigationDecision,
} from "../../../ir/blooket-navigation/domain/navigation-state.ts";
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
import {
  reserveMutationBudgetStart,
  type MutationBudgetFileFailure,
} from
  "../../../platforms/mutation-budget-files/adapter-outbound/file.ts";
import type { BlooketWriteCheckpoint } from
  "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketMutationTaskBudgetPolicy } from
  "../../../projects/blooket-write-plans/domain/mutation-budget.ts";
import {
  sameBlooketWriteVerificationBaseline,
  type BlooketWriteVerificationBaseline,
} from
  "../../../projects/blooket-write-plans/domain/verification-baseline.ts";
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import type {
  BlooketBrowserFailureCode,
  BlooketBrowserSessionPort,
} from "../../blooket-session/contract/browser-session.ts";
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
import type {
  BlooketWriteVerificationBaselineResult,
  BlooketWriteVerificationPort,
} from "../contract/write-verification.ts";
import type { BlooketMutationPacer } from "./mutation-pacing.ts";

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

export interface ExecutePersistedBlooketWriteOptions {
  readonly pacer?: BlooketMutationPacer;
  readonly signal?: AbortSignal;
  readonly budget?: {
    readonly path: string;
    readonly policy: BlooketMutationTaskBudgetPolicy;
    readonly now?: () => number;
  };
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
      readonly stage: "mutation-pacing";
      readonly code:
        | "mutation-pacing-cancelled"
        | "mutation-pacing-failed";
    }
  | {
      readonly ok: false;
      readonly stage: "remote-precondition";
      readonly code: "blooket-remote-state-changed";
      readonly operationId: string;
    }
  | {
      readonly ok: false;
      readonly stage: "mutation-budget";
      readonly code:
        | MutationBudgetFileFailure["code"]
        | "mutation-budget-admission-failed";
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
      readonly stage: "verification-baseline";
      readonly code:
        | BlooketBrowserFailureCode
        | "blooket-write-baseline-not-captured";
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
  verifier?: BlooketWriteVerificationPort,
  options: ExecutePersistedBlooketWriteOptions = {},
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
      verifier,
      options,
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

type CapturedVerificationBaseline =
  | {
      readonly ok: true;
      readonly value: BlooketWriteVerificationBaseline | null;
    }
  | {
      readonly ok: false;
      readonly result: ExecutePersistedBlooketWriteResult;
    };

async function captureVerificationBaseline(
  verifier: BlooketWriteVerificationPort | undefined,
  operation: Parameters<BlooketWriteVerificationPort["captureBaseline"]>[0],
  checkpoint: BlooketWriteCheckpoint,
): Promise<CapturedVerificationBaseline> {
  if (verifier === undefined) {
    return { ok: true, value: null };
  }

  let captured: BlooketWriteVerificationBaselineResult;
  try {
    captured = await verifier.captureBaseline(
      operation,
      { remoteSetId: checkpoint.remoteSetId },
    );
  } catch {
    return {
      ok: false,
      result: {
        ok: false,
        stage: "verification-baseline",
        code: "blooket-browser-failed",
      },
    };
  }
  if (captured.ok) {
    return { ok: true, value: captured.baseline };
  }
  if (captured.kind === "browser") {
    return {
      ok: false,
      result: {
        ok: false,
        stage: "verification-baseline",
        code: captured.code,
      },
    };
  }

  const decision = blooketNavigationDecision({
    kind: captured.state,
  });
  switch (decision.action) {
    case "wait":
      return {
        ok: false,
        result: {
          ok: true,
          kind: "wait",
          state: decision.state,
          checkpoint,
        },
      };
    case "human-action-required":
      return {
        ok: false,
        result: {
          ok: true,
          kind: "human-action-required",
          state: decision.state === "human-action-required"
            ? "unexpected-page"
            : decision.state,
          checkpoint,
        },
      };
    case "authenticate":
      return {
        ok: false,
        result: {
          ok: true,
          kind: "session-required",
          state: decision.state,
          checkpoint,
        },
      };
    case "continue":
    case "observe":
      return {
        ok: false,
        result: {
          ok: false,
          stage: "verification-baseline",
          code: "blooket-write-baseline-not-captured",
        },
      };
  }
}

async function executePersistedBlooketWriteLocked(
  paths: BlooketWritePersistencePaths,
  plan: BlooketWritePlan,
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  writes: BlooketWriteExecutionPort,
  verifier: BlooketWriteVerificationPort | undefined,
  options: ExecutePersistedBlooketWriteOptions,
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

  const baseline = await captureVerificationBaseline(
    verifier,
    prepared.operation,
    prepared.checkpoint,
  );
  if (!baseline.ok) {
    return baseline.result;
  }

  let pacing: Awaited<ReturnType<BlooketMutationPacer["acquire"]>> | undefined;
  try {
    pacing = options.pacer === undefined
      ? undefined
      : await options.pacer.acquire(options.signal);
  } catch {
    return {
      ok: false,
      stage: "mutation-pacing",
      code: "mutation-pacing-failed",
    };
  }
  if (pacing !== undefined && !pacing.ok) {
    return {
      ok: false,
      stage: "mutation-pacing",
      code: pacing.code,
    };
  }
  const lease = pacing?.ok === true ? pacing.lease : undefined;
  if (lease !== undefined && options.signal?.aborted) {
    lease.release();
    return {
      ok: false,
      stage: "mutation-pacing",
      code: "mutation-pacing-cancelled",
    };
  }

  const currentBaseline = await captureVerificationBaseline(
    verifier,
    prepared.operation,
    prepared.checkpoint,
  );
  if (!currentBaseline.ok) {
    lease?.release();
    return currentBaseline.result;
  }
  if (
    !sameBlooketWriteVerificationBaseline(
      baseline.value,
      currentBaseline.value,
    )
  ) {
    lease?.release();
    return {
      ok: false,
      stage: "remote-precondition",
      code: "blooket-remote-state-changed",
      operationId: prepared.operation.operationId,
    };
  }

  if (options.budget !== undefined) {
    let reserved: Awaited<ReturnType<typeof reserveMutationBudgetStart>>;
    try {
      reserved = await reserveMutationBudgetStart(
        options.budget.path,
        plan.planId,
        options.budget.policy,
        options.budget.now?.() ?? Date.now(),
      );
    } catch {
      lease?.release();
      return {
        ok: false,
        stage: "mutation-budget",
        code: "mutation-budget-admission-failed",
      };
    }
    if (!reserved.ok) {
      lease?.release();
      return {
        ok: false,
        stage: "mutation-budget",
        code: reserved.code,
      };
    }
  }

  let begun: Awaited<ReturnType<typeof beginWriteAttempt>>;
  let attempted: Awaited<ReturnType<typeof attemptBlooketWrite>> | undefined;
  try {
    begun = await beginWriteAttempt(
      paths.attempt,
      plan,
      prepared.checkpoint.nextOperationIndex,
      baseline.value,
    );
    if (begun.ok && begun.record !== undefined) {
      attempted = await attemptBlooketWrite(
        writes,
        prepared.operation,
        prepared.checkpoint.remoteSetId,
      );
    }
  } finally {
    lease?.release();
  }

  if (!begun.ok) {
    return {
      ok: false,
      stage: "attempt-begin",
      code: "write-attempt-not-started",
      cause: begun,
    };
  }
  if (begun.record === undefined || attempted === undefined) {
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
