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
//   - Version-one result envelopes shared by CLI, HTTP, and MCP projection.
// - Must-Not:
//   - Interpret command-specific values or hide validation failures.
// - Allows:
//   - Inputs: Unknown runtime result-envelope candidates.
//   - Outputs: Strict success or failure result envelopes.
//   - Side effects: None.
// - Split-When:
//   - Failure diagnostics need an independently versioned wire format.
// - Merge-When:
//   - Transport boundaries no longer share one result format.
// - Summary:
//   - Defines and validates the canonical result wire envelope.
// - Description:
//   - Preserves operation correlation and structured validation issues.
// - Usage:
//   - Decode machine-readable results before adapting them to a transport.
// - Defaults:
//   - Schema version one is the only admitted version.
//
import { decodeOperationId } from
  "../../operation-identifiers/domain/operation-id.ts";
import {
  decodeFailure,
  type DecodeResult,
  type ValidationIssue,
} from "../../runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../runtime-decoding/domain/exact-object.ts";

export const RESULT_ENVELOPE_VERSION = 1 as const;

export type ResultEnvelope = ResultSuccessEnvelope | ResultFailureEnvelope;

export interface ResultSuccessEnvelope {
  readonly version: typeof RESULT_ENVELOPE_VERSION;
  readonly operationId: string;
  readonly ok: true;
  readonly value: unknown;
}

export interface ResultFailureEnvelope {
  readonly version: typeof RESULT_ENVELOPE_VERSION;
  readonly operationId: string;
  readonly ok: false;
  readonly issues: readonly ValidationIssue[];
}

const SUCCESS_KEYS = new Set(["version", "operationId", "ok", "value"]);
const FAILURE_KEYS = new Set(["version", "operationId", "ok", "issues"]);
const ISSUE_KEYS = new Set(["path", "code", "message"]);

export function decodeResultEnvelope(
  value: unknown,
): DecodeResult<ResultEnvelope> {
  if (!isRecord(value)) {
    return decodeFailure("$", "expected-object", "Expected a result object.");
  }

  if (value["ok"] === true) {
    return decodeSuccess(value);
  }

  if (value["ok"] === false) {
    return decodeFailureEnvelope(value);
  }

  return decodeFailure("$.ok", "expected-boolean", "Expected true or false.");
}

function decodeSuccess(
  value: Readonly<Record<string, unknown>>,
): DecodeResult<ResultSuccessEnvelope> {
  const issues = commonIssues(value, SUCCESS_KEYS);
  if (!("value" in value)) {
    issues.push({
      path: "$.value",
      code: "missing-field",
      message: "Expected a value field.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const operationId = decodeOperationId(value["operationId"]);
  if (!operationId.ok) {
    return operationId;
  }

  return {
    ok: true,
    value: {
      version: RESULT_ENVELOPE_VERSION,
      operationId: operationId.value["value"],
      ok: true,
      value: value["value"],
    },
  };
}

function decodeFailureEnvelope(
  value: Readonly<Record<string, unknown>>,
): DecodeResult<ResultFailureEnvelope> {
  const issues = commonIssues(value, FAILURE_KEYS);
  const decodedIssues = decodeIssues(value["issues"], issues);

  if (issues.length > 0 || decodedIssues === undefined) {
    return { ok: false, issues };
  }

  const operationId = decodeOperationId(value["operationId"]);
  if (!operationId.ok) {
    return operationId;
  }

  return {
    ok: true,
    value: {
      version: RESULT_ENVELOPE_VERSION,
      operationId: operationId.value["value"],
      ok: false,
      issues: decodedIssues,
    },
  };
}

function commonIssues(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [...unknownFieldIssues(value, keys, "$")];
  if (value["version"] !== RESULT_ENVELOPE_VERSION) {
    issues.push({
      path: "$.version",
      code: "unsupported-version",
      message: "Expected result envelope version 1.",
    });
  }

  const operationId = decodeOperationId(value["operationId"]);
  if (!operationId.ok) {
    issues.push(...operationId.issues);
  }
  return issues;
}

function decodeIssues(
  value: unknown,
  parentIssues: ValidationIssue[],
): readonly ValidationIssue[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    parentIssues.push({
      path: "$.issues",
      code: "expected-issues",
      message: "Expected a non-empty issue array.",
    });
    return undefined;
  }

  const decoded: ValidationIssue[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `$.issues[${index}]`;
    if (!isRecord(candidate)) {
      parentIssues.push({
        path,
        code: "expected-object",
        message: "Expected an issue object.",
      });
      continue;
    }

    parentIssues.push(...unknownFieldIssues(candidate, ISSUE_KEYS, path));
    const issuePath = requiredString(
      candidate["path"],
      `${path}.path`,
      parentIssues,
    );
    const code = requiredString(
      candidate["code"],
      `${path}.code`,
      parentIssues,
    );
    const message = requiredString(
      candidate["message"],
      `${path}.message`,
      parentIssues,
    );

    if (
      issuePath !== undefined
      && code !== undefined
      && message !== undefined
    ) {
      decoded.push({ path: issuePath, code, message });
    }
  }

  return decoded;
}
