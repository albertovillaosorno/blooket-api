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
//   - Regression evidence for the strict prepared-media byte ceiling.
// - Must-Not:
//   - Decode or encode image fixtures.
// - Allows:
//   - Inputs: Boundary byte counts.
//   - Outputs: Exact admission assertions.
//   - Side effects: None.
// - Split-When:
//   - A provider-specific ceiling requires separate evidence.
// - Merge-When:
//   - The strict ceiling is removed.
// - Summary:
//   - Proves 2,500,000 bytes exactly is rejected.
// - Description:
//   - Exercises the canonical portable prepared-media size policy.
// - Usage:
//   - Run with the repository Node test suite.
// - Defaults:
//   - Positive safe integers below the ceiling are admitted.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PREPARED_MEDIA_BYTES,
  PREPARED_MEDIA_BYTE_CEILING,
  preparedMediaBytesAdmitted,
} from "../../../../src/media/rendition-optimization/domain/limits.ts";

test("prepared media uses one exclusive 2,500,000 byte ceiling", () => {
  assert.equal(PREPARED_MEDIA_BYTE_CEILING, 2_500_000);
  assert.equal(MAX_PREPARED_MEDIA_BYTES, 2_499_999);
  assert.equal(preparedMediaBytesAdmitted(1), true);
  assert.equal(preparedMediaBytesAdmitted(2_499_999), true);
  assert.equal(preparedMediaBytesAdmitted(2_500_000), false);
  assert.equal(preparedMediaBytesAdmitted(0), false);
  assert.equal(preparedMediaBytesAdmitted(1.5), false);
  assert.equal(preparedMediaBytesAdmitted(Number.NaN), false);
});
