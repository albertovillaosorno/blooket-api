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
//   - Behavioral tests for secret-free Blooket session inspection.
// - Must-Not:
//   - Authenticate, read a host secret store, or encode browser selectors.
// - Allows:
//   - Inputs: In-memory browser observations and failures.
//   - Outputs: Canonical observed state/action verdicts.
//   - Side effects: In-memory call tracking only.
// - Split-When:
//   - Session health gains independently versioned fields.
// - Merge-When:
//   - Session inspection is removed.
// - Summary:
//   - Proves one-shot observation never mutates authentication state.
// - Description:
//   - Mirrors src/api/blooket-session/application/inspect-session.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Browser exceptions become stable browser failures.
//
import assert from "node:assert/strict";
import test from "node:test";

import { inspectBlooketSession } from
  "../../../../src/api/blooket-session/application/inspect-session.ts";
import type {
  BlooketBrowserObservationResult,
  BlooketBrowserSessionPort,
} from "../../../../src/api/blooket-session/contract/browser-session.ts";

function browser(
  observed: BlooketBrowserObservationResult | "throw",
  calls: string[],
): BlooketBrowserSessionPort {
  return {
    observe: async () => {
      calls.push("observe");
      if (observed === "throw") {
        throw new Error("fixture browser failure");
      }
      return observed;
    },
    authenticate: async () => {
      calls.push("authenticate");
      throw new Error("inspection must never authenticate");
    },
  };
}

test("session inspection maps every observable state to policy", async () => {
  const expected = {
    "signed-out": "authenticate",
    "organization-prompt": "human-action-required",
    dashboard: "continue",
    "my-sets": "continue",
    create: "continue",
    edit: "continue",
    "expired-session": "authenticate",
    "rate-limited": "wait",
    "security-challenge": "human-action-required",
    "unexpected-page": "human-action-required",
  } as const;

  for (const [state, action] of Object.entries(expected)) {
    const calls: string[] = [];
    const result = await inspectBlooketSession(browser({
      ok: true,
      state: state as keyof typeof expected,
    }, calls));

    assert.deepEqual(result, {
      ok: true,
      state,
      action,
    });
    assert.deepEqual(calls, ["observe"]);
  }
});

test("browser-declared observation failures pass through", async () => {
  const calls: string[] = [];
  const result = await inspectBlooketSession(browser({
    ok: false,
    code: "blooket-browser-unavailable",
  }, calls));

  assert.deepEqual(result, {
    ok: false,
    code: "blooket-browser-unavailable",
  });
  assert.deepEqual(calls, ["observe"]);
});

test("thrown observation errors become stable failures", async () => {
  const calls: string[] = [];
  const result = await inspectBlooketSession(
    browser("throw", calls),
  );

  assert.deepEqual(result, {
    ok: false,
    code: "blooket-browser-failed",
  });
  assert.deepEqual(calls, ["observe"]);
});
