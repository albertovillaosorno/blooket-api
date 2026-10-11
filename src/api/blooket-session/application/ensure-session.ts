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
//   - Session reuse and login no longer need independent orchestration.
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
  readBlooketCredentials,
  type BlooketCredentialReadResult,
  type BlooketCredentials,
} from "../../../security/blooket-credentials/domain/credentials.ts";
import {
  inspectBlooketSession,
  type InspectBlooketSessionResult,
} from "./inspect-session.ts";
import type {
  BlooketBrowserAuthenticationResult,
  BlooketBrowserFailureCode,
  BlooketBrowserSessionPort,
} from "../contract/browser-session.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import { loadPreferences } from
  "../../../platforms/user-storage/adapter-outbound/root.ts";

export type BlooketReadyNavigationState =
  | "dashboard"
  | "my-sets"
  | "create"
  | "edit";

export type BlooketHumanNavigationState =
  | "organization-prompt"
  | "security-challenge"
  | "unexpected-page";

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
        | "blooket-authentication-not-established"
        | "blooket-authentication-required";
    };

export async function ensureBlooketSession(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  loginIdentifier?: string,
): Promise<EnsureBlooketSessionResult> {
  const initial = await inspectBlooketSession(browser);
  if (!initial.ok) {
    return initial;
  }

  const initialDecision = classifyInspectedSession(initial, true);
  if (initialDecision !== null) {
    return initialDecision;
  }

  const credentials = await readBlooketCredentials(secrets, loginIdentifier);
  if (!credentials.ok) {
    return credentials;
  }

  const authenticated = await safeAuthenticate(browser, credentials.value);
  if (!authenticated.ok) {
    return authenticated;
  }

  const observed = await inspectBlooketSession(browser);
  if (!observed.ok) {
    return observed;
  }

  const finalDecision = classifyInspectedSession(observed, false);
  return (
    finalDecision ?? {
      ok: false,
      code: "blooket-authentication-not-established",
    }
  );
}

export async function inspectReadyBlooketSession(
  browser: BlooketBrowserSessionPort,
): Promise<EnsureBlooketSessionResult> {
  const observed = await inspectBlooketSession(browser);
  if (!observed.ok) return observed;
  return (
    classifyInspectedSession(observed, true) ?? {
      ok: false,
      code: "blooket-authentication-required",
    }
  );
}

export async function ensureConfiguredBlooketSession(
  browser: BlooketBrowserSessionPort,
  root: string,
  secrets: HostSecretStore,
): Promise<EnsureBlooketSessionResult> {
  const preferences = await loadPreferences(root);
  return ensureBlooketSession(browser, secrets, preferences.email);
}

function classifyInspectedSession(
  session: Extract<InspectBlooketSessionResult, { readonly ok: true }>,
  reused: boolean,
): EnsureBlooketSessionResult | null {
  if (session.action === "continue") {
    if (
      session.state !== "dashboard" &&
      session.state !== "my-sets" &&
      session.state !== "create" &&
      session.state !== "edit"
    ) {
      return {
        ok: false,
        code: "blooket-browser-failed",
      };
    }
    return {
      ok: true,
      kind: "ready",
      state: session.state,
      reused,
    };
  }
  if (session.action === "wait") {
    return {
      ok: true,
      kind: "wait",
      state: "rate-limited",
    };
  }
  if (session.action === "human-action-required") {
    if (
      session.state !== "organization-prompt" &&
      session.state !== "security-challenge" &&
      session.state !== "unexpected-page"
    ) {
      return {
        ok: false,
        code: "blooket-browser-failed",
      };
    }
    return {
      ok: true,
      kind: "human-action-required",
      state: session.state,
    };
  }
  return null;
}

async function safeAuthenticate(
  browser: BlooketBrowserSessionPort,
  credentials: BlooketCredentials,
): Promise<BlooketBrowserAuthenticationResult> {
  try {
    const result = await browser.authenticate(credentials);
    if (!result || typeof result !== "object" || Array.isArray(result))
      return { ok: false, code: "blooket-browser-failed" };
    const keys = Reflect.ownKeys(result).sort().join();
    if (result.ok === true && keys === "ok") return { ok: true };
    if (result.ok === false && keys === "code,ok" &&
        (result.code === "blooket-browser-unavailable" ||
          result.code === "blooket-browser-failed"))
      return { ok: false, code: result.code };
    return { ok: false, code: "blooket-browser-failed" };
  } catch {
    return {
      ok: false,
      code: "blooket-browser-failed",
    };
  }
}
