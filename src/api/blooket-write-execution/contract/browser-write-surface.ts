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
//   - Inputs: Lowered submissions plus the exact admitted prepared-media
//     snapshot for their stable-ID slots.
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
import type { BlooketPreparedMedia } from "./prepared-media.ts";

export type BlooketBrowserWriteSurfaceFailure =
  | {
      readonly ok: false;
      readonly kind: "navigation";
      readonly state: ObservedBlooketNavigationStateKind;
    }
  | {
      readonly ok: false;
      readonly kind: "browser";
      readonly code:
        | "blooket-browser-unavailable"
        | "blooket-browser-failed";
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
    media: readonly BlooketPreparedMedia[],
  ): Promise<BlooketCreateSetSurfaceResult>;

  addQuestion(
    submission: BlooketAddQuestionSubmission,
    media: readonly BlooketPreparedMedia[],
  ): Promise<BlooketAddQuestionSurfaceResult>;
}
