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
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  importLibraryImage,
  editLibraryImage,
  prepareLibraryImage,
  executeLibraryCommand,
  readPreparedLibraryImage,
} from "../../../../src/api/teacher-library/application/library.ts";
import { loadPreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import {
  listLibrary,
  metadataPath,
  saveMetadata,
} from "../../../../src/platforms/user-library/adapter-outbound/files.ts";
import { installInitialSkills } from
  "../../../../src/api/teacher-library/application/initial-skills.ts";
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
  "library stores optimized canonical media and " +
    "separates enrichment from edits",
  async () => {
    const { root, bytes, input } = await setup();
    try {
      const record = await importLibraryImage(root, input);
      const library = (await loadPreferences(root)).mediaRoot;
      assert.match(
        record.asset,
        /^photos\/[0-9a-f-]{36}\.webp$/u,
      );
      assert.equal(
        metadataPath(record.asset),
        "metadata/" + record.asset.slice("photos/".length) + ".yaml",
      );
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
      const canonical = await readFile(join(library, record.asset));
      assert.notDeepEqual(canonical, Buffer.from(bytes));
      const sharp = await loadSharp();
      assert.equal((await sharp(canonical).metadata()).format, "webp");
      const duplicateName = await importLibraryImage(root, input);
      assert.notEqual(duplicateName.id, record.id);
      assert.notEqual(duplicateName.asset, record.asset);
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
      const ignoredFilename = await importLibraryImage(root, {
        ...input,
        filename: "../outside.png",
      });
      assert.notEqual(ignoredFilename.asset, "../outside.png");
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

test(
  "search pages legacy IDs within count and " + "encoded-byte budgets",
  async () => {
    const { root, input, bytes } = await setup();
    try {
      const record = await importLibraryImage(root, input);
      const library = (await loadPreferences(root)).mediaRoot;
      for (let index = 0; index < 100; index++) {
        const asset = "photos/bulk-" + index + ".png";
        await writeFile(join(library, asset), bytes);
        await saveMetadata(
          library,
          {
            ...record,
            id:
              index === 0
                ? "a." + "x".repeat(126)
                : "legacy.id." + String(index).padStart(3, "0"),
            asset,
            original: {
              ...record.original,
              name: "bulk",
              description: "a".repeat(10_000),
            },
            generatedEnglish: {
              name: "bulk",
              description: "b".repeat(10_000),
              generatedBy: "ai",
              sourceRevision: 1,
              verified: false,
            },
          },
          true,
        );
      }
      const ids = new Set<string>();
      let after: string | null = null;
      do {
        const result = await executeLibraryCommand(
          {
            version: 1,
            operationId: "test:page",
            command: "library.search",
            payload: { query: "bulk", limit: 100, after },
          },
          root,
        );
        assert.ok(result.ok);
        const page = result.value as {
          records: { id: string }[];
          nextCursor: string | null;
          total: number;
        };
        assert.ok(Buffer.byteLength(JSON.stringify(result)) < 800_000);
        assert.ok(page.records.length > 0 && page.records.length < 100);
        assert.equal(page.total, 100);
        for (const item of page.records) {
          assert.equal(ids.has(item.id), false);
          ids.add(item.id);
        }
        after = page.nextCursor;
      } while (after !== null);
      assert.equal(ids.size, 100);
      const longId = "a." + "x".repeat(126);
      const read = await executeLibraryCommand(
        {
          version: 1,
          operationId: "test:long-id",
          command: "library.get",
          payload: { id: longId },
        },
        root,
      );
      assert.equal(read.ok, true);
      const invalid = await executeLibraryCommand(
        {
          version: 1,
          operationId: "test:bad-limit",
          command: "library.search",
          payload: { query: "bulk", limit: null },
        },
        root,
      );
      assert.equal(invalid.ok, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "initial skills install once without " + "replacing personal changes",
  async () => {
    const { root } = await setup();
    try {
      await loadPreferences(root);
      await installInitialSkills(root);
      const path = join(root, "skills", "quiz-authoring.md");
      assert.match(await readFile(path, "utf8"), /timeLimitSeconds/u);
      assert.match(
        await readFile(join(root, "skills", "master-workflow.md"), "utf8"),
        /workflow-learning/u,
      );
      assert.match(
        await readFile(join(root, "skills", "human-validation.md"), "utf8"),
        /CAPTCHA/u,
      );
      assert.match(
        await readFile(join(root, "skills", "media-analysis.md"), "utf8"),
        /ephemeral/u,
      );
      await writeFile(path, "Personal guidance");
      await installInitialSkills(root);
      assert.equal(await readFile(path, "utf8"), "Personal guidance");
      const result = await executeLibraryCommand(
        {
          version: 1,
          operationId: "test:seeded",
          command: "skills.get",
          payload: { id: "media-enrichment" },
        },
        root,
      );
      assert.equal(result.ok, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "bundled draft example validates and " + "malformed saved drafts are refused",
  async () => {
    const { root } = await setup();
    try {
      await loadPreferences(root);
      await installInitialSkills(root);
      const skill = await readFile(
        join(root, "skills", "quiz-authoring.md"),
        "utf8",
      );
      const document = JSON.parse(
        skill.split("```json\n")[1]!.split("```")[0]!,
      );
      const saved = await executeLibraryCommand(
        {
          version: 1,
          operationId: "test:example",
          command: "drafts.put",
          payload: { id: "example", document, expectedRevision: null },
        },
        root,
      );
      assert.equal(saved.ok, true);
      await writeFile(
        join(root, "drafts", "example.json"),
        JSON.stringify({ schemaVersion: 1 }),
      );
      const read = await executeLibraryCommand(
        {
          version: 1,
          operationId: "test:corrupt",
          command: "drafts.get",
          payload: { id: "example" },
        },
        root,
      );
      assert.equal(read.ok, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "aliases, duplicate keys and symbolic " +
    "metadata fail without changing bytes",
  async () => {
    const { root, bytes, input } = await setup();
    try {
      const record = await importLibraryImage(root, input);
      const library = (await loadPreferences(root)).mediaRoot;
      const path = join(library, metadataPath(record.asset));
      const source = await readFile(path, "utf8");
      await writeFile(path, source + "revision: 2\n");
      await assert.rejects(listLibrary(library));
      await writeFile(
        path,
        source
          .replace("name: Mi foto", "name: &label Mi foto")
          .replace("description: Un ejemplo", "description: *label"),
      );
      await assert.rejects(listLibrary(library));
      const outside = join(root, "synthetic-metadata.yaml");
      await writeFile(outside, source);
      await rm(path);
      await symlink(outside, path);
      await assert.rejects(listLibrary(library), /symbolic-library-path/u);
      assert.notDeepEqual(
        await readFile(join(library, record.asset)),
        Buffer.from(bytes),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "same-stem sources with different extensions " + "have distinct metadata",
  async () => {
    const { root, input, bytes } = await setup();
    try {
      const png = await importLibraryImage(root, input);
      const sharp = await loadSharp();
      const jpeg = await sharp(bytes).jpeg().toBuffer();
      const jpg = await importLibraryImage(root, {
        ...input,
        filename: "Mi foto.jpg",
        base64: Buffer.from(jpeg).toString("base64"),
      });
      assert.notEqual(jpg.id, png.id);
      assert.notEqual(metadataPath(jpg.asset), metadataPath(png.asset));
      assert.match(jpg.asset, /\.webp$/u);
      assert.match(png.asset, /\.webp$/u);
      assert.equal(
        (await listLibrary((await loadPreferences(root)).mediaRoot)).length,
        2,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "prepared reads reject stale revisions " +
    "and changed format or byte count",
  async () => {
  const { root, input } = await setup();
  try {
    const imported = await importLibraryImage(root, input);
    const library = (await loadPreferences(root)).mediaRoot;
    const record = await prepareLibraryImage(root, imported.id);
    const prepared = record.prepared!;
    const valid = await readPreparedLibraryImage(library, record.id, 1);
    assert.equal(valid.bytes.length, prepared.bytes);
    await assert.rejects(
      readPreparedLibraryImage(library, record.id, 2),
      /prepared-revision-conflict/u,
    );
    await saveMetadata(library, { ...record, revision: 2 });
    await assert.rejects(
      readPreparedLibraryImage(library, record.id),
      /prepared-revision-conflict/u,
    );
    await saveMetadata(library, record);
    const path = join(library, prepared.file);
    await writeFile(path, Buffer.alloc(prepared.bytes));
    await assert.rejects(
      readPreparedLibraryImage(library, record.id),
      /prepared-media-invalid/u,
    );
    await writeFile(path, valid.bytes.subarray(0, valid.bytes.length - 1));
    await assert.rejects(
      readPreparedLibraryImage(library, record.id),
      /prepared-media-invalid/u,
    );
    await writeFile(path, valid.bytes);
    await saveMetadata(library, {
      ...record,
      prepared: {
        ...prepared,
        file: prepared.file.replace(record.id, "other-asset"),
      },
    });
    await assert.rejects(
      readPreparedLibraryImage(library, record.id),
      /prepared-media-invalid/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
