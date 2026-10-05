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
//   - Typed success and failure results for untrusted runtime values.
// - Must-Not:
//   - Parse JSON syntax or decide product-specific validation rules.
// - Allows:
//   - Inputs: Validation paths, codes, messages, and decoded values.
//   - Outputs: Immutable decode results and validation issues.
//   - Side effects: None.
// - Split-When:
//   - Decode failures need independently versioned transport metadata.
// - Merge-When:
//   - Runtime decoding no longer distinguishes success from validation failure.
// - Summary:
//   - Defines the common fail-closed runtime decoding result.
// - Description:
//   - Keeps validation diagnostics structured and transport-independent.
// - Usage:
//   - Return from every decoder that accepts unknown runtime input.
// - Defaults:
//   - Failures contain one or more explicit issues.
//
export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export function decodeFailure(
  path: string,
  code: string,
  message: string,
): DecodeResult<never> {
  return {
    ok: false,
    issues: [{ path, code, message }],
  };
}
