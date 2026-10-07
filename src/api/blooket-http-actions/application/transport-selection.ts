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
//   - Pre-mutation admission policy for candidate HTTP versus browser writes.
// - Must-Not:
//   - Execute either transport, claim HTTP verification, or replay ambiguity.
// - Allows:
//   - Inputs: One validated submission and whether a mutation is ambiguous.
//   - Outputs: Browser fallback before mutation or reconciliation afterward.
//   - Side effects: None.
// - Split-When:
//   - A verified HTTP response contract admits concrete HTTP execution.
// - Merge-When:
//   - Blooket writes use one transport only.
// - Summary:
//   - Keeps unverified HTTP candidates inactive and ambiguity unreplayed.
// - Description:
//   - Payload evidence alone never activates HTTP transport.
// - Usage:
//   - Select transport before opening a remote mutation attempt.
// - Defaults:
//   - Current HTTP response evidence remains unverified.
//
import type { BlooketWriteSubmission } from
  "../../../ir/blooket-write-submissions/contract/write-submission.ts";
import { lowerHttpAction } from "./payload.ts";

export const BLOOKET_HTTP_RESPONSE_CONTRACT = "unverified" as const;

export type BlooketWriteTransportSelection =
  | {
      readonly kind: "browser";
      readonly reason:
        | "http-response-unverified"
        | "http-operation-unsupported";
    }
  | {
      readonly kind: "reconciliation-required";
      readonly reason: "ambiguous-primary-mutation";
    };

export function selectBlooketWriteTransport(
  submission: BlooketWriteSubmission,
  mutationState: "not-started" | "ambiguous",
): BlooketWriteTransportSelection {
  if (mutationState === "ambiguous") {
    return {
      kind: "reconciliation-required",
      reason: "ambiguous-primary-mutation",
    };
  }

  const candidate = lowerHttpAction(submission);
  if (candidate === undefined) {
    return {
      kind: "browser",
      reason: "http-operation-unsupported",
    };
  }

  // A payload candidate is intentionally insufficient to activate HTTP writes.
  return {
    kind: "browser",
    reason: "http-response-unverified",
  };
}
