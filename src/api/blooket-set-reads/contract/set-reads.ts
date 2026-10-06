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
//   - Browser-facing set list/detail read port shapes.
// - Must-Not:
//   - Trust runtime payloads, authenticate, or infer undocumented set fields.
// - Allows:
//   - Inputs: Opaque validated set IDs for detail reads.
//   - Outputs: Untrusted read candidates or stable browser failures.
//   - Side effects: Defined by the concrete browser adapter.
// - Split-When:
//   - List and detail reads require independently versioned adapter contracts.
// - Merge-When:
//   - Set reads no longer depend on browser observations.
// - Summary:
//   - Keeps Blooket page extraction behind strict application validation.
// - Description:
//   - Adapter values remain unknown until decoded through canonical IR.
// - Usage:
//   - Implement against authenticated My Sets/detail browser observations.
// - Defaults:
//   - Browser failures expose stable codes only.
//
import type { BlooketBrowserFailureCode } from
  "../../blooket-session/contract/browser-session.ts";

export type BlooketSetProbeResult =
  | {
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly ok: false;
      readonly code: BlooketBrowserFailureCode;
    };

export interface BlooketSetReadPort {
  list(): Promise<BlooketSetProbeResult>;
  get(setId: string): Promise<BlooketSetProbeResult>;
}
