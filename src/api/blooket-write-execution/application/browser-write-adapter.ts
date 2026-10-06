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
//   - Adaptation from canonical write execution to browser form submissions.
// - Must-Not:
//   - Persist progress, inspect DOM, resolve media, retry, or bypass stops.
// - Allows:
//   - Inputs: Browser write surface plus canonical operation/target calls.
//   - Outputs: The existing confirmed write-attempt contract.
//   - Side effects: Delegates at most one browser form mutation to the surface.
// - Split-When:
//   - Browser surface outcomes need provider-specific recovery policies.
// - Merge-When:
//   - The canonical write port directly consumes provider submissions.
// - Summary:
//   - Lowers one write and converts confirmed browser outcomes to receipts.
// - Description:
//   - Create Set IDs are decoded again before they become durable receipts.
// - Usage:
//   - Wrap a verified concrete browser surface for persisted execution.
// - Defaults:
//   - Lowering, malformed success data, and exceptions fail closed.
//
import { decodeBlooketSetId } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";
import type {
  BlooketAddQuestionSubmission,
  BlooketCreateSetSubmission,
} from "../../../ir/blooket-write-submissions/contract/write-submission.ts";
import type {
  BlooketWriteAttemptResult,
  BlooketWriteExecutionPort,
} from "../contract/write-execution.ts";
import type {
  BlooketAddQuestionSurfaceResult,
  BlooketBrowserWriteSurfacePort,
  BlooketCreateSetSurfaceResult,
} from "../contract/browser-write-surface.ts";
import { lowerBlooketWriteSubmission } from "./lower-submission.ts";

export function blooketBrowserWriteExecutionPort(
  surface: BlooketBrowserWriteSurfacePort,
): BlooketWriteExecutionPort {
  return {
    execute: async (operation, target) => {
      const lowered = lowerBlooketWriteSubmission(operation, target);
      if (!lowered.ok) {
        return browserFailure();
      }

      try {
        if (lowered.value.kind === "create-set") {
          return await executeCreateSet(surface, lowered.value);
        }
        return await executeAddQuestion(surface, lowered.value);
      } catch {
        return browserFailure();
      }
    },
  };
}

async function executeCreateSet(
  surface: BlooketBrowserWriteSurfacePort,
  submission: BlooketCreateSetSubmission,
): Promise<BlooketWriteAttemptResult> {
  const result = await surface.createSet(submission);
  if (!result.ok) {
    return preserveFailure(result);
  }

  const decoded = decodeBlooketSetId(result.remoteSetId, "$.remoteSetId");
  if (!decoded.ok) {
    return browserFailure();
  }
  return {
    ok: true,
    receipt: {
      kind: "set-created",
      remoteSetId: decoded.value,
    },
  };
}

async function executeAddQuestion(
  surface: BlooketBrowserWriteSurfacePort,
  submission: BlooketAddQuestionSubmission,
): Promise<BlooketWriteAttemptResult> {
  const result = await surface.addQuestion(submission);
  return result.ok
    ? { ok: true, receipt: null }
    : preserveFailure(result);
}

function preserveFailure(
  result:
    | Exclude<BlooketCreateSetSurfaceResult, { readonly ok: true }>
    | Exclude<BlooketAddQuestionSurfaceResult, { readonly ok: true }>,
): BlooketWriteAttemptResult {
  return result;
}

function browserFailure(): BlooketWriteAttemptResult {
  return {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  };
}
