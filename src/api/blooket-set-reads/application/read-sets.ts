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
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
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
  BlooketSetProbeResult,
  BlooketSetReadPort,
} from "../contract/set-reads.ts";

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

export async function listBlooketSets(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  reads: BlooketSetReadPort,
): Promise<ListBlooketSetsResult> {
  const session = await ensureReadySession(browser, secrets);
  if (!session.ok || session.kind !== "ready") {
    return session;
  }

  const probed = await safeProbe(() => reads.list());
  if (!probed.ok) {
    return {
      ok: false,
      stage: "read",
      code: probed.code,
    };
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
    value: decoded.value,
  };
}

export async function getBlooketSet(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  reads: BlooketSetReadPort,
  setId: unknown,
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

  const session = await ensureReadySession(browser, secrets);
  if (!session.ok || session.kind !== "ready") {
    return session;
  }

  const probed = await safeProbe(
    () => reads.get(decodedId.value),
  );
  if (!probed.ok) {
    return {
      ok: false,
      stage: "read",
      code: probed.code,
    };
  }

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

async function ensureReadySession(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
): Promise<
  | Extract<
      EnsureBlooketSessionResult,
      { readonly ok: true }
    >
  | {
      readonly ok: false;
      readonly stage: "session";
      readonly code: SessionFailure["code"];
    }
> {
  const session = await ensureBlooketSession(browser, secrets);
  if (!session.ok) {
    return {
      ok: false,
      stage: "session",
      code: session.code,
    };
  }
  return session;
}

async function safeProbe(
  probe: () => Promise<BlooketSetProbeResult>,
): Promise<BlooketSetProbeResult> {
  try {
    return await probe();
  } catch {
    return {
      ok: false,
      code: "blooket-browser-failed",
    };
  }
}
