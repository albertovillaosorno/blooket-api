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
//   - Behavioral tests for content-based image format detection.
// - Must-Not:
//   - Invoke native image decoders or read fixture files from disk.
// - Allows:
//   - Inputs: Small deterministic signature byte arrays.
//   - Outputs: Deterministic format recognition and rejection verdicts.
//   - Side effects: None.
// - Split-When:
//   - Full decoder fixtures require a separate integration suite.
// - Merge-When:
//   - Media import no longer performs format admission.
// - Summary:
//   - Verifies supported signatures and rejects spoofed or unsupported inputs.
// - Description:
//   - Covers static signatures plus AVIF major and compatible brands.
// - Usage:
//   - Run before adding or changing an image decoder dependency.
// - Defaults:
//   - Tests intentionally avoid large binary image fixtures.
//
import assert from "node:assert/strict";
import test from "node:test";

import { detectImageFormat } from
  "../../../../src/media/image-formats/domain/image-format.ts";

const encoder = new TextEncoder();

test("JPEG PNG GIF and WebP signatures map to canonical media info", () => {
  assert.deepEqual(
    detectImageFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
    {
      format: "jpeg",
      mediaType: "image/jpeg",
      extension: ".jpg",
    },
  );

  assert.equal(
    detectImageFormat(Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
    ]))?.format,
    "png",
  );
  assert.equal(detectImageFormat(encoder.encode("GIF89a"))?.format, "gif");
  assert.equal(
    detectImageFormat(encoder.encode("RIFFxxxxWEBP"))?.format,
    "webp",
  );
});

test("AVIF accepts major and compatible brands but rejects HEIC-only", () => {
  assert.equal(
    detectImageFormat(ftypBox("avif", []))?.format,
    "avif",
  );
  assert.equal(
    detectImageFormat(ftypBox("mif1", ["avif", "miaf"]))?.format,
    "avif",
  );
  assert.equal(
    detectImageFormat(ftypBox("avis", []))?.format,
    "avif",
  );
  assert.equal(
    detectImageFormat(ftypBox("heic", ["mif1"])),
    undefined,
  );
});

test("truncated and spoofed signatures are rejected", () => {
  assert.equal(detectImageFormat(new Uint8Array()), undefined);
  assert.equal(detectImageFormat(encoder.encode("GIF89")), undefined);
  assert.equal(detectImageFormat(encoder.encode("RIFFxxxxNOPE")), undefined);

  const truncatedAvif = ftypBox("avif", []);
  truncatedAvif[3] = truncatedAvif.length + 4;
  assert.equal(detectImageFormat(truncatedAvif), undefined);
});

function ftypBox(
  majorBrand: string,
  compatibleBrands: readonly string[],
): Uint8Array {
  const size = 16 + compatibleBrands.length * 4;
  const bytes = new Uint8Array(size);
  writeUint32BigEndian(bytes, 0, size);
  bytes.set(encoder.encode("ftyp"), 4);
  bytes.set(encoder.encode(majorBrand), 8);
  bytes.set([0, 0, 0, 0], 12);
  compatibleBrands.forEach((brand, index) => {
    bytes.set(encoder.encode(brand), 16 + index * 4);
  });
  return bytes;
}

function writeUint32BigEndian(
  bytes: Uint8Array,
  offset: number,
  value: number,
): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
