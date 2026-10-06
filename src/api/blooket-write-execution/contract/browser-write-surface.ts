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
//   - Low-level browser submission methods for observed Blooket write forms.
// - Must-Not:
//   - Accept write plans, persist progress, retry, or infer unobserved success.
// - Allows:
//   - Inputs: Fully lowered provider submissions with unresolved media slots.
//   - Outputs: Confirmed form success, navigation stops, or browser failures.
//   - Side effects: At most one provider form mutation per method call.
// - Split-When:
//   - Create Set and Add Question need independent runtime implementations.
// - Merge-When:
//   - Browser writes stop using separate provider form surfaces.
// - Summary:
//   - Isolates DOM/form mechanics beneath semantic write lowering.
// - Description:
//   - Success means the browser observed the provider's success result.
// - Usage:
//   - Implement with verified page behavior and resolve media slots there.
// - Defaults:
//   - Missing confirmation must return a stop/failure, never success.
//
import type { ObservedBlooketNavigationStateKind } from
  "../../../ir/blooket-navigation/domain/navigation-state.ts";
import type {
  BlooketAddQuestionSubmission,
  BlooketCreateSetSubmission,
} from "../../../ir/blooket-write-submissions/contract/write-submission.ts";
import type { BlooketBrowserFailureCode } from
  "../../blooket-session/contract/browser-session.ts";

export type BlooketBrowserWriteSurfaceFailure =
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

export type BlooketCreateSetSurfaceResult =
  | {
      readonly ok: true;
      readonly remoteSetId: unknown;
    }
  | BlooketBrowserWriteSurfaceFailure;

export type BlooketAddQuestionSurfaceResult =
  | { readonly ok: true }
  | BlooketBrowserWriteSurfaceFailure;

export interface BlooketBrowserWriteSurfacePort {
  createSet(
    submission: BlooketCreateSetSubmission,
  ): Promise<BlooketCreateSetSurfaceResult>;

  addQuestion(
    submission: BlooketAddQuestionSubmission,
  ): Promise<BlooketAddQuestionSurfaceResult>;
}
