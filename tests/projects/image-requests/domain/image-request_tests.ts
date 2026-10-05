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
//   - Behavioral tests for project image-request decoding.
// - Must-Not:
//   - Resolve media IDs or inspect image bytes.
// - Allows:
//   - Inputs: Fixed resolved and unresolved image fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Resolved and unresolved image contracts diverge.
// - Merge-When:
//   - Project image requests cease to exist.
// - Summary:
//   - Verifies strict image requirements and media references.
// - Description:
//   - Mirrors src/projects/image-requests/domain/image-request.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Null media IDs remain valid unresolved requests.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeImageRequest } from
  "../../../../src/projects/image-requests/domain/image-request.ts";

test("image requests may remain unresolved", () => {
  const result = decodeImageRequest({
    description: "A yellow school bus viewed from the side.",
    mediaId: null,
  });

  assert.equal(result.ok, true);
});

test("image requests accept validated media IDs", () => {
  const result = decodeImageRequest({
    description: "A yellow school bus viewed from the side.",
    mediaId: "yellow-bus",
  });

  assert.equal(result.ok, true);
});

test("image requests reject invented metadata fields", () => {
  const result = decodeImageRequest({
    description: "A yellow school bus viewed from the side.",
    mediaId: null,
    url: "https://example.com/image.jpg",
  });

  assert.equal(result.ok, false);
});
