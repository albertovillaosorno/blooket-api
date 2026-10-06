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
//   - Browser-facing capability-inspection port shapes.
// - Must-Not:
//   - Trust runtime data, authenticate, or infer unsupported capabilities.
// - Allows:
//   - Inputs: None beyond the adapter's confirmed browser/account context.
//   - Outputs: Untrusted capability candidates or stable browser failures.
//   - Side effects: Defined by the concrete browser adapter.
// - Split-When:
//   - Capability families require independent browser probes.
// - Merge-When:
//   - Capability inspection no longer depends on browser observations.
// - Summary:
//   - Keeps account capability probing outside canonical validation logic.
// - Description:
//   - The application decoder remains authoritative over returned candidates.
// - Usage:
//   - Implement only from verified browser observations.
// - Defaults:
//   - Adapter failures contain stable codes and no browser exception text.
//
import type { BlooketBrowserFailureCode } from
  "../../blooket-session/contract/browser-session.ts";

export type BlooketCapabilityProbeResult =
  | {
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly ok: false;
      readonly code: BlooketBrowserFailureCode;
    };

export interface BlooketCapabilityInspectionPort {
  inspect(): Promise<BlooketCapabilityProbeResult>;
}
