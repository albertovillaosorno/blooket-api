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
//   - Real MCP-to-CLI bounded image intake and replay regression.
// - Must-Not:
//   - Read teacher credentials, publish quizzes or contact Blooket.
// - Allows:
//   - Inputs: A synthetic image and owned temporary user-data root.
//   - Outputs: Exact tool result and stable imported library ID.
//   - Side effects: Local test library files and one CLI subprocess per call.
// - Split-When:
//   - Independent tool families need different integration fixtures.
// - Merge-When:
//   - MCP uses a different command interface.
// - Summary:
//   - Confirms actual tool/CLI import is bounded and idempotent.
// - Description:
//   - No arbitrary user path enters the media import operation.
// - Usage:
//   - Run with node --test.
// - Defaults:
//   - Only validated canonical base64 is accepted.
//
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTeacherTool, listTeacherTools } from
  "../../../../src/mcp/teacher-tools/adapter-inbound/tools.ts";
import { loadSharp } from
  "../../../../src/media/sharp-runtime/adapter-outbound/sharp-runtime.ts";

test("registered MCP image bytes import through CLI with stable replay ID",
  async () => {
  const tool = listTeacherTools().find(item =>
    item.name === "library_image_import");
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.inputSchema.additionalProperties, false);
  const root = await mkdtemp(join(tmpdir(), "blooket-image-tool-"));
  try {
    const sharp = await loadSharp();
    const image = await sharp(new Uint8Array([6, 27, 81, 255]), {
      raw: { width: 1, height: 1, channels: 4 },
    }).png().toBuffer();
    const input = { name: "Original photo", description: "Small fixture",
      base64: image.toString("base64") };
    const first = await callTeacherTool("library_image_import", input, root);
    assert.equal(first.isError, false);
    const firstResult = JSON.parse(first.content[0]!.text);
    assert.equal(firstResult.ok, true);
    assert.match(firstResult.value.id, /^[a-f0-9-]{36}$/u);
    assert.equal(firstResult.value.revision, 1);
    const second = await callTeacherTool("library_image_import", input, root);
    assert.equal(second.isError, false);
    assert.deepEqual(JSON.parse(second.content[0]!.text).value,
      firstResult.value);
    const search = await callTeacherTool("library_search", {
      query: "Original photo", limit: 10,
    }, root);
    const found = JSON.parse(search.content[0]!.text);
    assert.equal(found.ok, true);
    assert.equal(found.value.records.length, 1);
    assert.equal(found.value.records[0].id, firstResult.value.id);
    const denied = await callTeacherTool("library_image_import", {
      ...input, path: "private.png",
    }, root);
    assert.equal(denied.isError, true);
    // These look like Base64 to a forgiving decoder but are not canonical.
    // Refuse them before the image worker or any new library side effect.
    for (const base64 of ["====", "AB==", "AAB="]) {
      const rejected = await callTeacherTool("library_image_import", {
        ...input, base64,
      }, root);
      assert.equal(rejected.isError, true);
    }
    const afterDenied = await callTeacherTool("library_search", {
      query: "Original photo", limit: 10,
    }, root);
    assert.equal(JSON.parse(afterDenied.content[0]!.text)
      .value.records.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
