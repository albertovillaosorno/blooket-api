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
//   - Verification of bounded image intake and gallery presentation.
// - Must-Not:
//   - Expose configuration through the online MCP gateway.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Verification of bounded image intake and gallery presentation.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import test from "node:test";
import assert from "node:assert/strict";
import {
  sampleLibrary,
  representativeSolidColor,
  clipboardImageUrl,
  preferredPasteSource,
  preparedMediaUrl,
  readClipboardImage,
} from "../../../../src/ui/teacher-workspace/adapter-inbound/library.js";

test(
  "gallery samples at most twelve without copies, sorting, or duplicates",
  () => {
  let calls = 0;
  const records = Array.from({ length: 100_000 }, (_, id) => ({ id }));
  const selected = sampleLibrary(records, () => {
    calls++;
    return 0;
  });
  assert.equal(calls, 12);
  assert.equal(new Set(selected).size, 12);
  assert.deepEqual(selected, records.slice(0, 12));
  assert.equal(records[99_999].id, 99_999);
  const end = sampleLibrary(records, () => 0.999999);
  assert.equal(new Set(end).size, 12);
  assert.equal(end[0], records[99_999]);
  assert.deepEqual(sampleLibrary([]), []);
  assert.deepEqual(
    sampleLibrary(records.slice(0, 3), () => 0),
    records.slice(0, 3),
  );
});

test("solid color uses a bounded deterministic dominant palette", () => {
  const rgba = new Uint8ClampedArray([
    240, 32, 32, 255,
    238, 30, 30, 255,
    20, 100, 220, 255,
    1, 1, 1, 20,
  ]);
  assert.equal(representativeSolidColor(rgba), "#ef1f1f");
  assert.equal(
    representativeSolidColor(
      new Uint8ClampedArray([0, 0, 0, 255]),
    ),
    "#303030",
  );
  assert.equal(
    representativeSolidColor(
      new Uint8ClampedArray([255, 255, 255, 255]),
    ),
    "#d0d0d0",
  );
  assert.equal(
    representativeSolidColor(
      new Uint8ClampedArray([0, 0, 0, 20]),
    ),
    null,
  );
  assert.equal(
    representativeSolidColor(new Uint8ClampedArray(1284)),
    null,
  );
});

test("GIF color considers later frames within the five-frame bound", () => {
  const frames = new Uint8ClampedArray(3 * 8 * 8 * 4);
  for (let offset = 0; offset < frames.length; offset += 4) {
    frames.set(
      offset < 8 * 8 * 4 ? [240, 32, 32, 255] : [20, 100, 220, 255],
      offset,
    );
  }
  assert.equal(representativeSolidColor(frames), "#1464dc");
  const maximum = new Uint8ClampedArray(5 * 8 * 8 * 4);
  for (let offset = 0; offset < maximum.length; offset += 4)
    maximum.set([0, 0, 0, 255], offset);
  assert.equal(representativeSolidColor(maximum), "#303030");
  assert.equal(representativeSolidColor(new Uint8Array(1281)), null);
});

test("prepared gallery URLs display saved output rather than the source",
  () => {
  const record = { id: "fixture", revision: 2,
    prepared: { recipeRevision: 2, file: "renditions/a/2.gif" } };
  assert.equal(preparedMediaUrl(record),
    "/media/fixture?variant=prepared&revision=2");
  assert.equal(preparedMediaUrl({ ...record, revision: 3 }),
    "/media/fixture");
  assert.equal(preparedMediaUrl({ ...record, prepared: null }),
    "/media/fixture");
});

test("clipboard paste retains linked GIF instead of flattened PNG",
  async () => {
  const still = new Blob(["still"], { type: "image/png" });
  const gif = new Blob(["animation"], { type: "image/gif" });
  const link = "https://images.example.test/animation.gif?size=large";
  assert.deepEqual(preferredPasteSource([still], link), { url: link });
  assert.deepEqual(preferredPasteSource([still, gif], link), { image: gif });
  assert.deepEqual(preferredPasteSource([still], "https://example.test/a.png"),
    { image: still });
  assert.deepEqual(preferredPasteSource([], "not-an-image"), null);
  assert.deepEqual(await readClipboardImage({ read: async () => [
    { types: ["image/png"], getType: async () => still },
    { types: ["text/plain"],
      getType: async () => new Blob([link], { type: "text/plain" }) },
  ] }), { url: link });
});

test("clipboard prefers original GIF bytes to a PNG preview",
  async () => {
  const png = new Blob(["still"], { type: "image/png" });
  const gif = new Blob(["animated"], { type: "image/gif" });
  for (const items of [
    [{ types: ["image/png", "image/gif"],
      getType: async (type: string) => type === "image/gif" ? gif : png }],
    [{ types: ["image/png"], getType: async () => png },
      { types: ["image/gif"], getType: async () => gif }],
  ]) {
    assert.deepEqual(await readClipboardImage({ read: async () => items }),
      { image: gif });
  }
});

test("GIF paste survives inaccessible clipboard representations",
  async () => {
  const gif = new Blob(["animated"], { type: "image/gif" });
  const png = new Blob(["still"], { type: "image/png" });
  const denied = { types: ["image/gif"],
    getType: async () => { throw Error("unsupported-gif-blob"); } };
  const available = { types: ["image/gif"],
    getType: async () => gif };
  assert.deepEqual(await readClipboardImage({
    read: async () => [denied, available],
  }), { image: gif });
  const gifUrl = "https://images.example.test/animation.gif";
  const text = { types: ["text/plain"],
    getType: async () => new Blob([gifUrl], { type: "text/plain" }) };
  assert.deepEqual(await readClipboardImage({
    read: async () => [denied, { types: ["image/png"],
      getType: async () => png }, text],
  }), { url: gifUrl }, "a PNG is not a replacement for a failed GIF");
  await assert.rejects(readClipboardImage({
    read: async () => [denied, { types: ["image/png"],
      getType: async () => png }],
  }), /clipboard-gif-unavailable/u);
});

test(
  "clipboard chooses an image before text and admits only web image URLs",
  async () => {
  const image = new Blob(["image"], { type: "image/png" });
  const text = new Blob(["https://images.example.test/a.gif"]);
  assert.deepEqual(
    await readClipboardImage({
      read: async () => [
        { types: ["text/plain"], getType: async () => text },
        { types: ["image/png"], getType: async () => image },
      ],
    }),
    { url: "https://images.example.test/a.gif" },
  );
  assert.deepEqual(
    await readClipboardImage({
      read: async () => [{ types: ["text/plain"], getType: async () => text }],
    }),
    { url: "https://images.example.test/a.gif" },
  );
  assert.deepEqual(
    await readClipboardImage({
      readText: async () => " https://images.example.test/a.gif ",
    }),
    { url: "https://images.example.test/a.gif" },
  );
  for (const value of [
    "data:image/png;base64,eA==",
    "file:///tmp/a.png",
    "javascript:alert(1)",
    "https://user:password@example.test/a",
    "words",
  ]) {
    assert.equal(clipboardImageUrl(value), null);
  }
  await assert.rejects(
    readClipboardImage({ read: async () => [] }),
    /clipboard-image-missing/u,
  );
  await assert.rejects(
    readClipboardImage({
      read: async () => {
        throw new Error("permission-denied");
      },
    }),
    /permission-denied/u,
  );
});
