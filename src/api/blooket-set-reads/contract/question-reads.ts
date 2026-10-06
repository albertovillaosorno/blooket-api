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
//   - Browser-facing normalized question-list read port.
// - Must-Not:
//   - Trust page data, authenticate, expose media URLs, or mutate Blooket.
// - Allows:
//   - Inputs: One opaque validated remote set ID.
//   - Outputs: Untrusted normalized question candidates or stable failures.
//   - Side effects: Defined by the concrete local browser adapter.
// - Split-When:
//   - Question detail and collection reads need different browser mechanics.
// - Merge-When:
//   - Question reads no longer depend on authenticated browser observations.
// - Summary:
//   - Keeps edit-page question extraction behind strict IR validation.
// - Description:
//   - The adapter normalizes provider fields but cannot authorize their values.
// - Usage:
//   - Implement from an authenticated edit page and decode every result.
// - Defaults:
//   - Browser failures expose stable codes without exception or session text.
//
import type { BlooketBrowserFailureCode } from
  "../../blooket-session/contract/browser-session.ts";

export type BlooketQuestionProbeResult =
  | {
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly ok: false;
      readonly code: BlooketBrowserFailureCode;
    };

export interface BlooketQuestionReadPort {
  list(setId: string): Promise<BlooketQuestionProbeResult>;
}
