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
//   - Authenticated validated Blooket set listing and metadata retrieval.
// - Must-Not:
//   - Return raw page data, credentials, or undocumented set fields.
// - Allows:
//   - Inputs: Browser/session ports, host-secret store, and opaque set IDs.
//   - Outputs: Validated set reads, wait/human states, or stable failures.
//   - Side effects: Session reuse/login plus one set read when ready.
// - Split-When:
//   - Full question retrieval gains a verified read contract.
// - Merge-When:
//   - Set listing and metadata retrieval no longer share session semantics.
// - Summary:
//   - Gates untrusted browser set reads behind session and IR validation.
// - Description:
//   - Invalid request IDs fail before browser or secret side effects.
// - Usage:
//   - Use list for My Sets summaries and get for verified metadata detail.
// - Defaults:
//   - Detail IDs must exactly match the requested opaque ID.
//
import {
  decodeBlooketSetDetail,
  decodeBlooketSetId,
  decodeBlooketSetList,
  type BlooketSetDetail,
  type BlooketSetSummary,
} from "../../../ir/blooket-set-reads/contract/set-read.ts";
import {
  decodeBlooketQuestionReadList,
  type BlooketQuestionRead,
} from "../../../ir/blooket-question-reads/contract/question-read.ts";
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import {
  ensureBlooketSession,
  inspectReadyBlooketSession,
  type EnsureBlooketSessionResult,
} from "../../blooket-session/application/ensure-session.ts";
import type {
  BlooketBrowserFailureCode,
  BlooketBrowserSessionPort,
} from "../../blooket-session/contract/browser-session.ts";
import type {
  BlooketSetListCompleteness,
  BlooketSetListProbeResult,
  BlooketSetProbeResult,
  BlooketSetReadPort,
} from "../contract/set-reads.ts";
import type {
  BlooketQuestionProbeResult,
  BlooketQuestionReadPort,
} from "../contract/question-reads.ts";

type SessionFailure = Extract<
  EnsureBlooketSessionResult,
  { readonly ok: false }
>;

type SessionStop = Extract<
  EnsureBlooketSessionResult,
  {
    readonly ok: true;
    readonly kind: "wait" | "human-action-required";
  }
>;


interface ReadySessionSummary {
  readonly state: "dashboard" | "my-sets" | "create" | "edit";
  readonly reused: boolean;
}

type ReadFailure =
  | {
      readonly ok: false;
      readonly stage: "session";
      readonly code: SessionFailure["code"];
    }
  | {
      readonly ok: false;
      readonly stage: "read";
      readonly code: BlooketBrowserFailureCode;
    }
  | {
      readonly ok: false;
      readonly stage: "validation";
      readonly code: "invalid-set-read";
      readonly issues: readonly ValidationIssue[];
    };

export type ListBlooketSetsResult =
  | {
      readonly ok: true;
      readonly kind: "sets";
      readonly session: ReadySessionSummary;
      readonly completeness: BlooketSetListCompleteness;
      readonly value: readonly BlooketSetSummary[];
    }
  | SessionStop
  | ReadFailure;

export type GetBlooketSetResult =
  | {
      readonly ok: true;
      readonly kind: "set";
      readonly session: ReadySessionSummary;
      readonly value: BlooketSetDetail;
    }
  | SessionStop
  | ReadFailure
  | {
      readonly ok: false;
      readonly stage: "request";
      readonly code: "invalid-set-id";
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly stage: "validation";
      readonly code: "set-id-mismatch";
    };

export type ListBlooketQuestionsResult =
  | {
      readonly ok: true;
      readonly kind: "questions";
      readonly session: ReadySessionSummary;
      readonly value: readonly BlooketQuestionRead[];
    }
  | SessionStop
  | {
      readonly ok: false;
      readonly stage: "session";
      readonly code: SessionFailure["code"];
    }
  | {
      readonly ok: false;
      readonly stage: "read";
      readonly code: BlooketBrowserFailureCode;
    }
  | {
      readonly ok: false;
      readonly stage: "request";
      readonly code: "invalid-set-id";
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly stage: "validation";
      readonly code: "invalid-question-read";
      readonly issues: readonly ValidationIssue[];
    };

export async function listBlooketSets(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  reads: BlooketSetReadPort,
  options: { readonly readOnly?: boolean } = {},
): Promise<ListBlooketSetsResult> {
  const session = await ensureReadySession(browser, secrets, options.readOnly);
  if (!session.ok || session.kind !== "ready") {
    return session;
  }

  const probed = await safeListProbe(() => reads.list());
  if (!probed.ok) return await classifyFailedRead(browser, probed.code);

  if (
    probed.completeness !== "complete"
    && probed.completeness !== "unknown"
  ) {
    return { ok: false, stage: "read", code: "blooket-browser-failed" };
  }

  const decoded = decodeBlooketSetList(probed.value);
  if (!decoded.ok) {
    return {
      ok: false,
      stage: "validation",
      code: "invalid-set-read",
      issues: decoded.issues,
    };
  }

  return {
    ok: true,
    kind: "sets",
    session: {
      state: session.state,
      reused: session.reused,
    },
    completeness: probed.completeness,
    value: decoded.value,
  };
}

export async function getBlooketSet(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  reads: BlooketSetReadPort,
  setId: unknown,
  options: { readonly readOnly?: boolean } = {},
): Promise<GetBlooketSetResult> {
  const decodedId = decodeBlooketSetId(setId);
  if (!decodedId.ok) {
    return {
      ok: false,
      stage: "request",
      code: "invalid-set-id",
      issues: decodedId.issues,
    };
  }

  const session = await ensureReadySession(browser, secrets, options.readOnly);
  if (!session.ok || session.kind !== "ready") {
    return session;
  }

  const probed = await safeProbe(() => reads.get(decodedId.value));
  if (!probed.ok) return await classifyFailedRead(browser, probed.code);

  const decoded = decodeBlooketSetDetail(probed.value);
  if (!decoded.ok) {
    return {
      ok: false,
      stage: "validation",
      code: "invalid-set-read",
      issues: decoded.issues,
    };
  }
  if (decoded.value.id !== decodedId.value) {
    return {
      ok: false,
      stage: "validation",
      code: "set-id-mismatch",
    };
  }

  return {
    ok: true,
    kind: "set",
    session: {
      state: session.state,
      reused: session.reused,
    },
    value: decoded.value,
  };
}

export async function listBlooketQuestions(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  reads: BlooketQuestionReadPort,
  setId: unknown,
  options: { readonly readOnly?: boolean } = {},
): Promise<ListBlooketQuestionsResult> {
  const decodedId = decodeBlooketSetId(setId);
  if (!decodedId.ok) {
    return {
      ok: false,
      stage: "request",
      code: "invalid-set-id",
      issues: decodedId.issues,
    };
  }

  const session = await ensureReadySession(browser, secrets, options.readOnly);
  if (!session.ok || session.kind !== "ready") {
    return session;
  }

  const probed = await safeQuestionProbe(() => reads.list(decodedId.value));
  if (!probed.ok) return await classifyFailedRead(browser, probed.code);

  const decoded = decodeBlooketQuestionReadList(probed.value);
  if (!decoded.ok) {
    return {
      ok: false,
      stage: "validation",
      code: "invalid-question-read",
      issues: decoded.issues,
    };
  }

  return {
    ok: true,
    kind: "questions",
    session: {
      state: session.state,
      reused: session.reused,
    },
    value: decoded.value,
  };
}

async function ensureReadySession(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  readOnly = false,
): Promise<
  | Extract<EnsureBlooketSessionResult, { readonly ok: true }>
  | {
      readonly ok: false;
      readonly stage: "session";
      readonly code: SessionFailure["code"];
    }
> {
  const session = readOnly
    ? await inspectReadyBlooketSession(browser)
    : await ensureBlooketSession(browser, secrets);
  if (!session.ok) {
    return {
      ok: false,
      stage: "session",
      code: session.code,
    };
  }
  return session;
}

// An authenticated page can be replaced by a human prompt during a read.
// Re-observe without credentials or login attempts only after a page failure.
// Unknown follow-up state preserves the original transport failure.
async function classifyFailedRead(
  browser: BlooketBrowserSessionPort,
  code: BlooketBrowserFailureCode,
): Promise<SessionStop | Extract<
  ReadFailure, { readonly stage: "session" | "read" }
>> {
  if (code === "blooket-browser-failed") {
    const observed = await inspectReadyBlooketSession(browser);
    if (observed.ok &&
        (observed.kind === "wait" ||
          observed.kind === "human-action-required"))
      return observed;
    if (!observed.ok && observed.code === "blooket-authentication-required")
      return { ok: false, stage: "session", code: observed.code };
  }
  return { ok: false, stage: "read", code };
}

async function safeListProbe(
  probe: () => Promise<BlooketSetListProbeResult>,
): Promise<BlooketSetListProbeResult> {
  try {
    const result = await probe();
    if (!result || typeof result !== "object" || Array.isArray(result))
      return browserReadFailure();
    if (result.ok === false) return validateReadFailure(result);
    if (result.ok === true &&
        Object.keys(result).sort().join() === "completeness,ok,value" &&
        (result.completeness === "complete" ||
          result.completeness === "unknown"))
      return {
        ok: true,
        completeness: result.completeness,
        value: result.value,
      };
    return browserReadFailure();
  } catch {
    return browserReadFailure();
  }
}

async function safeProbe(
  probe: () => Promise<BlooketSetProbeResult>,
): Promise<BlooketSetProbeResult> {
  try {
    const result = await probe();
    if (!result || typeof result !== "object" || Array.isArray(result))
      return browserReadFailure();
    if (result.ok === false) return validateReadFailure(result);
    if (result.ok === true &&
        Object.keys(result).sort().join() === "ok,value")
      return { ok: true, value: result.value };
    return browserReadFailure();
  } catch {
    return browserReadFailure();
  }
}

async function safeQuestionProbe(
  probe: () => Promise<BlooketQuestionProbeResult>,
): Promise<BlooketQuestionProbeResult> {
  return await safeProbe(probe);
}

function validateReadFailure(
  result: { readonly ok: false; readonly code: unknown },
): Extract<BlooketSetProbeResult, { readonly ok: false }> {
  if (Object.keys(result).sort().join() === "code,ok" &&
      (result.code === "blooket-browser-failed" ||
        result.code === "blooket-browser-incompatible" ||
        result.code === "blooket-browser-unavailable"))
    return { ok: false, code: result.code };
  return browserReadFailure();
}

function browserReadFailure(): Extract<
  BlooketSetProbeResult, { readonly ok: false }
> {
  return { ok: false, code: "blooket-browser-failed" };
}
