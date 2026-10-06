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
//   - Non-sensitive durable baselines for post-attempt write verification.
// - Must-Not:
//   - Store remote content, credentials, cookies, or provider session state.
// - Allows:
//   - Inputs: Exact versioned count/digest candidates.
//   - Outputs: Validated set-list or question-list verification baselines.
//   - Side effects: None.
// - Split-When:
//   - Providers require incompatible baseline families.
// - Merge-When:
//   - Write recovery no longer compares pre/post provider collections.
// - Summary:
//   - Persists only collection cardinality and SHA-256 verification evidence.
// - Description:
//   - Provider adapters own canonicalization; this domain validates shape only.
// - Usage:
//   - Capture before mutation and pass unchanged to post-attempt verification.
// - Defaults:
//   - Unknown fields, wrong kinds, and malformed digests fail closed.
//
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";

export const BLOOKET_WRITE_VERIFICATION_BASELINE_VERSION = 1 as const;

export type BlooketWriteVerificationBaselineKind =
  | "set-list"
  | "question-list";

export interface BlooketWriteVerificationBaseline {
  readonly schemaVersion:
    typeof BLOOKET_WRITE_VERIFICATION_BASELINE_VERSION;
  readonly kind: BlooketWriteVerificationBaselineKind;
  readonly itemCount: number;
  readonly sha256: string;
}

const BASELINE_KEYS = new Set([
  "schemaVersion",
  "kind",
  "itemCount",
  "sha256",
]);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function decodeBlooketWriteVerificationBaseline(
  value: unknown,
  expectedKind?: BlooketWriteVerificationBaselineKind,
):
  | { readonly ok: true; readonly value: BlooketWriteVerificationBaseline }
  | {
      readonly ok: false;
      readonly issues: readonly ValidationIssue[];
    } {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "expected-object",
        message: "Expected a Blooket write verification baseline.",
      }],
    };
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, BASELINE_KEYS, "$"),
  ];
  const kind = value["kind"];
  const itemCount = value["itemCount"];
  const sha256 = value["sha256"];

  if (
    value["schemaVersion"]
    !== BLOOKET_WRITE_VERIFICATION_BASELINE_VERSION
  ) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected Blooket write verification baseline version 1.",
    });
  }
  if (kind !== "set-list" && kind !== "question-list") {
    issues.push({
      path: "$.kind",
      code: "invalid-verification-baseline-kind",
      message: 'Expected "set-list" or "question-list".',
    });
  } else if (expectedKind !== undefined && kind !== expectedKind) {
    issues.push({
      path: "$.kind",
      code: "verification-baseline-kind-mismatch",
      message: "Verification baseline does not match the write operation.",
    });
  }
  if (
    typeof itemCount !== "number"
    || !Number.isSafeInteger(itemCount)
    || itemCount < 0
  ) {
    issues.push({
      path: "$.itemCount",
      code: "invalid-verification-baseline-count",
      message: "Expected a non-negative safe integer item count.",
    });
  }
  if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) {
    issues.push({
      path: "$.sha256",
      code: "invalid-verification-baseline-digest",
      message: "Expected a lowercase SHA-256 digest.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  if (
    (kind !== "set-list" && kind !== "question-list")
    || typeof itemCount !== "number"
    || typeof sha256 !== "string"
  ) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "decoder-invariant",
        message: "Verification baseline decoder invariant failed.",
      }],
    };
  }

  return {
    ok: true,
    value: {
      schemaVersion: BLOOKET_WRITE_VERIFICATION_BASELINE_VERSION,
      kind,
      itemCount,
      sha256,
    },
  };
}

export function verificationBaselineKindForOperation(
  operationKind: "set" | "question",
): BlooketWriteVerificationBaselineKind {
  return operationKind === "set"
    ? "set-list"
    : "question-list";
}

export function frameBlooketWriteVerificationCollection(
  items: readonly string[],
): string {
  return JSON.stringify([
    BLOOKET_WRITE_VERIFICATION_BASELINE_VERSION,
    ...items,
  ]);
}
