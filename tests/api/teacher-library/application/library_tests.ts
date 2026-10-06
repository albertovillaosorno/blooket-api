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
//   - Library lifecycle and recoverable skills and quiz drafts.
// - Must-Not:
//   - Let AI overwrite original text, rename assets, or publish drafts.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Library lifecycle and recoverable skills and quiz drafts.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  importLibraryImage,
  editLibraryImage,
  prepareLibraryImage,
  executeLibraryCommand,
} from "../../../../src/api/teacher-library/application/library.ts";
import { loadPreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import {
  listLibrary,
  metadataPath,
} from "../../../../src/platforms/user-library/adapter-outbound/files.ts";
import { loadSharp } from
  "../../../../src/media/sharp-runtime/adapter-outbound/sharp-runtime.ts";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "teacher-library-"));
  const sharp = await loadSharp();
  const bytes = await sharp(new Uint8Array([30, 90, 50, 255]), {
    raw: { width: 1, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
  const input = {
    filename: "Mi foto.png",
    name: "Mi foto",
    description: "Un ejemplo",
    language: "es",
    topics: ["example"],
    base64: Buffer.from(bytes).toString("base64"),
  };
  return { root, bytes, input };
}
test(
  "library preserves originals, mirrors YAML and " +
    "separates enrichment from edits",
  async () => {
    const { root, bytes, input } = await setup();
    try {
      const record = await importLibraryImage(root, input);
      const library = (await loadPreferences(root)).mediaRoot;
      assert.equal(metadataPath(record.asset), "metadata/Mi foto.png.yaml");
      const result = await executeLibraryCommand(
        {
          version: 1,
          operationId: "test:enrich",
          command: "library.enrich",
          payload: {
            id: record.id,
            revision: record.revision,
            name: "My photo",
            description: "An example",
            topics: ["example", "photo"],
          },
        },
        root,
      );
      assert.equal(result.ok, true);
      const enriched = (await listLibrary(library))[0]!;
      assert.equal(enriched.original.name, "Mi foto");
      assert.equal(enriched.generatedEnglish?.name, "My photo");
      assert.deepEqual(enriched.edit, record.edit);
      const edited = await editLibraryImage(root, {
        id: record.id,
        revision: enriched.revision,
        original: {
          name: "Mi foto",
          description: "Otro ejemplo",
          language: "es",
        },
        topics: ["photo"],
        edit: {
          ...record.edit,
          width: 160,
          height: 90,
          zoom: 1.5,
          background: { mode: "solid", color: "#ffffff" },
        },
      });
      assert.notEqual(
        edited.original.revision,
        edited.generatedEnglish?.sourceRevision,
      );
      const prepared = await prepareLibraryImage(root, record.id);
      assert.ok(prepared.prepared!.bytes < 2_500_000);
      assert.equal((await loadPreferences(root)).defaults.width, 1280);
      assert.deepEqual(
        await readFile(join(library, record.asset)),
        Buffer.from(bytes),
      );
      await assert.rejects(
        importLibraryImage(root, input),
        /filename-already-exists/u,
      );
      await assert.rejects(
        editLibraryImage(root, {
          id: record.id,
          revision: 1,
          original: { name: "x", description: "x", language: "es" },
          topics: [],
          edit: edited.edit,
        }),
        /revision-conflict/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "AI metadata requests cannot choose filenames or " +
    "replace original fields",
  async () => {
    const { root, input } = await setup();
    try {
      const record = await importLibraryImage(root, input);
      const result = await executeLibraryCommand(
        {
          version: 1,
          operationId: "test:bad",
          command: "library.enrich",
          payload: {
            id: record.id,
            revision: 1,
            name: "AI",
            description: "AI",
            topics: [],
            asset: "photos/AI.png",
          },
        },
        root,
      );
      assert.equal(result.ok, false);
      assert.equal(
        (await listLibrary((await loadPreferences(root)).mediaRoot))[0]!
          .revision,
        1,
      );
      await assert.rejects(
        importLibraryImage(root, { ...input, filename: "../outside.png" }),
        /invalid-import/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "personal skills use optimistic revisions and " +
    "preserve one recovery copy",
  async () => {
    const { root } = await setup();
    const run = (payload: unknown) =>
      executeLibraryCommand(
        {
          version: 1,
          operationId: "test:skill",
          command: "skills.put",
          payload,
        },
        root,
      );
    try {
      assert.equal(
        (
          await run({
            id: "lesson",
            text: "Original guidance",
            expectedRevision: null,
          })
        ).ok,
        true,
      );
      const current = await executeLibraryCommand(
        {
          version: 1,
          operationId: "test:read",
          command: "skills.get",
          payload: { id: "lesson" },
        },
        root,
      );
      assert.ok(current.ok);
      if (!current.ok) return;
      const revision = (current.value as { revision: string }).revision;
      assert.equal(
        (
          await run({
            id: "lesson",
            text: "Replacement",
            expectedRevision: null,
          })
        ).ok,
        false,
      );
      assert.equal(
        (
          await run({
            id: "lesson",
            text: "Replacement",
            expectedRevision: revision,
          })
        ).ok,
        true,
      );
      assert.equal(
        await readFile(join(root, "skills", "lesson.md.previous"), "utf8"),
        "Original guidance",
      );
      assert.equal(
        (await run({ id: "../settings", text: "bad", expectedRevision: null }))
          .ok,
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
