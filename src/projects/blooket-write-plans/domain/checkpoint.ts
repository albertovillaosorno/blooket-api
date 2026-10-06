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
//   - Versioned sequential progress checkpoints for immutable write plans.
// - Must-Not:
//   - Execute operations, persist checkpoints, or skip failed plan steps.
// - Allows:
//   - Inputs: Unknown checkpoints and confirmed operation IDs.
//   - Outputs: Validated progress, next operations, or stable failures.
//   - Side effects: None.
// - Split-When:
//   - Parallel write execution requires non-sequential progress semantics.
// - Merge-When:
//   - Write plans no longer support resumable execution.
// - Summary:
//   - Resumes only against the exact plan and exact next operation identity.
// - Description:
//   - A monotonically increasing index makes incomplete progress explicit.
// - Usage:
//   - Persist after a remote operation is confirmed successful.
// - Defaults:
//   - New checkpoints start before operation zero.
//
import {
  type DecodeResult,
  type ValidationIssue,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";
import type {
  BlooketWriteOperation,
  BlooketWritePlan,
} from "./write-plan.ts";

export const BLOOKET_WRITE_CHECKPOINT_VERSION = 1 as const;

export interface BlooketWriteCheckpoint {
  readonly schemaVersion: typeof BLOOKET_WRITE_CHECKPOINT_VERSION;
  readonly planId: string;
  readonly nextOperationIndex: number;
}

const CHECKPOINT_KEYS = new Set([
  "schemaVersion",
  "planId",
  "nextOperationIndex",
]);

export function initialBlooketWriteCheckpoint(
  plan: BlooketWritePlan,
): BlooketWriteCheckpoint {
  return {
    schemaVersion: BLOOKET_WRITE_CHECKPOINT_VERSION,
    planId: plan.planId,
    nextOperationIndex: 0,
  };
}

export function decodeBlooketWriteCheckpoint(
  value: unknown,
  plan: BlooketWritePlan,
): DecodeResult<BlooketWriteCheckpoint> {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "expected-object",
        message: "Expected a Blooket write checkpoint.",
      }],
    };
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, CHECKPOINT_KEYS, "$"),
  ];
  const planId = requiredString(
    value["planId"],
    "$.planId",
    issues,
  );
  const nextOperationIndex = value["nextOperationIndex"];

  if (value["schemaVersion"] !== BLOOKET_WRITE_CHECKPOINT_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected Blooket write checkpoint version 1.",
    });
  }
  if (planId !== undefined && planId !== plan.planId) {
    issues.push({
      path: "$.planId",
      code: "write-plan-mismatch",
      message: "Checkpoint belongs to a different write plan.",
    });
  }
  if (
    typeof nextOperationIndex !== "number"
    || !Number.isSafeInteger(nextOperationIndex)
    || nextOperationIndex < 0
    || nextOperationIndex > plan.operations.length
  ) {
    issues.push({
      path: "$.nextOperationIndex",
      code: "invalid-checkpoint-index",
      message: "Expected a completed operation boundary.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  if (
    planId === undefined
    || typeof nextOperationIndex !== "number"
  ) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "decoder-invariant",
        message: "Decoder invariant failed.",
      }],
    };
  }

  return {
    ok: true,
    value: {
      schemaVersion: BLOOKET_WRITE_CHECKPOINT_VERSION,
      planId,
      nextOperationIndex,
    },
  };
}

export function nextBlooketWriteOperation(
  plan: BlooketWritePlan,
  checkpoint: BlooketWriteCheckpoint,
): BlooketWriteOperation | null {
  if (checkpoint.planId !== plan.planId) {
    return null;
  }
  return plan.operations[checkpoint.nextOperationIndex] ?? null;
}

export type AdvanceBlooketWriteCheckpointResult =
  | {
      readonly ok: true;
      readonly value: BlooketWriteCheckpoint;
    }
  | {
      readonly ok: false;
      readonly code:
        | "write-plan-mismatch"
        | "write-plan-complete"
        | "unexpected-operation";
    };

export function advanceBlooketWriteCheckpoint(
  plan: BlooketWritePlan,
  checkpoint: BlooketWriteCheckpoint,
  completedOperationId: string,
): AdvanceBlooketWriteCheckpointResult {
  if (checkpoint.planId !== plan.planId) {
    return { ok: false, code: "write-plan-mismatch" };
  }
  const next = plan.operations[checkpoint.nextOperationIndex];
  if (next === undefined) {
    return { ok: false, code: "write-plan-complete" };
  }
  if (next.operationId !== completedOperationId) {
    return { ok: false, code: "unexpected-operation" };
  }

  return {
    ok: true,
    value: {
      ...checkpoint,
      nextOperationIndex: checkpoint.nextOperationIndex + 1,
    },
  };
}
