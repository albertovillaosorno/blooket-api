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
//   - Explicit local migration and user-requested asset path changes.
// - Must-Not:
//   - Infer languages, discard legacy verification, or expose paths to MCP.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Journal and replay transfers under the selected
//     library root.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Explicit local migration and user-requested asset path changes.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrateLegacyLibrary,
  renameLibraryImage,
} from "../../../../src/api/teacher-library/application/transfers.ts";
import { importLibraryImage } from
  "../../../../src/api/teacher-library/application/library.ts";
import { loadPreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import {
  initializeLibrary,
  listLibrary,
  withLibraryLock,
  metadataPath,
  digest,
  saveMetadata,
  type LibraryTransaction,
} from "../../../../src/platforms/user-library/adapter-outbound/files.ts";
import { loadSharp } from
  "../../../../src/media/sharp-runtime/adapter-outbound/sharp-runtime.ts";

import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "library-transfers-"));
  const library = (await loadPreferences(root)).mediaRoot;
  await initializeLibrary(library);
  const sharp = await loadSharp();
  const bytes = await sharp(new Uint8Array([20, 90, 150, 255]), {
    raw: { width: 1, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
  const record = await importLibraryImage(root, {
    filename: "Original.png",
    name: "Original",
    description: "Texto original",
    language: "es",
    topics: ["example"],
    base64: Buffer.from(bytes).toString("base64"),
  });
  return { root, library, bytes, record };
}
async function legacy(library: string, bytes: Uint8Array) {
  await mkdir(join(library, "old"));
  await writeFile(join(library, "old", "Mi foto.png"), bytes);
  const index =
    JSON.stringify({
      schemaVersion: 2,
      id: "a." + "x".repeat(126),
      path: "old/Mi foto.png",
      name: "Mi foto",
      description: "El texto original",
      english: true,
    }) + "\n";
  await writeFile(join(library, "media.jsonl"), index);
  return index;
}
async function journal(library: string, value: LibraryTransaction) {
  await writeFile(
    join(library, ".library-transaction.json"),
    JSON.stringify(value),
  );
}
test(
  "migration preserves IDs, bytes, " + "text and legacy verification",
  async () => {
    const { root, library, bytes } = await setup();
    try {
      const index = await legacy(library, bytes);
      assert.deepEqual(await migrateLegacyLibrary(root), {
        migrated: 1,
        alreadyMigrated: false,
      });
      const migrated = (await listLibrary(library)).find((item) =>
        item.id.startsWith("a."),
      )!;
      assert.equal(migrated.id.length, 128);
      assert.equal(migrated.schemaVersion, 2);
      assert.equal(migrated.original.description, "El texto original");
      assert.equal(migrated.original.language, "");
      assert.equal(migrated.generatedEnglish, null);
      assert.deepEqual(migrated.legacy, {
        englishVerified: true,
        sourceRevision: 1,
        sourcePath: "old/Mi foto.png",
        indexDigest: digest(Buffer.from(index)),
      });
      assert.deepEqual(await readFile(join(library, migrated.asset)), bytes);
      assert.deepEqual(await readFile(join(library, "old/Mi foto.png")), bytes);
      assert.equal(
        await readFile(join(library, "media.jsonl.migrated"), "utf8"),
        index,
      );
      await assert.rejects(readFile(join(library, "media.jsonl")));
      assert.deepEqual(await migrateLegacyLibrary(root), {
        migrated: 0,
        alreadyMigrated: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "migration preflight rejects " + "collisions without publishing records",
  async () => {
    const { root, library, bytes } = await setup();
    try {
      const index = await legacy(library, bytes);
      await mkdir(join(library, "photos", "old"));
      await writeFile(join(library, "photos", "old", "Mi foto.png"), bytes);
      await assert.rejects(
        migrateLegacyLibrary(root),
        /filename-already-exists/u,
      );
      assert.equal((await listLibrary(library)).length, 1);
      assert.equal(await readFile(join(library, "media.jsonl"), "utf8"), index);
      await assert.rejects(
        readFile(join(library, ".library-transaction.json")),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "user rename preserves identity " + "and bytes with mirrored metadata",
  async () => {
    const { root, library, bytes, record } = await setup();
    try {
      const renamed = await renameLibraryImage(root, {
        id: record.id,
        revision: 1,
        relativePath: "animals/Mi gato.png",
      });
      assert.equal(renamed.id, record.id);
      assert.equal(renamed.revision, 2);
      assert.equal(renamed.asset, "photos/animals/Mi gato.png");
      assert.deepEqual(renamed.original, record.original);
      assert.equal(renamed.prepared, null);
      assert.deepEqual(await readFile(join(library, renamed.asset)), bytes);
      await assert.rejects(readFile(join(library, record.asset)));
      await assert.rejects(readFile(join(library, metadataPath(record.asset))));
      assert.deepEqual(await listLibrary(library), [renamed]);
      await assert.rejects(
        renameLibraryImage(root, {
          id: record.id,
          revision: 1,
          relativePath: "Otro.png",
        }),
        /revision-conflict/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "interrupted rename replays an " + "existing destination exactly once",
  async () => {
    const { root, library, bytes, record } = await setup();
    try {
      const after = {
        ...record,
        asset: "photos/Recovered.png",
        revision: 2,
        prepared: null,
      };
      await writeFile(join(library, after.asset), bytes);
      await journal(library, {
        version: 1,
        kind: "rename",
        indexDigest: null,
        transfers: [
          {
            source: record.asset,
            digest: digest(bytes),
            bytes: bytes.length,
            before: record,
            after,
          },
        ],
      });
      await assert.rejects(listLibrary(library), /library-recovery-required/u);
      await withLibraryLock(library, async () => {});
      await withLibraryLock(library, async () => {});
      assert.deepEqual(await listLibrary(library), [after]);
      assert.deepEqual(await readFile(join(library, after.asset)), bytes);
      await assert.rejects(readFile(join(library, record.asset)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "recovery detects changed sources " + "and preserves its pending journal",
  async () => {
    const { root, library, bytes, record } = await setup();
    try {
      const after = {
        ...record,
        asset: "photos/Recovered.png",
        revision: 2,
        prepared: null,
      };
      await journal(library, {
        version: 1,
        kind: "rename",
        indexDigest: null,
        transfers: [
          {
            source: record.asset,
            digest: digest(bytes),
            bytes: bytes.length,
            before: record,
            after,
          },
        ],
      });
      await writeFile(join(library, record.asset), Buffer.from("changed"));
      await assert.rejects(
        withLibraryLock(library, async () => {}),
        /source-changed-during-transfer/u,
      );
      assert.equal(
        await readFile(join(library, record.asset), "utf8"),
        "changed",
      );
      await assert.rejects(readFile(join(library, after.asset)));
      assert.ok(await readFile(join(library, ".library-transaction.json")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "migration recovers after metadata " + "publication and index archival",
  async () => {
    const { root, library, bytes, record } = await setup();
    try {
      const index = await legacy(library, bytes);
      const indexDigest = digest(Buffer.from(index));
      const after = {
        ...record,
        schemaVersion: 2 as const,
        id: "legacy.id",
        asset: "photos/old/Mi foto.png",
        prepared: null,
        legacy: {
          englishVerified: false,
          sourceRevision: 1,
          sourcePath: "old/Mi foto.png",
          indexDigest,
        },
      };
      await mkdir(join(library, "photos", "old"));
      await writeFile(join(library, after.asset), bytes);
      await saveMetadata(library, after, true);
      await writeFile(join(library, "media.jsonl.migrated"), index);
      await rm(join(library, "media.jsonl"));
      await journal(library, {
        version: 1,
        kind: "migrate",
        indexDigest,
        transfers: [
          {
            source: "old/Mi foto.png",
            digest: digest(bytes),
            bytes: bytes.length,
            before: null,
            after,
          },
        ],
      });
      await withLibraryLock(library, async () => {});
      assert.equal((await listLibrary(library)).length, 2);
      assert.equal(
        await readFile(join(library, "media.jsonl.migrated"), "utf8"),
        index,
      );
      assert.deepEqual(await readFile(join(library, "old/Mi foto.png")), bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "local path admission rejects " + "traversal, symlinks and wrong formats",
  async () => {
    const { root, library, bytes, record } = await setup();
    try {
      for (const relativePath of ["../escape.png", ".hidden.png", "photo.gif"])
        await assert.rejects(
          renameLibraryImage(root, {
            id: record.id,
            revision: 1,
            relativePath,
          }),
        );
      await symlink(root, join(library, "photos", "linked"));
      await assert.rejects(
        renameLibraryImage(root, {
          id: record.id,
          revision: 1,
          relativePath: "linked/escape.png",
        }),
        /symbolic-library-path/u,
      );
      assert.deepEqual(await readFile(join(library, record.asset)), bytes);
      assert.equal((await listLibrary(library))[0]!.revision, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "concurrent renames cannot split " + "identity or overwrite source bytes",
  async () => {
    const { root, library, bytes, record } = await setup();
    try {
      const results = await Promise.allSettled(
        ["One.png", "Two.png"].map((relativePath) =>
          renameLibraryImage(root, {
            id: record.id,
            revision: 1,
            relativePath,
          }),
        ),
      );
      assert.equal(
        results.filter((item) => item.status === "fulfilled").length,
        1,
      );
      const records = await listLibrary(library);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.id, record.id);
      assert.deepEqual(await readFile(join(library, records[0]!.asset)), bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "malformed transaction cannot modify another " + "image or escape the root",
  async () => {
    const { root, library, bytes, record } = await setup();
    try {
      const after = {
        ...record,
        asset: "photos/Recovered.png",
        revision: 2,
        prepared: null,
        topics: ["unauthorized-change"],
      };
      await journal(library, {
        version: 1,
        kind: "rename",
        indexDigest: null,
        transfers: [
          {
            source: record.asset,
            digest: digest(bytes),
            bytes: bytes.length,
            before: record,
            after,
          },
        ],
      });
      await assert.rejects(
        withLibraryLock(library, async () => {}),
        /invalid-library-transfer/u,
      );
      assert.deepEqual(await readFile(join(library, record.asset)), bytes);
      await assert.rejects(readFile(join(library, after.asset)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "invalid second legacy record " + "leaves the first source unpublished",
  async () => {
    const { root, library, bytes } = await setup();
    try {
      const first = await legacy(library, bytes);
      await writeFile(join(library, "invalid.png"), "not an image");
      const index =
        first +
        JSON.stringify({
          schemaVersion: 2,
          id: "invalid",
          path: "invalid.png",
          name: "Invalid",
          description: "Original",
          english: false,
        }) +
        "\n";
      await writeFile(join(library, "media.jsonl"), index);
      await assert.rejects(migrateLegacyLibrary(root));
      assert.equal((await listLibrary(library)).length, 1);
      await assert.rejects(readFile(join(library, "photos/old/Mi foto.png")));
      assert.equal(await readFile(join(library, "media.jsonl"), "utf8"), index);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "MCP command boundary cannot rename " + "files or migrate a library",
  async () => {
    const { executeLibraryCommand } = await import(
      "../../../../src/api/teacher-library/application/library.ts"
    );
    const { root, record, library, bytes } = await setup();
    try {
      for (const command of ["library.rename", "library.migrate"]) {
        const result = await executeLibraryCommand(
          {
            version: 1,
            operationId: "test:forbidden",
            command,
            payload: { id: record.id, revision: 1, relativePath: "AI.png" },
          },
          root,
        );
        assert.equal(result.ok, false);
      }
      assert.deepEqual(await readFile(join(library, record.asset)), bytes);
      assert.equal((await listLibrary(library))[0]!.revision, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

async function legacyVault(library: string, bytes: Uint8Array) {
  await mkdir(join(library, "media"));
  await mkdir(join(library, "originals"));
  await writeFile(join(library, "media/legacy.id.png"), bytes);
  const index =
    JSON.stringify({
      schemaVersion: 2,
      id: "legacy.id",
      path: "media/legacy.id.png",
      name: "Mi foto",
      description: "Texto original",
      english: true,
    }) + "\n";
  await writeFile(join(library, "media.jsonl"), index);
  return index;
}
test(
  "migration selects immutable originals over working " +
    "renditions",
  async () => {
  const { root, library, bytes } = await setup();
  try {
    const index = await legacyVault(library, bytes);
    const sharp = await loadSharp();
    const original = await sharp(bytes).jpeg().toBuffer();
    await writeFile(join(library, "originals/legacy.id.jpg"), original);
    await migrateLegacyLibrary(root);
    const record = (await listLibrary(library)).find(
      (item) => item.id === "legacy.id",
    )!;
    assert.equal(record.asset, "photos/originals/legacy.id.jpg");
    assert.equal(record.legacy?.sourcePath, "originals/legacy.id.jpg");
    assert.equal(record.original.description, "Texto original");
    assert.equal(record.legacy?.englishVerified, true);
    assert.deepEqual(await readFile(join(library, record.asset)), original);
    assert.deepEqual(
      await readFile(join(library, "originals/legacy.id.jpg")),
      original,
    );
    assert.deepEqual(
      await readFile(join(library, "media/legacy.id.png")),
      bytes,
    );
    assert.equal(
      await readFile(join(library, "media.jsonl.migrated"), "utf8"),
      index,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("migration rejects missing or ambiguous vault originals", async () => {
  const { root, library, bytes } = await setup();
  try {
    const index = await legacyVault(library, bytes);
    for (const scenario of ["missing", "ambiguous", "missing-directory"]) {
      if (scenario === "ambiguous") {
        const sharp = await loadSharp();
        await writeFile(join(library, "originals/legacy.id.png"), bytes);
        await writeFile(
          join(library, "originals/legacy.id.jpg"),
          await sharp(bytes).jpeg().toBuffer(),
        );
      } else if (scenario === "missing-directory") {
        await rm(join(library, "originals"), { recursive: true });
      }
      await assert.rejects(
        migrateLegacyLibrary(root),
        /legacy-original-missing-or-conflicting/u,
      );
      assert.equal((await listLibrary(library)).length, 1);
      assert.equal(await readFile(join(library, "media.jsonl"), "utf8"), index);
      await assert.rejects(
        readFile(join(library, ".library-transaction.json")),
      );
      await assert.rejects(readFile(join(library, "media.jsonl.migrated")));
      assert.deepEqual(
        await readFile(join(library, "media/legacy.id.png")),
        bytes,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test(
  "migration respects the legacy writer lock and releases " +
    "its own",
  async () => {
  const { root, library, bytes } = await setup();
  try {
    await legacy(library, bytes);
    const acquired = await tryAcquireFileLock(
      join(library, ".blooket-api-media-vault.lock"),
    );
    assert.ok(acquired.ok);
    try {
      await assert.rejects(migrateLegacyLibrary(root), /legacy-vault-busy/u);
      assert.equal((await listLibrary(library)).length, 1);
    } finally {
      await acquired.lock.release();
    }
    assert.equal((await migrateLegacyLibrary(root)).migrated, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test(
  "migration retains a decoded AVIF original without " +
    "conversion",
  async () => {
  const { root, library, bytes } = await setup();
  try {
    await legacyVault(library, bytes);
    const sharp = await loadSharp();
    const original = await sharp(bytes).avif().toBuffer();
    await writeFile(join(library, "originals/legacy.id.avif"), original);
    await migrateLegacyLibrary(root);
    const record = (await listLibrary(library)).find(
      (item) => item.id === "legacy.id",
    )!;
    assert.equal(record.asset, "photos/originals/legacy.id.avif");
    assert.deepEqual(await readFile(join(library, record.asset)), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
