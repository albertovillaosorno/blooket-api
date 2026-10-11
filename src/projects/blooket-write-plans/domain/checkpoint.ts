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
import { decodeBlooketSetId } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";
import type {
  BlooketWriteOperation,
  BlooketWritePlan,
} from "./write-plan.ts";

export const BLOOKET_WRITE_CHECKPOINT_VERSION = 2 as const;
const LEGACY_BLOOKET_WRITE_CHECKPOINT_VERSION = 1 as const;

export interface BlooketSetWriteReceipt {
  readonly kind: "set-created";
  readonly remoteSetId: string;
}

export type BlooketWriteReceipt = BlooketSetWriteReceipt;

export interface BlooketWriteCheckpoint {
  readonly schemaVersion: typeof BLOOKET_WRITE_CHECKPOINT_VERSION;
  readonly planId: string;
  readonly nextOperationIndex: number;
  readonly remoteSetId: string | null;
}

const LEGACY_CHECKPOINT_KEYS = new Set([
  "schemaVersion",
  "planId",
  "nextOperationIndex",
]);
const CHECKPOINT_KEYS = new Set([
  ...LEGACY_CHECKPOINT_KEYS,
  "remoteSetId",
]);
const RECEIPT_KEYS = new Set(["kind", "remoteSetId"]);

export function initialBlooketWriteCheckpoint(
  plan: BlooketWritePlan,
): BlooketWriteCheckpoint {
  return {
    schemaVersion: BLOOKET_WRITE_CHECKPOINT_VERSION,
    planId: plan.planId,
    nextOperationIndex: 0,
    remoteSetId: null,
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

  const inputVersion = value["schemaVersion"];
  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(
      value,
      inputVersion === LEGACY_BLOOKET_WRITE_CHECKPOINT_VERSION
        ? LEGACY_CHECKPOINT_KEYS
        : CHECKPOINT_KEYS,
      "$",
    ),
  ];
  const planId = requiredString(
    value["planId"],
    "$.planId",
    issues,
  );
  const nextOperationIndex = value["nextOperationIndex"];
  const remoteSetId = inputVersion === LEGACY_BLOOKET_WRITE_CHECKPOINT_VERSION
    ? null
    : decodeNullableRemoteSetId(
        value["remoteSetId"],
        "$.remoteSetId",
        issues,
      );

  if (
    inputVersion !== LEGACY_BLOOKET_WRITE_CHECKPOINT_VERSION
    && inputVersion !== BLOOKET_WRITE_CHECKPOINT_VERSION
  ) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected Blooket write checkpoint version 1 or 2.",
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
  if (
    typeof nextOperationIndex === "number"
    && Number.isSafeInteger(nextOperationIndex)
    && nextOperationIndex === 0
    && remoteSetId !== null
    && remoteSetId !== undefined
  ) {
    issues.push({
      path: "$.remoteSetId",
      code: "unexpected-remote-set-binding",
      message: "A fresh checkpoint cannot already target a remote set.",
    });
  }
  if (
    typeof nextOperationIndex === "number"
    && Number.isSafeInteger(nextOperationIndex)
    && nextOperationIndex > 0
    && remoteSetId === null
  ) {
    issues.push({
      path: "$.remoteSetId",
      code: "missing-remote-set-binding",
      message: "Advanced progress requires the created remote set ID.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  if (
    planId === undefined
    || typeof nextOperationIndex !== "number"
    || remoteSetId === undefined
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
      remoteSetId,
    },
  };
}

export type NextBlooketWriteOperationResult =
  | {
      readonly ok: true;
      readonly operation: BlooketWriteOperation | null;
    }
  | {
      readonly ok: false;
      readonly code: "write-plan-mismatch";
    };

export function nextBlooketWriteOperation(
  plan: BlooketWritePlan,
  checkpoint: BlooketWriteCheckpoint,
): NextBlooketWriteOperationResult {
  if (checkpoint.planId !== plan.planId) {
    return { ok: false, code: "write-plan-mismatch" };
  }
  return {
    ok: true,
    operation: plan.operations[checkpoint.nextOperationIndex] ?? null,
  };
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
        | "unexpected-operation"
        | "missing-set-receipt"
        | "missing-remote-set-binding"
        | "unexpected-write-receipt";
    };

export function advanceBlooketWriteCheckpoint(
  plan: BlooketWritePlan,
  checkpoint: BlooketWriteCheckpoint,
  completedOperationId: string,
  receipt: BlooketWriteReceipt | null,
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

  if (next.kind === "set") {
    if (receipt === null || !isRemoteSetId(receipt.remoteSetId)) {
      return { ok: false, code: "missing-set-receipt" };
    }
    return {
      ok: true,
      value: {
        ...checkpoint,
        nextOperationIndex: checkpoint.nextOperationIndex + 1,
        remoteSetId: receipt.remoteSetId,
      },
    };
  }

  if (checkpoint.remoteSetId === null) {
    return { ok: false, code: "missing-remote-set-binding" };
  }
  if (receipt !== null) {
    return { ok: false, code: "unexpected-write-receipt" };
  }
  return {
    ok: true,
    value: {
      ...checkpoint,
      nextOperationIndex: checkpoint.nextOperationIndex + 1,
    },
  };
}

export function decodeBlooketWriteReceipt(
  value: unknown,
  path = "$.receipt",
): DecodeResult<BlooketWriteReceipt> {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path,
        code: "expected-object",
        message: "Expected a Blooket write receipt.",
      }],
    };
  }
  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, RECEIPT_KEYS, path),
  ];
  const remoteSetId = requiredString(
    value["remoteSetId"],
    path + ".remoteSetId",
    issues,
  );
  if (remoteSetId !== undefined) {
    const decoded = decodeBlooketSetId(remoteSetId,
      path + ".remoteSetId");
    if (!decoded.ok) issues.push(...decoded.issues);
  }
  if (value["kind"] !== "set-created") {
    issues.push({
      path: path + ".kind",
      code: "invalid-write-receipt-kind",
      message: 'Expected "set-created".',
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  if (remoteSetId === undefined) {
    return {
      ok: false,
      issues: [{
        path,
        code: "decoder-invariant",
        message: "Write receipt decoder invariant failed.",
      }],
    };
  }
  return {
    ok: true,
    value: { kind: "set-created", remoteSetId },
  };
}

function decodeNullableRemoteSetId(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | null | undefined {
  if (value === null) {
    return null;
  }
  const id = decodeBlooketSetId(value, path);
  if (!id.ok) {
    issues.push(...id.issues);
    return undefined;
  }
  return id.value;
}

function isRemoteSetId(value: unknown): value is string {
  return decodeBlooketSetId(value).ok;
}
