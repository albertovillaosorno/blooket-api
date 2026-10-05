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
//   - Version-one command envelopes shared by CLI, HTTP, and MCP projection.
// - Must-Not:
//   - Execute commands or interpret product-specific payload fields.
// - Allows:
//   - Inputs: Unknown runtime command-envelope candidates.
//   - Outputs: Strictly validated generic command envelopes.
//   - Side effects: None.
// - Split-When:
//   - Result envelopes evolve independently from command envelopes.
// - Merge-When:
//   - Transport boundaries no longer share one versioned command format.
// - Summary:
//   - Defines and validates the canonical command wire envelope.
// - Description:
//   - Rejects unknown fields, unsupported versions, and invalid identifiers.
// - Usage:
//   - Decode before routing a command to an application executor.
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

export const COMMAND_ENVELOPE_VERSION = 1 as const;

export interface CommandEnvelope {
  readonly version: typeof COMMAND_ENVELOPE_VERSION;
  readonly operationId: string;
  readonly command: string;
  readonly payload: unknown;
}

const COMMAND_KEYS = new Set([
  "version",
  "operationId",
  "command",
  "payload",
]);
const COMMAND_NAME = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

export function decodeCommandEnvelope(
  value: unknown,
): DecodeResult<CommandEnvelope> {
  if (!isRecord(value)) {
    return decodeFailure("$", "expected-object", "Expected a command object.");
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, COMMAND_KEYS, "$"),
  ];

  if (value["version"] !== COMMAND_ENVELOPE_VERSION) {
    issues.push({
      path: "$.version",
      code: "unsupported-version",
      message: "Expected command envelope version 1.",
    });
  }

  const operationId = decodeOperationId(value["operationId"]);
  if (!operationId.ok) {
    issues.push(...operationId.issues);
  }

  const command = requiredString(value["command"], "$.command", issues);
  if (command !== undefined && !COMMAND_NAME.test(command)) {
    issues.push({
      path: "$.command",
      code: "invalid-command-name",
      message: "Expected a lowercase dotted or dashed command name.",
    });
  }

  if (!("payload" in value)) {
    issues.push({
      path: "$.payload",
      code: "missing-field",
      message: "Expected a payload field.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (!operationId.ok || command === undefined) {
    return decodeFailure("$", "decoder-invariant", "Decoder invariant failed.");
  }

  return {
    ok: true,
    value: {
      version: COMMAND_ENVELOPE_VERSION,
      operationId: operationId.value.value,
      command,
      payload: value["payload"],
    },
  };
}
