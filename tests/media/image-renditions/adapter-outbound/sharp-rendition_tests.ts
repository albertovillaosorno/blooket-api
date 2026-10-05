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
//   - Integration tests for fixed-canvas Sharp working renditions.
// - Must-Not:
//   - Persist files or assume production Blooket dimensions.
// - Allows:
//   - Inputs: Tiny static PNG and two-frame GIF fixtures with explicit limits.
//   - Outputs: Canvas, format, animation, and fail-closed limit verdicts.
//   - Side effects: Native image processing in the test process.
// - Split-When:
//   - Editor transforms require separate fixture families.
// - Merge-When:
//   - Rendition generation no longer has a distinct media adapter.
// - Summary:
//   - Verifies static canvas fill, GIF preservation, and output ceilings.
// - Description:
//   - Re-decodes outputs to assert encoded facts rather than return claims.
// - Usage:
//   - Run on Linux and macOS after image-engine changes.
// - Defaults:
//   - Test canvases are deliberately tiny to bound resource use.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeSourceImage } from
  "../../../../src/media/image-decoding/adapter-outbound/sharp-image.ts";
import { renderImageRendition } from
  "../../../../src/media/image-renditions/adapter-outbound/sharp-rendition.ts";
import { loadSharp } from
  "../../../../src/media/sharp-runtime/adapter-outbound/sharp-runtime.ts";

const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPo"
    + "AAAD6AG1e1JrAAAADElEQVQImWNg+A+BAA/5A/2NJFz3AAAAAElFTkSuQmCC",
  "base64",
);

const GIF_2_FRAME_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwALAAAAAABAAEAAAIBTAA7",
  "base64",
);

const LIMITS = {
  maxInputPixels: 16,
  maxOutputPixels: 64,
  maxOutputBytes: 16_384,
} as const;

test("static sources render to exact PNG canvases", async () => {
  const rendered = await renderImageRendition(
    PNG_2X1,
    { width: 4, height: 4 },
    LIMITS,
  );
  assert.equal(rendered.ok, true);
  if (!rendered.ok) {
    return;
  }

  assert.equal(rendered.value.format, "png");
  assert.equal(rendered.value.animated, false);
  const decoded = await decodeSourceImage(rendered.value.bytes, 16);
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.value.frameWidth, 4);
    assert.equal(decoded.value.frameHeight, 4);
    assert.equal(decoded.value.frameCount, 1);
  }

  const sharp = await loadSharp();
  const pixels = await sharp(rendered.value.bytes).raw().toBuffer();
  assert.equal(pixels.byteLength, 4 * 4 * 4);
  for (let offset = 3; offset < pixels.byteLength; offset += 4) {
    assert.equal(pixels[offset], 255);
  }
});

test("animated GIF renditions preserve frames and timing", async () => {
  const rendered = await renderImageRendition(
    GIF_2_FRAME_1X1,
    { width: 2, height: 2 },
    LIMITS,
  );
  assert.equal(rendered.ok, true);
  if (!rendered.ok) {
    return;
  }

  assert.equal(rendered.value.format, "gif");
  assert.equal(rendered.value.frameCount, 2);
  assert.equal(rendered.value.animated, true);

  const decoded = await decodeSourceImage(rendered.value.bytes, 8);
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.value.frameWidth, 2);
    assert.equal(decoded.value.frameHeight, 2);
    assert.equal(decoded.value.frameCount, 2);
    assert.deepEqual(decoded.value.frameDelaysMs, [100, 100]);
    assert.equal(decoded.value.loopCount, 1);
  }
});

test("rendition output pixel and byte ceilings fail closed", async () => {
  assert.deepEqual(
    await renderImageRendition(
      PNG_2X1,
      { width: 4, height: 4 },
      { ...LIMITS, maxOutputPixels: 15 },
    ),
    { ok: false, code: "rendition-pixel-limit-exceeded" },
  );

  assert.deepEqual(
    await renderImageRendition(
      PNG_2X1,
      { width: 4, height: 4 },
      { ...LIMITS, maxOutputBytes: 1 },
    ),
    { ok: false, code: "rendition-byte-limit-exceeded" },
  );
});

test(
  "source decoder failures remain visible to rendition callers",
  async () => {
    assert.deepEqual(
      await renderImageRendition(
        Uint8Array.from([1, 2, 3, 4]),
        { width: 4, height: 4 },
        LIMITS,
      ),
      {
        ok: false,
        code: "rendition-failed",
        sourceCode: "unsupported-image-format",
      },
    );
  },
);

test("invalid canvas requests fail before native image work", async () => {
  assert.deepEqual(
    await renderImageRendition(
      PNG_2X1,
      { width: 0, height: 4 },
      LIMITS,
    ),
    { ok: false, code: "invalid-rendition-limits" },
  );
});
