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
//   - Session-gated provider verification of one ambiguous persisted write.
// - Must-Not:
//   - Retry writes, infer provider state, or bypass human-stop navigation.
// - Allows:
//   - Inputs: Persistence paths, exact plan, session/security, verifier ports.
//   - Outputs: Reconciled progress, explicit unresolved state, or stable
//     failure.
//   - Side effects: Session reuse/login, provider observation, durable
//     recovery.
// - Split-When:
//   - Provider verification gains independently scheduled retry policy.
// - Merge-When:
//   - Ambiguous attempts are impossible or verified inside remote execution.
// - Summary:
//   - Verifies and reconciles one persisted attempt under one execution lock.
// - Description:
//   - Provider evidence is collected only after durable ambiguity is confirmed.
// - Usage:
//   - Invoke for reconciliation-required attempts before any new remote write.
// - Defaults:
//   - Inconclusive evidence preserves the journal and checkpoint unchanged.
//
import {
  blooketNavigationDecision,
} from "../../../ir/blooket-navigation/domain/navigation-state.ts";
import { tryAcquireFileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import {
  writeAttemptExecutionLockPath,
  type WriteAttemptRecord,
} from
  "../../../platforms/write-attempt-files/adapter-outbound/file.ts";
import { decodeBlooketWriteReceipt } from
  "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketWriteCheckpoint } from
  "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import {
  ensureBlooketSession,
  type EnsureBlooketSessionResult,
} from "../../blooket-session/application/ensure-session.ts";
import type {
  BlooketBrowserFailureCode,
  BlooketBrowserSessionPort,
} from "../../blooket-session/contract/browser-session.ts";
import type {
  BlooketWriteVerificationPort,
  BlooketWriteVerificationResult,
} from "../contract/write-verification.ts";
import type { BlooketWritePersistencePaths } from "./execute-persisted.ts";
import {
  reconcilePersistedBlooketWriteUnderLock,
  type ReconcilePersistedBlooketWriteResult,
} from "./reconcile-persisted.ts";
import {
  recoverPersistedBlooketWriteUnderLock,
} from "./recover-persisted.ts";

type SessionFailure = Extract<
  EnsureBlooketSessionResult,
  { readonly ok: false }
>;

type ReconciliationState = {
  readonly attempt: WriteAttemptRecord;
  readonly checkpoint: BlooketWriteCheckpoint;
};

export type VerifyPersistedBlooketWriteResult =
  | ReconcilePersistedBlooketWriteResult
  | {
      readonly ok: true;
      readonly kind: "reconciliation-required";
      readonly reason: "verification-inconclusive";
      readonly attempt: WriteAttemptRecord;
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: true;
      readonly kind: "wait";
      readonly state: "rate-limited";
      readonly attempt: WriteAttemptRecord;
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: true;
      readonly kind: "human-action-required";
      readonly state:
        | "organization-prompt"
        | "security-challenge"
        | "unexpected-page";
      readonly attempt: WriteAttemptRecord;
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: true;
      readonly kind: "session-required";
      readonly state: "signed-out" | "expired-session";
      readonly attempt: WriteAttemptRecord;
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: false;
      readonly stage: "session";
      readonly code: SessionFailure["code"];
    }
  | {
      readonly ok: false;
      readonly stage: "verification";
      readonly code: BlooketBrowserFailureCode;
    };

export async function verifyPersistedBlooketWrite(
  paths: BlooketWritePersistencePaths,
  plan: BlooketWritePlan,
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  verifier: BlooketWriteVerificationPort,
): Promise<VerifyPersistedBlooketWriteResult> {
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

  let result: VerifyPersistedBlooketWriteResult;
  let threw = false;
  let unexpected: unknown;
  try {
    result = await verifyPersistedBlooketWriteUnderLock(
      paths,
      plan,
      browser,
      secrets,
      verifier,
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

async function verifyPersistedBlooketWriteUnderLock(
  paths: BlooketWritePersistencePaths,
  plan: BlooketWritePlan,
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  verifier: BlooketWriteVerificationPort,
): Promise<VerifyPersistedBlooketWriteResult> {
  const recovery = await recoverPersistedBlooketWriteUnderLock(
    paths.checkpoint,
    paths.attempt,
    plan,
  );
  if (
    !recovery.ok
    || recovery.kind !== "reconciliation-required"
    || recovery.reason !== "ambiguous-attempt"
  ) {
    return recovery;
  }

  const operation = plan.operations[recovery.attempt.operationIndex];
  if (
    operation === undefined
    || operation.operationId !== recovery.attempt.operationId
  ) {
    return {
      ok: true,
      kind: "reconciliation-required",
      reason: "inconsistent-attempt-state",
      attempt: recovery.attempt,
      checkpoint: recovery.checkpoint,
    };
  }

  const session = await ensureBlooketSession(browser, secrets);
  if (!session.ok) {
    return {
      ok: false,
      stage: "session",
      code: session.code,
    };
  }
  if (session.kind !== "ready") {
    return withReconciliationState(session, recovery);
  }

  const verified = await safeVerify(
    verifier,
    operation,
    recovery.checkpoint.remoteSetId,
    recovery.attempt.baseline,
  );
  if (!verified.ok) {
    if (verified.kind === "browser") {
      return {
        ok: false,
        stage: "verification",
        code: verified.code,
      };
    }
    return mapNavigationStop(verified.state, recovery);
  }
  if (verified.outcome !== "confirmed") {
    // A generic read-only verifier cannot prove that a delayed provider
    // mutation will never commit. Do not clear its journal automatically.
    return {
      ok: true,
      kind: "reconciliation-required",
      reason: "verification-inconclusive",
      attempt: recovery.attempt,
      checkpoint: recovery.checkpoint,
    };
  }

  return await reconcilePersistedBlooketWriteUnderLock(
    paths.checkpoint,
    paths.attempt,
    plan,
    { operationId: operation.operationId, outcome: "confirmed",
      receipt: verified.receipt },
  );
}

function withReconciliationState(
  session: Exclude<
    EnsureBlooketSessionResult,
    { readonly ok: true; readonly kind: "ready" }
  >,
  state: ReconciliationState,
): VerifyPersistedBlooketWriteResult {
  if (!session.ok) {
    return {
      ok: false,
      stage: "session",
      code: session.code,
    };
  }
  return {
    ...session,
    attempt: state.attempt,
    checkpoint: state.checkpoint,
  };
}

function mapNavigationStop(
  observed: Extract<
    BlooketWriteVerificationResult,
    { readonly ok: false; readonly kind: "navigation" }
  >["state"],
  state: ReconciliationState,
): VerifyPersistedBlooketWriteResult {
  const decision = blooketNavigationDecision({
    kind: observed,
  });
  switch (decision.action) {
    case "wait":
      return {
        ok: true,
        kind: "wait",
        state: decision.state,
        attempt: state.attempt,
        checkpoint: state.checkpoint,
      };
    case "human-action-required":
      if (decision.state === "human-action-required") {
        return {
          ok: true,
          kind: "human-action-required",
          state: "unexpected-page",
          attempt: state.attempt,
          checkpoint: state.checkpoint,
        };
      }
      return {
        ok: true,
        kind: "human-action-required",
        state: decision.state,
        attempt: state.attempt,
        checkpoint: state.checkpoint,
      };
    case "authenticate":
      return {
        ok: true,
        kind: "session-required",
        state: decision.state,
        attempt: state.attempt,
        checkpoint: state.checkpoint,
      };
    case "continue":
    case "observe":
      return {
        ok: true,
        kind: "reconciliation-required",
        reason: "verification-inconclusive",
        attempt: state.attempt,
        checkpoint: state.checkpoint,
      };
  }
}

async function safeVerify(
  verifier: BlooketWriteVerificationPort,
  operation: Parameters<BlooketWriteVerificationPort["verify"]>[0],
  remoteSetId: string | null,
  baseline: Parameters<BlooketWriteVerificationPort["verify"]>[2],
): Promise<BlooketWriteVerificationResult> {
  const failed = (): BlooketWriteVerificationResult => ({
    ok: false, kind: "browser", code: "blooket-browser-failed",
  });
  const exact = (value: unknown, keys: string): boolean =>
    !!value && typeof value === "object" && !Array.isArray(value) &&
    Reflect.ownKeys(value).sort().join() === keys;
  try {
    const raw: unknown = await verifier.verify(
      operation, { remoteSetId }, baseline,
    );
    if (!raw || typeof raw !== "object" || !("ok" in raw))
      return failed();
    if (raw.ok === true && "outcome" in raw) {
      if (exact(raw, "ok,outcome") &&
          (raw.outcome === "inconclusive" ||
           raw.outcome === "not-confirmed"))
        return { ok: true, outcome: raw.outcome };
      if (raw.outcome === "confirmed" &&
          exact(raw, "ok,outcome,receipt") && "receipt" in raw) {
        if (operation.kind === "question" && raw.receipt === null)
          return { ok: true, outcome: "confirmed", receipt: null };
        if (operation.kind === "set") {
          const receipt = decodeBlooketWriteReceipt(raw.receipt);
          if (receipt.ok)
            return { ok: true, outcome: "confirmed",
              receipt: receipt.value };
        }
      }
      return failed();
    }
    if (raw.ok === false && "kind" in raw) {
      if (raw.kind === "browser" && exact(raw, "code,kind,ok") &&
          "code" in raw &&
          (raw.code === "blooket-browser-failed" ||
           raw.code === "blooket-browser-unavailable" ||
           raw.code === "blooket-browser-incompatible"))
        return { ok: false, kind: "browser", code: raw.code };
      if (raw.kind === "navigation" && exact(raw, "kind,ok,state") &&
          "state" in raw &&
          ["signed-out", "expired-session", "organization-prompt",
           "rate-limited", "security-challenge", "unexpected-page"]
            .some(state => state === raw.state))
        return { ok: false, kind: "navigation",
          state: raw.state as "signed-out" | "expired-session" |
            "organization-prompt" | "rate-limited" |
            "security-challenge" | "unexpected-page" };
    }
    return failed();
  } catch {
    return failed();
  }
}
