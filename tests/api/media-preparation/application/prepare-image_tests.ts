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
//   - Application tests for the shared image-preparation intake flow.
// - Must-Not:
//   - Write vault files or assume Blooket capability dimensions.
// - Allows:
//   - Inputs: Tiny image fixtures with explicit byte, pixel, and canvas limits.
//   - Outputs: Shared preparation success and stage-specific failure verdicts.
//   - Side effects: Native decoder/rendition work in the test process.
// - Split-When:
//   - Durable media import gains independent transaction fixtures.
// - Merge-When:
//   - Intake surfaces no longer share one image-preparation operation.
// - Summary:
//   - Verifies source admission happens before bounded rendition generation.
// - Description:
//   - Covers static success and fail-closed source/rendition paths.
// - Usage:
//   - Run whenever an intake surface or image limit contract changes.
// - Defaults:
//   - Test limits are tiny and explicit.
//
import assert from "node:assert/strict";
import test from "node:test";

import { prepareImage } from
  "../../../../src/api/media-preparation/application/prepare-image.ts";

const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPo"
    + "AAAD6AG1e1JrAAAADElEQVQImWNg+A+BAA/5A/2NJFz3AAAAAElFTkSuQmCC",
  "base64",
);

const LIMITS = {
  maxInputPixels: 16,
  maxOutputPixels: 64,
  maxOutputBytes: 16_384,
} as const;

test(
  "shared intake returns admitted source and exact rendition facts",
  async () => {
    const result = await prepareImage({
      bytes: PNG_2X1,
      maxSourceBytes: PNG_2X1.byteLength,
      canvas: { width: 4, height: 4 },
      renditionLimits: LIMITS,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.source.byteLength, PNG_2X1.byteLength);
      assert.equal(result.value.source.format.format, "png");
      assert.equal(result.value.rendition.width, 4);
      assert.equal(result.value.rendition.height, 4);
      assert.equal(result.value.rendition.format, "png");
    }
  },
);

test("source byte failures stop before rendition policy", async () => {
  assert.deepEqual(
    await prepareImage({
      bytes: PNG_2X1,
      maxSourceBytes: PNG_2X1.byteLength - 1,
      canvas: { width: 0, height: 0 },
      renditionLimits: {
        maxInputPixels: 0,
        maxOutputPixels: 0,
        maxOutputBytes: 0,
      },
    }),
    {
      ok: false,
      stage: "source",
      code: "source-image-too-large",
    },
  );
});

test("rendition failures retain their application stage", async () => {
  assert.deepEqual(
    await prepareImage({
      bytes: PNG_2X1,
      maxSourceBytes: PNG_2X1.byteLength,
      canvas: { width: 4, height: 4 },
      renditionLimits: {
        ...LIMITS,
        maxOutputBytes: 1,
      },
    }),
    {
      ok: false,
      stage: "rendition",
      code: "rendition-byte-limit-exceeded",
    },
  );
});
