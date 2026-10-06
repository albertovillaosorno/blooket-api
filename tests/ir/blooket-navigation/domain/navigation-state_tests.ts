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
//   - Behavioral tests for canonical Blooket navigation transitions.
// - Must-Not:
//   - Inspect real browser pages, authenticate, or encode external selectors.
// - Allows:
//   - Inputs: Fixed state and event fixtures.
//   - Outputs: Deterministic transition and disposition verdicts.
//   - Side effects: None.
// - Split-When:
//   - Browser classification requires its own fixture suite.
// - Merge-When:
//   - Blooket navigation state handling is removed.
// - Summary:
//   - Proves stop states fail closed and observed redirects remain
//     authoritative.
// - Description:
//   - Mirrors src/ir/blooket-navigation/domain/navigation-state.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Tests do not imply URLs, selectors, or retry timing.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOOKET_NAVIGATION_STATE_KINDS,
  blooketNavigationDecision,
  blooketNavigationDisposition,
  initialBlooketNavigationState,
  transitionBlooketNavigationState,
  type BlooketNavigationDisposition,
  type BlooketNavigationStateKind,
  type ObservedBlooketNavigationStateKind,
} from "../../../../src/ir/blooket-navigation/domain/navigation-state.ts";

test("the state vocabulary contains every roadmap navigation state", () => {
  assert.deepEqual(BLOOKET_NAVIGATION_STATE_KINDS, [
    "signed-out",
    "authenticating",
    "authenticated",
    "organization-prompt",
    "dashboard",
    "create",
    "edit",
    "expired-session",
    "rate-limited",
    "security-challenge",
    "unexpected-page",
    "human-action-required",
  ]);
});

test("navigation starts signed out", () => {
  assert.deepEqual(initialBlooketNavigationState(), {
    kind: "signed-out",
  });
});

test(
  "authentication begins only from signed-out or expired states",
  () => {
  for (const kind of ["signed-out", "expired-session"] as const) {
    assert.deepEqual(
      transitionBlooketNavigationState(
        { kind },
        { kind: "begin-authentication" },
      ),
      {
        ok: true,
        state: { kind: "authenticating" },
      },
    );
  }

  for (const kind of BLOOKET_NAVIGATION_STATE_KINDS) {
    if (kind === "signed-out" || kind === "expired-session") {
      continue;
    }
    assert.deepEqual(
      transitionBlooketNavigationState(
        { kind },
        { kind: "begin-authentication" },
      ),
      {
        ok: false,
        code: "invalid-navigation-transition",
      },
    );
  }
  },
);

test(
  "authentication confirmation requires an authenticating state",
  () => {
  assert.deepEqual(
    transitionBlooketNavigationState(
      { kind: "authenticating" },
      { kind: "confirm-authentication" },
    ),
    {
      ok: true,
      state: { kind: "authenticated" },
    },
  );

  for (const kind of BLOOKET_NAVIGATION_STATE_KINDS) {
    if (kind === "authenticating") {
      continue;
    }
    assert.deepEqual(
      transitionBlooketNavigationState(
        { kind },
        { kind: "confirm-authentication" },
      ),
      {
        ok: false,
        code: "invalid-navigation-transition",
      },
    );
  }
  },
);

test("browser observations override expected workflow state", () => {
  const observations: readonly ObservedBlooketNavigationStateKind[] = [
    "signed-out",
    "organization-prompt",
    "dashboard",
    "create",
    "edit",
    "expired-session",
    "rate-limited",
    "security-challenge",
    "unexpected-page",
  ];

  for (const observed of observations) {
    assert.deepEqual(
      transitionBlooketNavigationState(
        { kind: "authenticated" },
        { kind: "observe", state: observed },
      ),
      {
        ok: true,
        state: { kind: observed },
      },
    );
  }
});

test("human escalation is explicit and idempotent", () => {
  for (const kind of BLOOKET_NAVIGATION_STATE_KINDS) {
    assert.deepEqual(
      transitionBlooketNavigationState(
        { kind },
        { kind: "require-human-action" },
      ),
      {
        ok: true,
        state: { kind: "human-action-required" },
      },
    );
  }
});

test("navigation decisions preserve the state for each action", () => {
  assert.deepEqual(
    blooketNavigationDecision({ kind: "dashboard" }),
    { action: "continue", state: "dashboard" },
  );
  assert.deepEqual(
    blooketNavigationDecision({ kind: "rate-limited" }),
    { action: "wait", state: "rate-limited" },
  );
  assert.deepEqual(
    blooketNavigationDecision({ kind: "security-challenge" }),
    {
      action: "human-action-required",
      state: "security-challenge",
    },
  );
});

test("every navigation state has a deterministic disposition", () => {
  const expected: Readonly<
    Record<BlooketNavigationStateKind, BlooketNavigationDisposition>
  > = {
    "signed-out": "authenticate",
    authenticating: "observe",
    authenticated: "observe",
    "organization-prompt": "human-action-required",
    dashboard: "continue",
    create: "continue",
    edit: "continue",
    "expired-session": "authenticate",
    "rate-limited": "wait",
    "security-challenge": "human-action-required",
    "unexpected-page": "human-action-required",
    "human-action-required": "human-action-required",
  };

  for (const kind of BLOOKET_NAVIGATION_STATE_KINDS) {
    assert.equal(
      blooketNavigationDisposition({ kind }),
      expected[kind],
    );
  }
});

test(
  "organization and security states can never continue automatically",
  () => {
  for (const kind of [
    "organization-prompt",
    "security-challenge",
    "unexpected-page",
    "human-action-required",
  ] as const) {
    assert.equal(
      blooketNavigationDisposition({ kind }),
      "human-action-required",
    );
  }
  },
);

test("rate limiting waits without inventing retry timing", () => {
  assert.equal(
    blooketNavigationDisposition({ kind: "rate-limited" }),
    "wait",
  );
});
