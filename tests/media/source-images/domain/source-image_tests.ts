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
//   - Behavioral tests for source-image admission.
// - Must-Not:
//   - Decode pixels, write files, or guess Blooket capability limits.
// - Allows:
//   - Inputs: Small deterministic image signatures and explicit byte ceilings.
//   - Outputs: Stable admission and rejection verdicts.
//   - Side effects: None.
// - Split-When:
//   - Decoder metadata admission gains an independent contract.
// - Merge-When:
//   - Source-image admission no longer exists as a media-domain operation.
// - Summary:
//   - Verifies exact byte ceilings and signature-based format admission.
// - Description:
//   - Proves limits are caller-supplied rather than repository guesses.
// - Usage:
//   - Run for every change to media intake admission.
// - Defaults:
//   - Tiny fixtures exercise boundary behavior without binary assets.
//
import assert from "node:assert/strict";
import test from "node:test";

import { admitSourceImage } from
  "../../../../src/media/source-images/domain/source-image.ts";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

test("an image exactly at the byte ceiling is admitted", () => {
  assert.deepEqual(admitSourceImage(jpeg, jpeg.byteLength), {
    ok: true,
    value: {
      byteLength: 4,
      format: {
        format: "jpeg",
        mediaType: "image/jpeg",
        extension: ".jpg",
      },
    },
  });
});

test("oversized sources fail before decoder selection", () => {
  assert.deepEqual(admitSourceImage(jpeg, jpeg.byteLength - 1), {
    ok: false,
    code: "source-image-too-large",
    message: "Source image exceeds the configured byte limit.",
  });
});

test("unsupported bytes fail even when they fit the byte ceiling", () => {
  assert.deepEqual(admitSourceImage(Uint8Array.from([1, 2, 3]), 3), {
    ok: false,
    code: "unsupported-image-format",
    message: "Source bytes are not a supported image format.",
  });
});

test("invalid byte ceilings fail closed instead of disabling limits", () => {
  for (const maxBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = admitSourceImage(jpeg, maxBytes);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "invalid-byte-limit");
    }
  }
});
