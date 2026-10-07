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
//   - Pixel-level integration tests for static media-editor Sharp rendering.
// - Must-Not:
//   - Persist vault files or assume production Blooket media limits.
// - Allows:
//   - Inputs: Tiny static and animated fixtures plus explicit editor settings.
//   - Outputs: Pixel, format, resource-limit, and refusal verdicts.
//   - Side effects: Bounded native image processing in the test process.
// - Split-When:
//   - Animated editor rendering gains independent fixture coverage.
// - Merge-When:
//   - Edited and base rendition adapters become one operation.
// - Summary:
//   - Covers geometry, tonal edits, blur, redaction, limits, and animation.
// - Description:
//   - Re-decodes rendered pixels so tests verify bytes rather than claims.
// - Usage:
//   - Run after editor-state, layout, or Sharp adapter changes.
// - Defaults:
//   - Fixtures are tiny and all blur strength and limits are explicit.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  renderEditedImageRendition,
  renderOptimizedImageRendition,
} from "../../../../src/media/image-renditions/adapter-outbound/edit.ts";
import { loadSharp } from
  "../../../../src/media/sharp-runtime/adapter-outbound/sharp-runtime.ts";
import { type MediaEditorState } from
  "../../../../src/media/editor-state/domain/editor-state.ts";

const COLOR_2X2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPo" +
    "AAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwHwwZGP6DAQBJyAn3iFfyTAAAAA" +
    "BJRU5ErkJggg==",
  "base64",
);

const GRADIENT_4X4 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPo" +
    "AAAD6AG1e1JrAAAASElEQVQImQXBgQAAIAxFwY8QwhBCCCGEIYQQQgghhB" +
    "BCCEOYwetOkiilYGbUWlFrjd477s4YA805WWux9+acg+69vPeICDKTDwC4" +
    "JnFMdMGmAAAAAElFTkSuQmCC",
  "base64",
);

const GIF_2_FRAME_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwALAAAAA" + "ABAAEAAAIBTAA7",
  "base64",
);

const GIF_2_FRAME_2X2 = Buffer.from(
  "R0lGODlhAgACAIIAAExpcQD/AP8AAP///wAA/wAAAAAAAAAAAC" +
    "H/C05FVFNDQVBF" +
    "Mi4wAwEBAAAh+QQFCAAAACwAAAAAAgACAAADAyhBkwAh+QQFDgAAACwAAAAAAg" +
    "ACAIJMaXH//wAAAAAA////AP8AAAAAAAAAAAADAygxlAA7",
  "base64",
);

const LIMITS = {
  maxInputPixels: 128,
  maxOutputPixels: 128,
  maxOutputBytes: 65_536,
} as const;

function state(
  overrides: Partial<MediaEditorState["transform"]> = {},
  regions: MediaEditorState["regions"] = [],
): MediaEditorState {
  return {
    name: "fixture",
    description: "A fixture.",
    transform: {
      panX: 0,
      panY: 0,
      zoom: 1,
      contrast: 1,
      saturation: 1,
      ...overrides,
    },
    regions,
  };
}

async function rawPixels(bytes: Uint8Array): Promise<Uint8Array> {
  const sharp = await loadSharp();
  return await sharp(bytes).raw().toBuffer();
}

async function detailedFixture(): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const width = 96;
  const height = 96;
  const raw = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = (x * 37 + y * 17) % 256;
      raw[offset + 1] = (x * 13 + y * 53) % 256;
      raw[offset + 2] = (x * 71 + y * 29) % 256;
      raw[offset + 3] = 255;
    }
  return await sharp(raw, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function candidateBytes(
  source: Uint8Array,
  detailScale: number,
  compression: "lossless" | "compact",
): Promise<number> {
  const rendered = await renderEditedImageRendition(
    source,
    state(),
    { width: 96, height: 96 },
    {
      maxInputPixels: 1_000_000,
      maxOutputPixels: 1_000_000,
      maxOutputBytes: 1_000_000,
    },
    {
      blurSigma: 20,
      detailScale,
      compression,
      background: { mode: "solid", color: "#ffffff" },
    },
  );
  assert.ok(rendered.ok);
  return rendered.ok ? rendered.value.bytes.length : 0;
}

test("neutral editor rendering preserves equal-canvas pixels", async () => {
  const rendered = await renderEditedImageRendition(
    COLOR_2X2,
    state(),
    { width: 2, height: 2 },
    LIMITS,
    { blurSigma: 1 },
  );
  assert.equal(rendered.ok, true);
  if (!rendered.ok) {
    return;
  }

  assert.deepEqual(
    [...(await rawPixels(rendered.value.bytes))],
    [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
  );
});

test("zoom samples a bounded center crop before resize", async () => {
  const neutral = await renderEditedImageRendition(
    GRADIENT_4X4,
    state(),
    { width: 4, height: 4 },
    LIMITS,
    { blurSigma: 1 },
  );
  const zoomed = await renderEditedImageRendition(
    GRADIENT_4X4,
    state({ zoom: 2 }),
    { width: 4, height: 4 },
    LIMITS,
    { blurSigma: 1 },
  );
  assert.equal(neutral.ok, true);
  assert.equal(zoomed.ok, true);
  if (!neutral.ok || !zoomed.ok) {
    return;
  }

  assert.notDeepEqual(
    [...(await rawPixels(zoomed.value.bytes))],
    [...(await rawPixels(neutral.value.bytes))],
  );
});

test("pan moves the sampled foreground across the canvas", async () => {
  const rendered = await renderEditedImageRendition(
    COLOR_2X2,
    state({ panX: 0.5 }),
    { width: 2, height: 2 },
    LIMITS,
    { blurSigma: 1 },
  );
  assert.equal(rendered.ok, true);
  if (!rendered.ok) {
    return;
  }

  const pixels = [...(await rawPixels(rendered.value.bytes))];
  assert.deepEqual(pixels.slice(4, 8), [255, 0, 0, 255]);
  assert.deepEqual(pixels.slice(12, 16), [0, 0, 255, 255]);
});

test("extreme zoom remains bounded to canvas-sized rendering", async () => {
  const rendered = await renderEditedImageRendition(
    GRADIENT_4X4,
    state({ zoom: 1_000_000_000 }),
    { width: 4, height: 4 },
    LIMITS,
    { blurSigma: 1 },
  );

  assert.equal(rendered.ok, true);
  if (rendered.ok) {
    assert.equal((await rawPixels(rendered.value.bytes)).byteLength, 4 * 4 * 4);
  }
});

test("zero contrast produces midpoint grey with opaque alpha", async () => {
  const rendered = await renderEditedImageRendition(
    COLOR_2X2,
    state({ contrast: 0 }),
    { width: 2, height: 2 },
    LIMITS,
    { blurSigma: 1 },
  );
  assert.equal(rendered.ok, true);
  if (!rendered.ok) {
    return;
  }

  const pixels = await rawPixels(rendered.value.bytes);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    assert.equal(pixels[offset], 128);
    assert.equal(pixels[offset + 1], 128);
    assert.equal(pixels[offset + 2], 128);
    assert.equal(pixels[offset + 3], 255);
  }
});

test("saturation zero removes chroma while preserving alpha", async () => {
  const rendered = await renderEditedImageRendition(
    COLOR_2X2,
    state({ saturation: 0 }),
    { width: 2, height: 2 },
    LIMITS,
    { blurSigma: 1 },
  );
  assert.equal(rendered.ok, true);
  if (!rendered.ok) {
    return;
  }

  const pixels = await rawPixels(rendered.value.bytes);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    assert.equal(pixels[offset], pixels[offset + 1]);
    assert.equal(pixels[offset + 1], pixels[offset + 2]);
    assert.equal(pixels[offset + 3], 255);
  }
});

test("redaction replaces its rectangle with opaque black", async () => {
  const rendered = await renderEditedImageRendition(
    COLOR_2X2,
    state({}, [
      {
        id: "top-left",
        mode: "redact",
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5,
      },
    ]),
    { width: 2, height: 2 },
    LIMITS,
    { blurSigma: 1 },
  );
  assert.equal(rendered.ok, true);
  if (!rendered.ok) {
    return;
  }

  const pixels = [...(await rawPixels(rendered.value.bytes))];
  assert.deepEqual(pixels.slice(0, 4), [0, 0, 0, 255]);
  assert.deepEqual(pixels.slice(4, 8), [0, 255, 0, 255]);
});

test("blur changes its region without touching outside pixels", async () => {
  const baseline = await renderEditedImageRendition(
    GRADIENT_4X4,
    state(),
    { width: 4, height: 4 },
    LIMITS,
    { blurSigma: 1 },
  );
  const blurred = await renderEditedImageRendition(
    GRADIENT_4X4,
    state({}, [
      {
        id: "top",
        mode: "blur",
        x: 0,
        y: 0,
        width: 1,
        height: 0.75,
      },
    ]),
    { width: 4, height: 4 },
    LIMITS,
    { blurSigma: 1 },
  );
  assert.equal(baseline.ok, true);
  assert.equal(blurred.ok, true);
  if (!baseline.ok || !blurred.ok) {
    return;
  }

  const before = [...(await rawPixels(baseline.value.bytes))];
  const after = [...(await rawPixels(blurred.value.bytes))];
  assert.notDeepEqual(after.slice(0, 4 * 4 * 3), before.slice(0, 4 * 4 * 3));
  assert.deepEqual(after.slice(4 * 4 * 3), before.slice(4 * 4 * 3));
});

test("one-pixel blur regions remain valid bounded operations", async () => {
  const rendered = await renderEditedImageRendition(
    COLOR_2X2,
    state({}, [
      {
        id: "pixel",
        mode: "blur",
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5,
      },
    ]),
    { width: 2, height: 2 },
    LIMITS,
    { blurSigma: 1 },
  );

  assert.equal(rendered.ok, true);
});

test("optimization lowers working detail before compression", async () => {
  const source = await detailedFixture();
  const size70 = await candidateBytes(source, 0.7, "lossless");
  const size55 = await candidateBytes(source, 0.55, "lossless");
  assert.ok(size70 > size55);
  const optimized = await renderOptimizedImageRendition(
    source,
    state(),
    { width: 96, height: 96 },
    {
      maxInputPixels: 1_000_000,
      maxOutputPixels: 1_000_000,
      maxOutputBytes: size55,
    },
    {
      blurSigma: 20,
      gifFps: 10,
      compression: "lossless",
      background: { mode: "solid", color: "#ffffff" },
    },
  );
  assert.ok(optimized.ok);
  if (!optimized.ok) return;
  assert.deepEqual(optimized.value.effective, {
    stage: "detail",
    detailScale: 0.55,
    gifFps: null,
    compression: "lossless",
  });
  assert.equal(optimized.value.width, 96);
  assert.equal(optimized.value.height, 96);
  assert.ok(optimized.value.bytes.length <= size55);
});

test(
  "optimization uses compact only after lossless detail is exhausted",
  async () => {
    const source = await detailedFixture();
    const lossless40 = await candidateBytes(source, 0.4, "lossless");
    const compact40 = await candidateBytes(source, 0.4, "compact");
    assert.ok(lossless40 > compact40 + 1);
    const limit = lossless40 - 1;
    assert.ok(compact40 <= limit);
    const optimized = await renderOptimizedImageRendition(
      source,
      state(),
      { width: 96, height: 96 },
      {
        maxInputPixels: 1_000_000,
        maxOutputPixels: 1_000_000,
        maxOutputBytes: limit,
      },
      {
        blurSigma: 20,
        gifFps: 10,
        compression: "lossless",
        background: { mode: "solid", color: "#ffffff" },
      },
    );
    assert.ok(optimized.ok);
    if (!optimized.ok) return;
    assert.deepEqual(optimized.value.effective, {
      stage: "compression",
      detailScale: 0.4,
      gifFps: null,
      compression: "compact",
    });
    assert.equal(optimized.value.width, 96);
    assert.equal(optimized.value.height, 96);
    assert.ok(optimized.value.bytes.length <= limit);
  },
);

test("GIF optimization lowers FPS only after detail candidates", async () => {
  const optimized = await renderOptimizedImageRendition(
    GIF_2_FRAME_2X2,
    state(),
    { width: 16, height: 16 },
    {
      maxInputPixels: 10_000,
      maxOutputPixels: 16 * 16 * 2,
      maxOutputBytes: 1_000_000,
    },
    {
      blurSigma: 20,
      gifFps: 20,
      compression: "compact",
      background: { mode: "solid", color: "#ffffff" },
    },
  );
  assert.ok(optimized.ok);
  if (!optimized.ok) return;
  assert.deepEqual(optimized.value.effective, {
    stage: "fps",
    detailScale: 0.4,
    gifFps: 10,
    compression: "compact",
  });
  assert.equal(optimized.value.width, 16);
  assert.equal(optimized.value.height, 16);
  assert.equal(optimized.value.frameCount, 2);
  const sharp = await loadSharp();
  const metadata = await sharp(optimized.value.bytes, {
    animated: true,
  }).metadata();
  assert.deepEqual(metadata.delay, [100, 100]);
  assert.equal(metadata.loop, 2);
});

test(
  "animated GIF edits normalize timing to 10 FPS and " + "preserve loop state",
  async () => {
    const rendered = await renderEditedImageRendition(
      GIF_2_FRAME_2X2,
      state({}, [
        {
          id: "top-left",
          mode: "redact",
          x: 0,
          y: 0,
          width: 0.5,
          height: 0.5,
        },
      ]),
      { width: 2, height: 2 },
      LIMITS,
      { blurSigma: 1 },
    );
    assert.equal(rendered.ok, true);
    if (!rendered.ok) {
      return;
    }

    assert.deepEqual(
      {
        format: rendered.value.format,
        mediaType: rendered.value.mediaType,
        frameCount: rendered.value.frameCount,
        animated: rendered.value.animated,
      },
      {
        format: "gif",
        mediaType: "image/gif",
        frameCount: 2,
        animated: true,
      },
    );

    const sharp = await loadSharp();
    const metadata = await sharp(rendered.value.bytes, {
      animated: true,
    }).metadata();
    assert.equal(metadata.pages, 2);
    assert.equal(metadata.pageHeight, 2);
    assert.deepEqual(metadata.delay, [100, 100]);
    assert.equal(metadata.loop, 2);

    const raw = await sharp(rendered.value.bytes, { animated: true })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const frameBytes = 2 * 2 * 4;
    assert.deepEqual([...raw.slice(0, 4)], [0, 0, 0, 255]);
    assert.deepEqual(
      [...raw.slice(frameBytes, frameBytes + 4)],
      [0, 0, 0, 255],
    );
    assert.notDeepEqual(
      [...raw.slice(0, frameBytes)],
      [...raw.slice(frameBytes)],
    );
  },
);

test("animated GIF edits preserve duplicate frames", async () => {
  const rendered = await renderEditedImageRendition(
    GIF_2_FRAME_1X1,
    state(),
    { width: 1, height: 1 },
    LIMITS,
    { blurSigma: 1 },
  );
  assert.equal(rendered.ok, true);
  if (!rendered.ok) {
    return;
  }

  const sharp = await loadSharp();
  const metadata = await sharp(rendered.value.bytes, {
    animated: true,
  }).metadata();
  assert.equal(metadata.pages, 2);
  assert.deepEqual(metadata.delay, [100, 100]);
  assert.equal(metadata.loop, 1);
});

test("animated output pixel limits count every frame", async () => {
  assert.deepEqual(
    await renderEditedImageRendition(
      GIF_2_FRAME_2X2,
      state(),
      { width: 2, height: 2 },
      { ...LIMITS, maxOutputPixels: 7 },
      { blurSigma: 1 },
    ),
    { ok: false, code: "rendition-pixel-limit-exceeded" },
  );
});

test("animated output byte limits apply after final GIF encode", async () => {
  assert.deepEqual(
    await renderEditedImageRendition(
      GIF_2_FRAME_2X2,
      state(),
      { width: 2, height: 2 },
      { ...LIMITS, maxOutputBytes: 1 },
      { blurSigma: 1 },
    ),
    { ok: false, code: "rendition-byte-limit-exceeded" },
  );
});

test("editor output pixel and byte limits fail closed", async () => {
  assert.deepEqual(
    await renderEditedImageRendition(
      COLOR_2X2,
      state(),
      { width: 4, height: 4 },
      { ...LIMITS, maxOutputPixels: 15 },
      { blurSigma: 1 },
    ),
    { ok: false, code: "rendition-pixel-limit-exceeded" },
  );

  assert.deepEqual(
    await renderEditedImageRendition(
      COLOR_2X2,
      state(),
      { width: 2, height: 2 },
      { ...LIMITS, maxOutputBytes: 1 },
      { blurSigma: 1 },
    ),
    { ok: false, code: "rendition-byte-limit-exceeded" },
  );
});

test("invalid editor values fail before native image work", async () => {
  assert.deepEqual(
    await renderEditedImageRendition(
      Uint8Array.from([1, 2, 3]),
      state({ zoom: 0 }),
      { width: 2, height: 2 },
      LIMITS,
      { blurSigma: 1 },
    ),
    { ok: false, code: "invalid-editor-rendition" },
  );

  assert.deepEqual(
    await renderEditedImageRendition(
      Uint8Array.from([1, 2, 3]),
      state(),
      { width: 2, height: 2 },
      LIMITS,
      { blurSigma: 0.1 },
    ),
    { ok: false, code: "invalid-editor-rendition" },
  );
});
