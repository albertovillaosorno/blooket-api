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
//   - Verification of bounded image intake and gallery presentation.
// - Must-Not:
//   - Expose configuration through the online MCP gateway.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Verification of bounded image intake and gallery presentation.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import test from "node:test";
import assert from "node:assert/strict";
import { decodeImageSourceRequest } from
  "../../../../src/ir/image-intake/contract/request.ts";

test(
  "image intake rejects additional fields, coercion and unbounded URLs",
  () => {
  assert.equal(
    decodeImageSourceRequest({ url: "https://example.test/a.png" }),
    "https://example.test/a.png",
  );
  for (const value of [
    null,
    [],
    { url: 1 },
    { url: "x", path: "private" },
    { url: "x".repeat(4097) },
  ]) {
    assert.throws(() => decodeImageSourceRequest(value), /invalid-image-url/u);
  }
});
