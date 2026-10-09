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
//   - Synthetic prepared-image envelope admission and byte decoding.
// - Must-Not:
//   - Read private media, provider URLs, credentials, or local file paths.
// - Allows:
//   - Inputs: Synthetic byte signatures and untrusted envelope candidates.
//   - Outputs: Canonical byte equality and strict failure assertions.
//   - Side effects: None.
// - Split-When:
//   - Another media family needs an independent envelope decoder.
// - Merge-When:
//   - The versioned browser bridge no longer transports prepared media.
// - Summary:
//   - Enforces bounded file identity before any browser-side input creation.
// - Description:
//   - Tests canonical base64, media format, exact fields, and size limits.
// - Usage:
//   - Run through the ordinary repository Node test suite.
// - Defaults:
//   - Ambiguous or oversized data is rejected before browser dispatch.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  blooketPreparedImageBytes,
  decodeBlooketPreparedImage,
} from "../../../../src/ir/blooket-browser-bridge/contract/prepared-image.ts";

const png = [137, 80, 78, 71, 13, 10, 26, 10];
const jpeg = [255, 216, 255, 224, 0, 16];
const gif = [71, 73, 70, 56, 57, 97];
const encoded = (bytes: number[]) =>
  Buffer.from(bytes).toString("base64");

test("prepared media preserves canonical bytes for admitted formats", () => {
  for (const [format, signature] of [
    ["png", png],
    ["jpeg", jpeg],
    ["gif", gif],
  ] as const) {
    const image = { format, base64: encoded([...signature]) };
    const result = decodeBlooketPreparedImage(image);
    assert.deepEqual(result, { ok: true, value: image });
    assert.deepEqual(Array.from(blooketPreparedImageBytes(image) ?? []),
      signature);
  }
  const oldGif = { format: "gif" as const,
    base64: encoded([71, 73, 70, 56, 55, 97]) };
  assert.equal(decodeBlooketPreparedImage(oldGif).ok, true);
});

test("prepared image envelopes reject ambiguous files and encoding", () => {
  const valid = { format: "png", base64: encoded(png) };
  for (const invalid of [
    null, [], {}, { format: "png" },
    { ...valid, url: "https://example.invalid/private" },
    { ...valid, path: "/tmp/owned-file" },
    { ...valid, fileName: "lesson.png" },
    { ...valid, format: "svg" },
    { ...valid, format: "jpeg" },
    { ...valid, base64: 123 },
    { ...valid, base64: "" },
    { ...valid, base64: valid.base64 + "=" },
    { ...valid, base64: valid.base64.replace(/=/gu, "") },
    { ...valid, base64: "AAAA" },
    { format: "gif", base64: encoded([71, 73, 70, 56, 56, 97]) },
    { format: "png", base64: encoded(png.slice(0, 7)) },
    { format: "jpeg", base64: encoded(jpeg.slice(0, 2)) },
  ]) {
    const result = decodeBlooketPreparedImage(invalid);
    assert.equal(result.ok, false, JSON.stringify(invalid));
    if (!result.ok) {
      assert.equal(result.issues[0]?.code, "invalid-prepared-image");
      assert.equal(JSON.stringify(result).includes(valid.base64), false);
    }
  }
  assert.deepEqual(decodeBlooketPreparedImage(valid, "$.command.image"),
    { ok: true, value: valid });
});

test("prepared bytes reject the exact upper bound without partial reads",
  () => {
    const under = new Uint8Array(2_499_999);
    under.set(png);
    const justUnder = { format: "png" as const,
      base64: Buffer.from(under).toString("base64") };
    const bytes = blooketPreparedImageBytes(justUnder);
    assert.equal(bytes?.byteLength, 2_499_999);
    const over = new Uint8Array(2_500_000);
    over.set(png);
    assert.equal(decodeBlooketPreparedImage({
      format: "png", base64: Buffer.from(over).toString("base64"),
    }).ok, false);
  },
);
