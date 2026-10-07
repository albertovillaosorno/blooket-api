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
//   - Exact local image source request admission.
// - Must-Not:
//   - Coerce input, admit extra fields, or perform I/O.
// - Allows:
//   - Inputs: An untrusted local source document.
//   - Outputs: An admitted bounded URL string.
//   - Side effects: None.
// - Split-When:
//   - Intake adds another source variant.
// - Merge-When:
//   - The source contract becomes part of a broader versioned IR.
// - Summary:
//   - Admits only the URL field before host policy checks.
// - Description:
//   - Keeps unknown document fields outside application code.
// - Usage:
//   - Decode a CSRF-protected local image request.
// - Defaults:
//   - Malformed and oversized documents fail closed.
//
export function decodeImageSourceRequest(input: unknown): string {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).join() !== "url" ||
    !("url" in input) ||
    typeof input.url !== "string" ||
    input.url.length > 4096
  )
    throw new Error("invalid-image-url");
  return input.url;
}
