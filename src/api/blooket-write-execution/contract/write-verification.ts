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
//   - Browser-facing verification of one ambiguous Blooket write attempt.
// - Must-Not:
//   - Persist, retry, mutate remotely, or infer success from weak evidence.
// - Allows:
//   - Inputs: Exact planned operation and its durable remote target.
//   - Outputs: Verified outcome, explicit inconclusive state, or browser stop.
//   - Side effects: Provider observation only; no remote mutation.
// - Split-When:
//   - Set and question verification require independent provider contracts.
// - Merge-When:
//   - Persisted writes no longer require post-attempt reconciliation.
// - Summary:
//   - Keeps provider verification observation-only and fail-closed.
// - Description:
//   - Confirmed means evidence is sufficient for the exact planned operation.
// - Usage:
//   - Implement from verified browser behavior; return inconclusive otherwise.
// - Defaults:
//   - Browser exceptions and unknown evidence never become confirmation.
//
import type { ObservedBlooketNavigationStateKind } from
  "../../../ir/blooket-navigation/domain/navigation-state.ts";
import type { BlooketWriteReceipt } from
  "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketWriteVerificationBaseline } from
  "../../../projects/blooket-write-plans/domain/verification-baseline.ts";
import type { BlooketWriteOperation } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type { BlooketBrowserFailureCode } from
  "../../blooket-session/contract/browser-session.ts";
import type { BlooketWriteTarget } from "./write-execution.ts";

export type BlooketWriteVerificationObservationFailure =
  | {
      readonly ok: false;
      readonly kind: "navigation";
      readonly state: ObservedBlooketNavigationStateKind;
    }
  | {
      readonly ok: false;
      readonly kind: "browser";
      readonly code: BlooketBrowserFailureCode;
    };

export type BlooketWriteVerificationBaselineResult =
  | {
      readonly ok: true;
      readonly baseline: BlooketWriteVerificationBaseline | null;
    }
  | BlooketWriteVerificationObservationFailure;

export type BlooketWriteVerificationResult =
  | {
      readonly ok: true;
      readonly outcome: "confirmed";
      readonly receipt: BlooketWriteReceipt | null;
    }
  | {
      readonly ok: true;
      readonly outcome: "not-confirmed";
    }
  | {
      readonly ok: true;
      readonly outcome: "inconclusive";
    }
  | BlooketWriteVerificationObservationFailure;

export interface BlooketWriteVerificationPort {
  captureBaseline(
    operation: BlooketWriteOperation,
    target: BlooketWriteTarget,
  ): Promise<BlooketWriteVerificationBaselineResult>;

  verify(
    operation: BlooketWriteOperation,
    target: BlooketWriteTarget,
    baseline: BlooketWriteVerificationBaseline | null,
  ): Promise<BlooketWriteVerificationResult>;
}
