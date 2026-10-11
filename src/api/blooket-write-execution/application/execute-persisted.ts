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
  decodeBlooketWriteVerificationBaseline,
  sameBlooketWriteVerificationBaseline,
  verificationBaselineKindForOperation,
  type BlooketWriteVerificationBaseline,
} from
  "../../../projects/blooket-write-plans/domain/verification-baseline.ts";
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import { inspectBlooketSession } from
  "../../blooket-session/application/inspect-session.ts";
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
import {
  admitBlooketPreparedMedia,
  blooketWriteOperationMediaIds,
} from "./admit-prepared-media.ts";
import type { BlooketPreparedMediaReadPort } from
  "../contract/prepared-media.ts";

import { decodePreparedMediaIdentities, type PreparedMediaIdentities } from
  "../../../projects/blooket-write-plans/domain/prepared-media-identities.ts";

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
  readonly requireVerificationBaseline?: boolean;
  readonly pacer?: BlooketMutationPacer;
  readonly signal?: AbortSignal;
  readonly media?: BlooketPreparedMediaReadPort;
  readonly expectedMedia?: PreparedMediaIdentities;
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
      readonly stage: "prepared-media";
      readonly code:
        | "blooket-media-not-prepared"
        | "blooket-media-stale"
        | "blooket-media-invalid"
        | "blooket-media-unavailable";
      readonly mediaId: string;
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
        | "blooket-write-baseline-invalid"
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
  // Freeze expected recovery facts before lock acquisition or session I/O.
  // Later caller mutation cannot redefine which prepared bytes were intended.
  const expectedMedia = options.expectedMedia === undefined ? undefined
    : decodePreparedMediaIdentities(options.expectedMedia);
  if (options.expectedMedia !== undefined && expectedMedia === undefined)
    return { ok: false, stage: "prepared-media",
      code: "blooket-media-invalid", mediaId: "snapshot" };
  const ownedOptions: ExecutePersistedBlooketWriteOptions = {
    ...options, ...(expectedMedia ? { expectedMedia } : {}),
  };
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
      ownedOptions,
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

type RevalidatedWriteSession =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly result: ExecutePersistedBlooketWriteResult;
    };

async function revalidateWriteSession(
  browser: BlooketBrowserSessionPort,
  checkpoint: BlooketWriteCheckpoint,
): Promise<RevalidatedWriteSession> {
  const inspected = await inspectBlooketSession(browser);
  if (!inspected.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        stage: "session",
        code: inspected.code,
      },
    };
  }

  switch (inspected.action) {
    case "continue":
      return { ok: true };
    case "wait":
      if (inspected.state !== "rate-limited") {
        return sessionRevalidationFailure();
      }
      return {
        ok: false,
        result: {
          ok: true,
          kind: "wait",
          state: inspected.state,
          checkpoint,
        },
      };
    case "human-action-required":
      if (
        inspected.state !== "organization-prompt"
        && inspected.state !== "security-challenge"
        && inspected.state !== "unexpected-page"
      ) {
        return sessionRevalidationFailure();
      }
      return {
        ok: false,
        result: {
          ok: true,
          kind: "human-action-required",
          state: inspected.state,
          checkpoint,
        },
      };
    case "authenticate":
      if (
        inspected.state !== "signed-out"
        && inspected.state !== "expired-session"
      ) {
        return sessionRevalidationFailure();
      }
      return {
        ok: false,
        result: {
          ok: true,
          kind: "session-required",
          state: inspected.state,
          checkpoint,
        },
      };
  }
}

function sessionRevalidationFailure(): RevalidatedWriteSession {
  return {
    ok: false,
    result: {
      ok: false,
      stage: "session",
      code: "blooket-browser-failed",
    },
  };
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
  required = false,
): Promise<CapturedVerificationBaseline> {
  const missing = (): CapturedVerificationBaseline => required ? {
    ok: false, result: {
      ok: false, stage: "verification-baseline",
      code: "blooket-write-baseline-not-captured",
    },
  } : { ok: true, value: null };
  if (verifier === undefined) {
    return missing();
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
  const invalid = (): CapturedVerificationBaseline => ({
    ok: false,
    result: { ok: false, stage: "verification-baseline",
      code: "blooket-write-baseline-invalid" },
  });
  const exactKeys = (value: unknown, names: string): boolean => {
    try {
      return !!value && typeof value === "object" &&
        !Array.isArray(value) && Reflect.ownKeys(value).sort().join() === names;
    } catch { return false; }
  };
  if (!captured || (captured.ok !== true && captured.ok !== false))
    return invalid();
  if (captured.ok === true) {
    if (!exactKeys(captured, "baseline,ok")) return invalid();
    if (captured.baseline === null) {
      return missing();
    }
    const decoded = decodeBlooketWriteVerificationBaseline(
      captured.baseline,
      verificationBaselineKindForOperation(operation.kind),
    );
    if (!decoded.ok) {
      return {
        ok: false,
        result: {
          ok: false,
          stage: "verification-baseline",
          code: "blooket-write-baseline-invalid",
        },
      };
    }
    return { ok: true, value: decoded.value };
  }
  if (captured.kind === "browser") {
    if (!exactKeys(captured, "code,kind,ok") ||
        (captured.code !== "blooket-browser-failed" &&
         captured.code !== "blooket-browser-unavailable" &&
         captured.code !== "blooket-browser-incompatible")) return invalid();
    return {
      ok: false,
      result: {
        ok: false,
        stage: "verification-baseline",
        code: captured.code,
      },
    };
  }
  if (captured.kind !== "navigation" ||
      !exactKeys(captured, "kind,ok,state") ||
      !["signed-out", "expired-session", "organization-prompt",
        "rate-limited", "security-challenge", "unexpected-page"]
        .some(state => state === captured.state)) return invalid();

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
    options.requireVerificationBaseline,
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
  if (options.signal?.aborted) {
    lease?.release();
    return {
      ok: false,
      stage: "mutation-pacing",
      code: "mutation-pacing-cancelled",
    };
  }

  const currentSession = await revalidateWriteSession(
    browser,
    prepared.checkpoint,
  );
  if (!currentSession.ok) {
    lease?.release();
    return currentSession.result;
  }

  const requiredMediaIds = blooketWriteOperationMediaIds(
    prepared.operation,
  );
  if (requiredMediaIds.length > 0 && options.media === undefined) {
    lease?.release();
    return {
      ok: false,
      stage: "prepared-media",
      code: "blooket-media-unavailable",
      mediaId: requiredMediaIds[0]!,
    };
  }
  const admittedMedia = options.media === undefined
    ? { ok: true as const, media: [] }
    : await admitBlooketPreparedMedia(
      prepared.operation, options.media, options.expectedMedia,
    );
  if (!admittedMedia.ok) {
    lease?.release();
    return {
      ok: false,
      stage: "prepared-media",
      code: admittedMedia.code,
      mediaId: admittedMedia.mediaId,
    };
  }

  const currentBaseline = await captureVerificationBaseline(
    verifier,
    prepared.operation,
    prepared.checkpoint,
    options.requireVerificationBaseline,
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
  if (options.signal?.aborted) {
    lease?.release();
    return {
      ok: false,
      stage: "mutation-pacing",
      code: "mutation-pacing-cancelled",
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
  // Durable reservation is asynchronous; cancellation can arrive after the
  // previous check. A reserved start remains conservatively consumed, but an
  // aborted task must not open a journal or invoke the remote mutation.
  if (options.signal?.aborted) {
    lease?.release();
    return {
      ok: false,
      stage: "mutation-pacing",
      code: "mutation-pacing-cancelled",
    };
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
      // Journal persistence is asynchronous. Keep that recovery record when
      // cancellation arrives here, but do not start a remote write afterward.
      if (options.signal?.aborted)
        return {
          ok: false, stage: "mutation-pacing",
          code: "mutation-pacing-cancelled",
        };
      attempted = await attemptBlooketWrite(
        writes,
        prepared.operation,
        prepared.checkpoint.remoteSetId,
        admittedMedia.media,
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
