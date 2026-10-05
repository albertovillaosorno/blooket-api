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
//   - JSON syntax parsing for untrusted documents.
// - Must-Not:
//   - Validate document semantics or repair malformed model output.
// - Allows:
//   - Inputs: One UTF-8 JSON source string.
//   - Outputs: One parsed unknown value or one syntax failure.
//   - Side effects: None.
// - Split-When:
//   - Parsing acquires format-specific behavior beyond JSON syntax.
// - Merge-When:
//   - One transport becomes the sole owner of syntax parsing.
// - Summary:
//   - Parses untrusted untrusted JSON without semantic coercion.
// - Description:
//   - Uses the JavaScript runtime parser and preserves schema validation as a
//     separate step.
// - Usage:
//   - Parse first, then pass the unknown value to a versioned runtime decoder.
// - Defaults:
//   - Malformed JSON fails without recovery guesses.
//
export interface JsonParseFailure {
  readonly ok: false;
  readonly message: string;
}

export interface JsonParseSuccess {
  readonly ok: true;
  readonly value: unknown;
}

export type JsonParseResult = JsonParseFailure | JsonParseSuccess;

export function parseJson(source: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(source) as unknown };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    return { ok: false, message };
  }
}
