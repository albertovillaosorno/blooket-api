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
//   - Session reuse and credential-gated login orchestration.
// - Must-Not:
//   - Return credentials, infer page selectors, bypass challenges, or sleep.
// - Allows:
//   - Inputs: A browser-session port and a host-secret store.
//   - Outputs: Secret-free ready, wait, human-action, or failure results.
//   - Side effects: Browser observation/login and conditional host-secret
//     reads.
// - Split-When:
//   - Browser login methods require separate orchestration lifecycles.
// - Merge-When:
//   - Blooket no longer requires authenticated browser sessions.
// - Summary:
//   - Reuses confirmed sessions before reading any stored credential.
// - Description:
//   - Reads credentials only for signed-out or expired observed sessions.
// - Usage:
//   - Run before authenticated Blooket reads or writes.
// - Defaults:
//   - Ambiguous, challenged, and organization states require human action.
//
import {
  blooketNavigationDecision,
  type ObservedBlooketNavigationStateKind,
} from "../../../ir/blooket-navigation/domain/navigation-state.ts";
import {
  readBlooketCredentials,
  type BlooketCredentialReadResult,
  type BlooketCredentials,
} from "../../../security/blooket-credentials/domain/credentials.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";

export type BlooketReadyNavigationState =
  | "dashboard"
  | "create"
  | "edit";

export type BlooketHumanNavigationState =
  | "organization-prompt"
  | "security-challenge"
  | "unexpected-page";

export type BlooketBrowserFailureCode =
  | "blooket-browser-unavailable"
  | "blooket-browser-failed";

export type BlooketBrowserObservationResult =
  | {
      readonly ok: true;
      readonly state: ObservedBlooketNavigationStateKind;
    }
  | {
      readonly ok: false;
      readonly code: BlooketBrowserFailureCode;
    };

export type BlooketBrowserAuthenticationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: BlooketBrowserFailureCode;
    };

export interface BlooketBrowserSessionPort {
  observe(): Promise<BlooketBrowserObservationResult>;
  authenticate(
    credentials: BlooketCredentials,
  ): Promise<BlooketBrowserAuthenticationResult>;
}

type CredentialFailure = Extract<
  BlooketCredentialReadResult,
  { readonly ok: false }
>;

export type EnsureBlooketSessionResult =
  | {
      readonly ok: true;
      readonly kind: "ready";
      readonly state: BlooketReadyNavigationState;
      readonly reused: boolean;
    }
  | {
      readonly ok: true;
      readonly kind: "wait";
      readonly state: "rate-limited";
    }
  | {
      readonly ok: true;
      readonly kind: "human-action-required";
      readonly state: BlooketHumanNavigationState;
    }
  | {
      readonly ok: false;
      readonly code:
        | CredentialFailure["code"]
        | BlooketBrowserFailureCode
        | "blooket-authentication-not-established";
    };

export async function ensureBlooketSession(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
): Promise<EnsureBlooketSessionResult> {
  const initial = await safeObserve(browser);
  if (!initial.ok) {
    return initial;
  }

  const initialDecision = classifyObservedState(initial.state, true);
  if (initialDecision !== null) {
    return initialDecision;
  }

  const credentials = await readBlooketCredentials(secrets);
  if (!credentials.ok) {
    return credentials;
  }

  const authenticated = await safeAuthenticate(
    browser,
    credentials.value,
  );
  if (!authenticated.ok) {
    return authenticated;
  }

  const observed = await safeObserve(browser);
  if (!observed.ok) {
    return observed;
  }

  const finalDecision = classifyObservedState(observed.state, false);
  return finalDecision ?? {
    ok: false,
    code: "blooket-authentication-not-established",
  };
}

function classifyObservedState(
  state: ObservedBlooketNavigationStateKind,
  reused: boolean,
): EnsureBlooketSessionResult | null {
  const decision = blooketNavigationDecision({ kind: state });
  if (decision.action === "continue") {
    return {
      ok: true,
      kind: "ready",
      state: decision.state,
      reused,
    };
  }
  if (decision.action === "wait") {
    return {
      ok: true,
      kind: "wait",
      state: decision.state,
    };
  }
  if (decision.action === "human-action-required") {
    if (decision.state === "human-action-required") {
      return null;
    }
    return {
      ok: true,
      kind: "human-action-required",
      state: decision.state,
    };
  }
  return null;
}

async function safeObserve(
  browser: BlooketBrowserSessionPort,
): Promise<BlooketBrowserObservationResult> {
  try {
    return await browser.observe();
  } catch {
    return {
      ok: false,
      code: "blooket-browser-failed",
    };
  }
}

async function safeAuthenticate(
  browser: BlooketBrowserSessionPort,
  credentials: BlooketCredentials,
): Promise<BlooketBrowserAuthenticationResult> {
  try {
    return await browser.authenticate(credentials);
  } catch {
    return {
      ok: false,
      code: "blooket-browser-failed",
    };
  }
}
