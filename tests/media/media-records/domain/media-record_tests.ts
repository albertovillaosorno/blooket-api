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
//   - Behavioral tests for strict media-record decoding.
// - Must-Not:
//   - Decode image bytes or test media transformations.
// - Allows:
//   - Inputs: Fixed media metadata fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Media path and metadata validation require independent fixtures.
// - Merge-When:
//   - Media records cease to exist as a separate contract.
// - Summary:
//   - Verifies minimal media metadata and local path safety.
// - Description:
//   - Mirrors src/media/media-records/domain/media-record.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Source URLs and unknown fields are rejected.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeMediaRecord } from
  "../../../../src/media/media-records/domain/media-record.ts";

const valid = {
  id: "yellow-bus",
  path: "images/yellow-bus.avif",
  description: "A yellow school bus viewed from the side.",
  english: false,
};

test("media records accept the minimal exact contract", () => {
  assert.equal(decodeMediaRecord(valid).ok, true);
});

test("media records reject source URLs", () => {
  const result = decodeMediaRecord({
    ...valid,
    url: "https://example.com/yellow-bus.avif",
  });

  assert.equal(result.ok, false);
});

test("media records reject parent path traversal", () => {
  const result = decodeMediaRecord({ ...valid, path: "../secret.jpg" });

  assert.equal(result.ok, false);
});

test("media records require explicit English verification state", () => {
  const { english: _english, ...missingEnglish } = valid;

  assert.equal(decodeMediaRecord(missingEnglish).ok, false);
});
