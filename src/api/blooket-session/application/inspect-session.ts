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
//   - One-shot secret-free inspection of the current Blooket browser session.
// - Must-Not:
//   - Authenticate, read credentials, retry, or expose browser exception text.
// - Allows:
//   - Inputs: A local browser-session port.
//   - Outputs: Observed state plus canonical action, or stable browser failure.
//   - Side effects: Exactly one browser observation attempt.
// - Split-When:
//   - Session health requires independently versioned status data.
// - Merge-When:
//   - Session inspection is no longer exposed independently of login.
// - Summary:
//   - Reports current session/navigation state without causing authentication.
// - Description:
//   - Applies canonical IR navigation policy to one observed browser fact.
// - Usage:
//   - Use for health/session reads and as the first step before login.
// - Defaults:
//   - Thrown browser errors become blooket-browser-failed.
//
import {
  BLOOKET_NAVIGATION_STATE_KINDS,
  blooketNavigationDecision,
  type ObservedBlooketNavigationStateKind,
} from "../../../ir/blooket-navigation/domain/navigation-state.ts";
import type {
  BlooketBrowserFailureCode,
  BlooketBrowserSessionPort,
} from "../contract/browser-session.ts";

export type InspectedBlooketSessionAction =
  | "authenticate"
  | "continue"
  | "wait"
  | "human-action-required";

export type InspectBlooketSessionResult =
  | {
      readonly ok: true;
      readonly state: ObservedBlooketNavigationStateKind;
      readonly action: InspectedBlooketSessionAction;
    }
  | {
      readonly ok: false;
      readonly code: BlooketBrowserFailureCode;
    };

export async function inspectBlooketSession(
  browser: BlooketBrowserSessionPort,
): Promise<InspectBlooketSessionResult> {
  try {
    const observed = await browser.observe();
    if (!observed || typeof observed !== "object" ||
        Array.isArray(observed)) return browserFailure();
    const keys = Object.keys(observed).sort().join();
    if (observed.ok === false) {
      if (keys !== "code,ok" ||
          (observed.code !== "blooket-browser-unavailable" &&
            observed.code !== "blooket-browser-failed"))
        return browserFailure();
      return { ok: false, code: observed.code };
    }
    const state: unknown = observed.state;
    if (observed.ok !== true || keys !== "ok,state" ||
        !BLOOKET_NAVIGATION_STATE_KINDS.some(
          (candidate) => candidate === state,
        ) ||
        state === "authenticating" ||
        state === "authenticated" ||
        state === "human-action-required")
      return browserFailure();
    const decision = blooketNavigationDecision({
      kind: observed.state,
    });
    if (decision.action === "observe") {
      return {
        ok: false,
        code: "blooket-browser-failed",
      };
    }
    return {
      ok: true,
      state: observed.state,
      action: decision.action,
    };
  } catch {
    return browserFailure();
  }
}

function browserFailure(): Extract<InspectBlooketSessionResult, { ok: false }> {
  return { ok: false, code: "blooket-browser-failed" };
}
