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
//   - Canonical structured diagnostic events after secret redaction.
// - Must-Not:
//   - Accept arbitrary human messages, persist logs, or expose raw exceptions.
// - Allows:
//   - Inputs: Stable codes, levels, operation IDs, timestamps, and fields.
//   - Outputs: Versioned redacted events and canonical JSON Lines text.
//   - Side effects: None.
// - Split-When:
//   - Persistent log sinks require independently versioned retention behavior.
// - Merge-When:
//   - Diagnostics stop crossing process or persistence boundaries.
// - Summary:
//   - Defines a no-secret observability event that callers can safely
//     serialize.
// - Description:
//   - Omits free-form messages so exception text cannot bypass field redaction.
// - Usage:
//   - Build events before writing diagnostics to stderr, files, or telemetry.
// - Defaults:
//   - Fields are always passed through diagnostic redaction before emission.
//
import {
  decodeFailure,
  type DecodeResult,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";
import { decodeOperationId } from
  "../../../ir/operation-identifiers/domain/operation-id.ts";
import {
  redactDiagnosticValue,
  type RedactedDiagnosticValue,
} from "../../diagnostic-redaction/domain/redacted-value.ts";

export const DIAGNOSTIC_EVENT_VERSION = 1 as const;

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export interface DiagnosticEvent {
  readonly version: typeof DIAGNOSTIC_EVENT_VERSION;
  readonly at: string;
  readonly level: DiagnosticLevel;
  readonly code: string;
  readonly operationId: string | null;
  readonly fields: RedactedDiagnosticValue;
}

export interface DiagnosticEventInput {
  readonly at: string;
  readonly level: DiagnosticLevel;
  readonly code: string;
  readonly operationId?: string | null;
  readonly fields?: unknown;
}

const DIAGNOSTIC_CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export function createDiagnosticEvent(
  input: DiagnosticEventInput,
): DecodeResult<DiagnosticEvent> {
  if (!UTC_INSTANT.test(input.at) || !Number.isFinite(Date.parse(input.at))) {
    return decodeFailure(
      "$.at",
      "invalid-diagnostic-time",
      "Expected a valid UTC RFC 3339 instant.",
    );
  }

  if (!DIAGNOSTIC_CODE.test(input.code)) {
    return decodeFailure(
      "$.code",
      "invalid-diagnostic-code",
      "Expected a lowercase stable diagnostic code.",
    );
  }

  const operationId = input.operationId ?? null;
  if (operationId !== null) {
    const decoded = decodeOperationId(operationId, "$.operationId");
    if (!decoded.ok) {
      return decoded;
    }
  }

  return {
    ok: true,
    value: {
      version: DIAGNOSTIC_EVENT_VERSION,
      at: input.at,
      level: input.level,
      code: input.code,
      operationId,
      fields: redactDiagnosticValue(input.fields ?? {}),
    },
  };
}

export function serializeDiagnosticEvent(event: DiagnosticEvent): string {
  return `${JSON.stringify(event)}\n`;
}
