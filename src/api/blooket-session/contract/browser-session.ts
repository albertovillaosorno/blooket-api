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
//   - Browser-session observation and credential submission port shapes.
// - Must-Not:
//   - Implement navigation policy, store credentials, or encode selectors.
// - Allows:
//   - Inputs: In-process credentials only for explicit authentication calls.
//   - Outputs: Observed navigation states or stable browser failure codes.
//   - Side effects: Defined by the concrete local browser adapter.
// - Split-When:
//   - Observation and authentication need independent adapter contracts.
// - Merge-When:
//   - Observation and authentication no longer need separate browser shapes.
// - Summary:
//   - Keeps browser mechanics behind a secret-aware application boundary.
// - Description:
//   - Observations report facts while canonical IR owns navigation policy.
// - Usage:
//   - Implement locally; never expose authenticate through external transports.
// - Defaults:
//   - Browser failures contain stable codes and no exception text.
//
import type { ObservedBlooketNavigationStateKind } from
  "../../../ir/blooket-navigation/domain/navigation-state.ts";
import type { BlooketCredentials } from
  "../../../security/blooket-credentials/domain/credentials.ts";

export type BlooketBrowserFailureCode =
  | "blooket-browser-unavailable"
  | "blooket-browser-failed";

export type BlooketBrowserObservationResult =
  | {
      readonly ok: true;
      readonly state: ObservedBlooketNavigationStateKind;
    }
  | {
      readonly ok: false;
      readonly code: BlooketBrowserFailureCode;
    };

export type BlooketBrowserAuthenticationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: BlooketBrowserFailureCode;
    };

export interface BlooketBrowserSessionPort {
  observe(): Promise<BlooketBrowserObservationResult>;
  authenticate(
    credentials: BlooketCredentials,
  ): Promise<BlooketBrowserAuthenticationResult>;
}
