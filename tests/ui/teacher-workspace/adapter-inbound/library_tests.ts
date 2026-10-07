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
  clipboardImageUrl,
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
    { image },
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
