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
//   - Canonical operation identifiers shared by every transport.
// - Must-Not:
//   - Generate randomness, persist state, or infer caller identity.
// - Allows:
//   - Inputs: Unknown candidate operation identifier values.
//   - Outputs: Validated operation identifiers or structured failures.
//   - Side effects: None.
// - Split-When:
//   - Identifier generation becomes a separate application capability.
// - Merge-When:
//   - Operations no longer need stable cross-transport correlation.
// - Summary:
//   - Validates compact stable operation identifiers.
// - Description:
//   - Admits lowercase ASCII identifiers safe for logs and wire envelopes.
// - Usage:
//   - Validate before an operation crosses an application boundary.
// - Defaults:
//   - Values are limited to 128 characters.
//
import {
  decodeFailure,
  type DecodeResult,
} from "../../runtime-decoding/domain/decode-result.ts";

export interface OperationId {
  readonly value: string;
}

const OPERATION_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,127})$/u;

export function decodeOperationId(
  value: unknown,
  path = "$.operationId",
): DecodeResult<OperationId> {
  if (typeof value !== "string") {
    return decodeFailure(path, "expected-operation-id", "Expected a string.");
  }

  if (!OPERATION_ID.test(value)) {
    return decodeFailure(
      path,
      "invalid-operation-id",
      "Expected 1-128 lowercase ASCII identifier characters.",
    );
  }

  return { ok: true, value: { value } };
}
