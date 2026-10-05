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
//   - Behavioral tests for the canonical media identifier grammar.
// - Must-Not:
//   - Resolve files or test media metadata records.
// - Allows:
//   - Inputs: Fixed media identifier candidates.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Identifier generation gains independent fixtures.
// - Merge-When:
//   - Stable media identifiers are removed.
// - Summary:
//   - Verifies one media ID grammar for every caller.
// - Description:
//   - Mirrors src/media/media-identifiers/domain/media-id.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Uppercase and path separators fail.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeMediaId } from
  "../../../../src/media/media-identifiers/domain/media-id.ts";

test("media IDs accept stable lowercase names", () => {
  assert.equal(decodeMediaId("yellow-bus.01").ok, true);
});

test("media IDs reject uppercase names", () => {
  assert.equal(decodeMediaId("Yellow-Bus").ok, false);
});

test("media IDs reject path separators", () => {
  assert.equal(decodeMediaId("images/yellow-bus").ok, false);
});
