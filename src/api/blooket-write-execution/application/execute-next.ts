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
//   - One-step resumable execution of a canonical Blooket write plan.
// - Must-Not:
//   - Loop, sleep, auto-retry, persist progress, or guess remote success.
// - Allows:
//   - Inputs: Plan, untrusted checkpoint, session/security ports, write port.
//   - Outputs: Advanced progress, explicit stop states, or stable failures.
//   - Side effects: Session reuse/login and at most one remote write attempt.
// - Split-When:
//   - Pacing and retry scheduling become independently versioned policies.
// - Merge-When:
//   - Blooket writes stop using resumable write plans.
// - Summary:
//   - Advances a checkpoint only after one exact planned write is confirmed.
// - Description:
//   - Checkpoint validation always precedes browser and credential side
//     effects.
// - Usage:
//   - Persist the returned advanced checkpoint before requesting another step.
// - Defaults:
//   - Ambiguous write outcomes keep the original checkpoint unchanged.
//
import {
  blooketNavigationDecision,
} from "../../../ir/blooket-navigation/domain/navigation-state.ts";
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  advanceBlooketWriteCheckpoint,
  decodeBlooketWriteCheckpoint,
  nextBlooketWriteOperation,
  type BlooketWriteCheckpoint,
} from "../../../projects/blooket-write-plans/domain/checkpoint.ts";
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
  BlooketWriteAttemptResult,
  BlooketWriteExecutionPort,
} from "../contract/write-execution.ts";

type SessionFailure = Extract<
  EnsureBlooketSessionResult,
  { readonly ok: false }
>;

export type ExecuteNextBlooketWriteResult =
  | {
      readonly ok: true;
      readonly kind: "complete";
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: true;
      readonly kind: "advanced";
      readonly operationId: string;
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: true;
      readonly kind: "wait";
      readonly state: "rate-limited";
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: true;
      readonly kind: "human-action-required";
      readonly state:
        | "organization-prompt"
        | "security-challenge"
        | "unexpected-page";
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: true;
      readonly kind: "session-required";
      readonly state: "signed-out" | "expired-session";
      readonly checkpoint: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: false;
      readonly stage: "checkpoint";
      readonly code: "invalid-checkpoint";
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly stage: "checkpoint";
      readonly code: "checkpoint-invariant";
    }
  | {
      readonly ok: false;
      readonly stage: "session";
      readonly code: SessionFailure["code"];
    }
  | {
      readonly ok: false;
      readonly stage: "write";
      readonly code:
        | BlooketBrowserFailureCode
        | "blooket-write-not-confirmed";
    };

export async function executeNextBlooketWrite(
  plan: BlooketWritePlan,
  checkpointCandidate: unknown,
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  writes: BlooketWriteExecutionPort,
): Promise<ExecuteNextBlooketWriteResult> {
  const decodedCheckpoint = decodeBlooketWriteCheckpoint(
    checkpointCandidate,
    plan,
  );
  if (!decodedCheckpoint.ok) {
    return {
      ok: false,
      stage: "checkpoint",
      code: "invalid-checkpoint",
      issues: decodedCheckpoint.issues,
    };
  }
  const checkpoint = decodedCheckpoint.value;
  const next = nextBlooketWriteOperation(plan, checkpoint);
  if (!next.ok) {
    return {
      ok: false,
      stage: "checkpoint",
      code: "checkpoint-invariant",
    };
  }
  if (next.operation === null) {
    return {
      ok: true,
      kind: "complete",
      checkpoint,
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
  if (session.kind === "wait") {
    return {
      ...session,
      checkpoint,
    };
  }
  if (session.kind === "human-action-required") {
    return {
      ...session,
      checkpoint,
    };
  }

  const attempted = await safeExecute(writes, next.operation);
  if (attempted.ok) {
    const advanced = advanceBlooketWriteCheckpoint(
      plan,
      checkpoint,
      next.operation.operationId,
    );
    if (!advanced.ok) {
      return {
        ok: false,
        stage: "checkpoint",
        code: "checkpoint-invariant",
      };
    }
    return {
      ok: true,
      kind: "advanced",
      operationId: next.operation.operationId,
      checkpoint: advanced.value,
    };
  }

  if (attempted.kind === "browser") {
    return {
      ok: false,
      stage: "write",
      code: attempted.code,
    };
  }

  return classifyStoppedAttempt(
    attempted.state,
    checkpoint,
  );
}

async function safeExecute(
  writes: BlooketWriteExecutionPort,
  operation: Parameters<BlooketWriteExecutionPort["execute"]>[0],
): Promise<BlooketWriteAttemptResult> {
  try {
    return await writes.execute(operation);
  } catch {
    return {
      ok: false,
      kind: "browser",
      code: "blooket-browser-failed",
    };
  }
}

function classifyStoppedAttempt(
  state: Extract<
    BlooketWriteAttemptResult,
    { readonly kind: "navigation" }
  >["state"],
  checkpoint: BlooketWriteCheckpoint,
): ExecuteNextBlooketWriteResult {
  const decision = blooketNavigationDecision({ kind: state });
  if (
    decision.action === "authenticate"
    && (
      decision.state === "signed-out"
      || decision.state === "expired-session"
    )
  ) {
    return {
      ok: true,
      kind: "session-required",
      state: decision.state,
      checkpoint,
    };
  }
  if (
    decision.action === "wait"
    && decision.state === "rate-limited"
  ) {
    return {
      ok: true,
      kind: "wait",
      state: decision.state,
      checkpoint,
    };
  }
  if (
    decision.action === "human-action-required"
    && (
      decision.state === "organization-prompt"
      || decision.state === "security-challenge"
      || decision.state === "unexpected-page"
    )
  ) {
    return {
      ok: true,
      kind: "human-action-required",
      state: decision.state,
      checkpoint,
    };
  }
  return {
    ok: false,
    stage: "write",
    code: "blooket-write-not-confirmed",
  };
}
