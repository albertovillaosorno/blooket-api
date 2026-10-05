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
//   - Integration tests for decoder-backed source-image validation.
// - Must-Not:
//   - Persist vault assets or depend on Blooket capability dimensions.
// - Allows:
//   - Inputs: Tiny deterministic PNG/GIF bytes and malformed image payloads.
//   - Outputs: Stable metadata and fail-closed decoder verdicts.
//   - Side effects: Native decoder work in the test process.
// - Split-When:
//   - Platform-specific decoder packages require separate fixture suites.
// - Merge-When:
//   - Source decoding no longer uses a native adapter.
// - Summary:
//   - Verifies full decode, frame metadata, limits, and corrupt rejection.
// - Description:
//   - Includes a two-frame GIF fixture without storing binary test files.
// - Usage:
//   - Run on Linux and macOS after Sharp or libvips upgrades.
// - Defaults:
//   - Fixtures stay only a few dozen bytes before decode.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeSourceImage } from
  "../../../../src/media/image-decoding/adapter-outbound/sharp-image.ts";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPo"
    + "AAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPo"
    + "AAAD6AG1e1JrAAAADElEQVQImWNg+A+BAA/5A/2NJFz3AAAAAElFTkSuQmCC",
  "base64",
);

const GIF_2_FRAME_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwALAAAAAABAAEAAAIBTAA7",
  "base64",
);

test("static PNG bytes are fully decoded with canonical metadata", async () => {
  assert.deepEqual(await decodeSourceImage(PNG_1X1, 1), {
    ok: true,
    value: {
      format: {
        format: "png",
        mediaType: "image/png",
        extension: ".png",
      },
      frameWidth: 1,
      frameHeight: 1,
      frameCount: 1,
      animated: false,
      frameDelaysMs: [],
    },
  });
});

test(
  "animated GIF metadata retains frame count delays and loop state",
  async () => {
    assert.deepEqual(await decodeSourceImage(GIF_2_FRAME_1X1, 2), {
      ok: true,
      value: {
        format: {
          format: "gif",
          mediaType: "image/gif",
          extension: ".gif",
        },
        frameWidth: 1,
        frameHeight: 1,
        frameCount: 2,
        animated: true,
        loopCount: 1,
        frameDelaysMs: [100, 100],
      },
    });
  },
);

test("pixel ceilings and malformed payloads fail closed", async () => {
  assert.deepEqual(await decodeSourceImage(PNG_1X1, 0), {
    ok: false,
    code: "invalid-pixel-limit",
  });
  assert.deepEqual(await decodeSourceImage(PNG_2X1, 1), {
    ok: false,
    code: "image-pixel-limit-exceeded",
  });
  assert.deepEqual(await decodeSourceImage(PNG_1X1, 1), {
    ok: true,
    value: {
      format: {
        format: "png",
        mediaType: "image/png",
        extension: ".png",
      },
      frameWidth: 1,
      frameHeight: 1,
      frameCount: 1,
      animated: false,
      frameDelaysMs: [],
    },
  });

  assert.deepEqual(
    await decodeSourceImage(PNG_1X1.subarray(0, 16), 100),
    { ok: false, code: "image-decode-failed" },
  );
});

test("unsupported signatures fail before the native decoder", async () => {
  assert.deepEqual(
    await decodeSourceImage(Uint8Array.from([1, 2, 3, 4]), 100),
    { ok: false, code: "unsupported-image-format" },
  );
});
