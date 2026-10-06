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
//   - Browser-facing execution result shape for one planned Blooket operation.
// - Must-Not:
//   - Retry, sleep, persist checkpoints, or reinterpret write-plan semantics.
// - Allows:
//   - Inputs: One validated immutable Blooket write operation.
//   - Outputs: Confirmed success, observed navigation stop, or browser failure.
//   - Side effects: One remote set/question mutation attempt.
// - Split-When:
//   - Set and question mutations require independent adapter contracts.
// - Merge-When:
//   - Remote execution no longer consumes canonical write-plan operations.
// - Summary:
//   - Keeps one remote mutation attempt explicit and confirmation-based.
// - Description:
//   - Navigation outcomes preserve recovery facts without guessing retries.
// - Usage:
//   - Implement in the concrete browser adapter; success means confirmed write.
// - Defaults:
//   - An unconfirmed attempt never advances a checkpoint.
//
import type { ObservedBlooketNavigationStateKind } from
  "../../../ir/blooket-navigation/domain/navigation-state.ts";
import type { BlooketWriteReceipt } from
  "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketWriteOperation } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type { BlooketBrowserFailureCode } from
  "../../blooket-session/contract/browser-session.ts";

export interface BlooketWriteTarget {
  readonly remoteSetId: string | null;
}

export type BlooketWriteAttemptResult =
  | {
      readonly ok: true;
      readonly receipt: BlooketWriteReceipt | null;
    }
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

export interface BlooketWriteExecutionPort {
  execute(
    operation: BlooketWriteOperation,
    target: BlooketWriteTarget,
  ): Promise<BlooketWriteAttemptResult>;
}
