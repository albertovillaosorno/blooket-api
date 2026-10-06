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
//   - Canonical Blooket navigation states and deterministic transition
//     policy.
// - Must-Not:
//   - Inspect browser pages, encode selectors/URLs, authenticate, or
//     sleep/retry.
// - Allows:
//   - Inputs: Trusted navigation events emitted by a browser-facing adapter.
//   - Outputs: Explicit state transitions and automation dispositions.
//   - Side effects: None.
// - Split-When:
//   - Browser page classification gains an independently versioned contract.
// - Merge-When:
//   - Blooket navigation no longer needs explicit state handling.
// - Summary:
//   - Makes stop, wait, authentication, and continuation states explicit.
// - Description:
//   - Observations override expectations; workflow transitions remain narrow.
// - Usage:
//   - Reduce browser observations before deciding whether automation may
//     proceed.
// - Defaults:
//   - Unknown or sensitive browser facts are not represented by this contract.
//
export const BLOOKET_NAVIGATION_STATE_KINDS = [
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
] as const;

export type BlooketNavigationStateKind =
  typeof BLOOKET_NAVIGATION_STATE_KINDS[number];

export interface BlooketNavigationState {
  readonly kind: BlooketNavigationStateKind;
}

export type ObservedBlooketNavigationStateKind = Exclude<
  BlooketNavigationStateKind,
  "authenticating" | "authenticated" | "human-action-required"
>;

export type BlooketNavigationEvent =
  | {
      readonly kind: "observe";
      readonly state: ObservedBlooketNavigationStateKind;
    }
  | { readonly kind: "begin-authentication" }
  | { readonly kind: "confirm-authentication" }
  | { readonly kind: "require-human-action" };

export type BlooketNavigationDisposition =
  | "authenticate"
  | "observe"
  | "continue"
  | "wait"
  | "human-action-required";

export type BlooketNavigationTransition =
  | {
      readonly ok: true;
      readonly state: BlooketNavigationState;
    }
  | {
      readonly ok: false;
      readonly code: "invalid-navigation-transition";
    };

export function initialBlooketNavigationState(): BlooketNavigationState {
  return { kind: "signed-out" };
}

export function transitionBlooketNavigationState(
  current: BlooketNavigationState,
  event: BlooketNavigationEvent,
): BlooketNavigationTransition {
  if (event.kind === "observe") {
    return { ok: true, state: { kind: event.state } };
  }

  if (event.kind === "require-human-action") {
    return {
      ok: true,
      state: { kind: "human-action-required" },
    };
  }

  if (event.kind === "begin-authentication") {
    if (
      current.kind !== "signed-out"
      && current.kind !== "expired-session"
    ) {
      return { ok: false, code: "invalid-navigation-transition" };
    }
    return { ok: true, state: { kind: "authenticating" } };
  }

  if (current.kind !== "authenticating") {
    return { ok: false, code: "invalid-navigation-transition" };
  }
  return { ok: true, state: { kind: "authenticated" } };
}

export function blooketNavigationDisposition(
  state: BlooketNavigationState,
): BlooketNavigationDisposition {
  switch (state.kind) {
    case "signed-out":
    case "expired-session":
      return "authenticate";

    case "authenticating":
    case "authenticated":
      return "observe";

    case "dashboard":
    case "create":
    case "edit":
      return "continue";

    case "rate-limited":
      return "wait";

    case "organization-prompt":
    case "security-challenge":
    case "unexpected-page":
    case "human-action-required":
      return "human-action-required";
  }
}
