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
    if (!observed.ok) {
      return observed;
    }
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
    return {
      ok: false,
      code: "blooket-browser-failed",
    };
  }
}
