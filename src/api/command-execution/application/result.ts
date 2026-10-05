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
//   - Construction of canonical command result envelopes inside the API.
// - Must-Not:
//   - Validate operation IDs or serialize transport-specific output.
// - Allows:
//   - Inputs: Validated operation IDs, values, and validation issues.
//   - Outputs: Version-one success and failure result envelopes.
//   - Side effects: None.
// - Split-When:
//   - Success and failure result construction evolve independently.
// - Merge-When:
//   - Wire result envelopes stop being the API result boundary.
// - Summary:
//   - Centralizes result envelope construction for API operations.
// - Description:
//   - Keeps command handlers focused on their own payload semantics.
// - Usage:
//   - Return these envelopes from every command application function.
// - Defaults:
//   - Every failure preserves structured issues without textual flattening.
//
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  RESULT_ENVELOPE_VERSION,
  type ResultFailureEnvelope,
  type ResultSuccessEnvelope,
} from "../../../ir/wire-envelopes/contract/result-envelope.ts";

export function commandSuccess(
  operationId: string,
  value: unknown,
): ResultSuccessEnvelope {
  return {
    version: RESULT_ENVELOPE_VERSION,
    operationId,
    ok: true,
    value,
  };
}

export function commandFailure(
  operationId: string,
  issues: readonly ValidationIssue[],
): ResultFailureEnvelope {
  return {
    version: RESULT_ENVELOPE_VERSION,
    operationId,
    ok: false,
    issues,
  };
}
