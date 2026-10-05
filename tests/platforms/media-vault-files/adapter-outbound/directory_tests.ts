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
//   - Filesystem tests for transactional media-vault publication and recovery.
// - Must-Not:
//   - Decode images, contact Blooket, or use production teacher directories.
// - Allows:
//   - Inputs: Temporary vaults and deliberate interrupted-import fixtures.
//   - Outputs: Durable import, conflict, lock, and recovery verdicts.
//   - Side effects: Temporary filesystem writes removed after every test.
// - Split-When:
//   - Host-specific media persistence requires separate platform suites.
// - Merge-When:
//   - Media persistence no longer spans files and shared metadata.
// - Summary:
//   - Verifies metadata-last publication and inode-proven rollback.
// - Description:
//   - Exercises real hard links, markers, backups, and symbolic-path refusal.
// - Usage:
//   - Run on Linux now and macOS before release promotion.
// - Defaults:
//   - Test state lives only beneath the operating-system temp directory.
//
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  importMediaVaultAsset,
  loadMediaVault,
  loadMediaVaultOriginal,
  updateMediaVaultAsset,
  type MediaVaultImport,
  type MediaVaultUpdate,
} from
  "../../../../src/platforms/media-vault-files/adapter-outbound/directory.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import { serializeMediaJsonLines } from
  "../../../../src/media/media-index/domain/json-lines.ts";

const TOKEN = "12345678-1234-4234-8234-123456789abc";
const firstRecord = {
  id: "sun",
  path: "media/sun.png",
  name: "sun",
  description: "A bright yellow sun.",
  english: true,
} as const;
const firstImport: MediaVaultImport = {
  record: firstRecord,
  sourceFormat: "jpeg",
  renditionFormat: "png",
  originalBytes: Uint8Array.from([1, 2, 3]),
  renditionBytes: Uint8Array.from([4, 5, 6]),
};
const updatedFirstRecord = {
  ...firstRecord,
  description: "A warm edited sun.",
  english: false,
} as const;
const firstUpdate: MediaVaultUpdate = {
  expectedRecord: firstRecord,
  expectedRenditionSha256: sha256(firstImport.renditionBytes),
  record: updatedFirstRecord,
  renditionFormat: "png",
  renditionBytes: Uint8Array.from([40, 50, 60]),
};

const secondRecord = {
  id: "horse",
  path: "media/horse.png",
  name: "horse",
  description: "A brown horse.",
  english: false,
} as const;
const secondImport: MediaVaultImport = {
  record: secondRecord,
  sourceFormat: "png",
  renditionFormat: "png",
  originalBytes: Uint8Array.from([7, 8]),
  renditionBytes: Uint8Array.from([9, 10]),
};

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-media-vault-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("missing vault loads empty without creating a directory", async () => {
  await withTemporaryDirectory(async (parent) => {
    const directory = join(parent, "missing-vault");
    assert.deepEqual(await loadMediaVault(directory), {
      ok: true,
      records: [],
    });
    assert.equal(await pathExists(directory), false);
  });
});

test("imports publish assets before canonical metadata", async () => {
  await withTemporaryDirectory(async (directory) => {
    assert.deepEqual(
      await importMediaVaultAsset(directory, firstImport),
      {
        ok: true,
        record: firstRecord,
        originalPath: "originals/sun.jpg",
      },
    );

    assert.deepEqual(
      await readFile(join(directory, "originals", "sun.jpg")),
      Buffer.from(firstImport.originalBytes),
    );
    assert.deepEqual(
      await readFile(join(directory, "media", "sun.png")),
      Buffer.from(firstImport.renditionBytes),
    );
    assert.equal(
      await readFile(join(directory, "media.jsonl"), "utf8"),
      serializeMediaJsonLines([firstRecord]),
    );
    assert.equal(
      (await lstat(join(directory, "originals", "sun.jpg"))).mode & 0o777,
      0o600,
    );
    assert.deepEqual(
      await readdir(join(directory, "originals")),
      ["sun.jpg"],
    );
    assert.deepEqual(
      await readdir(join(directory, "media")),
      ["sun.png"],
    );
    assert.equal(
      await pathExists(join(directory, ".blooket-api-media-import.json")),
      false,
    );
  });
});

test("original read limits fail before filesystem access", async () => {
  assert.deepEqual(
    await loadMediaVaultOriginal(
      "/path/that/must/not/be/read",
      "sun",
      0,
    ),
    {
      ok: false,
      kind: "invalid",
      code: "media-read-limit-invalid",
    },
  );
});

test("original loading resolves one indexed immutable source", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);

    assert.deepEqual(
      await loadMediaVaultOriginal(directory, "sun", 1024),
      {
        ok: true,
        record: firstRecord,
        sourceFormat: "jpeg",
        bytes: Buffer.from(firstImport.originalBytes),
        renditionSha256: sha256(firstImport.renditionBytes),
      },
    );
    assert.deepEqual(
      await loadMediaVaultOriginal(directory, "missing", 1024),
      {
        ok: false,
        kind: "invalid",
        code: "media-record-missing",
      },
    );
  });
});

test("original loading rejects oversized files before reads", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);

    assert.deepEqual(
      await loadMediaVaultOriginal(directory, "sun", 2),
      {
        ok: false,
        kind: "io",
        code: "media-vault-source-too-large",
      },
    );
  });
});

test("original loading rejects ambiguous or unsafe source paths", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    await writeFile(
      join(directory, "originals", "sun.png"),
      Uint8Array.from([99]),
    );

    assert.deepEqual(
      await loadMediaVaultOriginal(directory, "sun", 1024),
      {
        ok: false,
        kind: "io",
        code: "media-vault-recovery-failed",
      },
    );
  });
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    const target = join(directory, "elsewhere");
    await writeFile(target, Uint8Array.from([1]));
    await symlink(
      target,
      join(directory, "originals", "sun.png"),
    );

    assert.deepEqual(
      await loadMediaVaultOriginal(directory, "sun", 1024),
      {
        ok: false,
        kind: "io",
        code: "media-vault-unsafe",
      },
    );
  });
});

test("legacy vault loads migrate names without rewriting", async () => {
  await withTemporaryDirectory(async (directory) => {
    const legacy = {
      id: "sun",
      path: "media/sun.png",
      description: "A bright yellow sun.",
      english: true,
    };
    const legacyJsonl = JSON.stringify(legacy) + "\n";
    await mkdir(join(directory, "media"));
    await mkdir(join(directory, "originals"));
    await writeFile(join(directory, "media.jsonl"), legacyJsonl);

    assert.deepEqual(await loadMediaVault(directory), {
      ok: true,
      records: [{
        ...legacy,
        name: "sun",
      }],
    });
    assert.equal(
      await readFile(join(directory, "media.jsonl"), "utf8"),
      legacyJsonl,
    );
  });
});

test("name-only updates keep stable media identity", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    const renamed = {
      ...firstRecord,
      name: "Bright Sun",
    };

    assert.deepEqual(
      await updateMediaVaultAsset(directory, {
        expectedRecord: firstRecord,
        expectedRenditionSha256: sha256(firstImport.renditionBytes),
        record: renamed,
        renditionFormat: "png",
        renditionBytes: firstImport.renditionBytes,
      }),
      { ok: true, record: renamed },
    );
    assert.equal(
      await readFile(join(directory, "media.jsonl"), "utf8"),
      serializeMediaJsonLines([renamed]),
    );
    assert.deepEqual(
      await readFile(join(directory, "originals", "sun.jpg")),
      Buffer.from(firstImport.originalBytes),
    );
  });
});

test("edits replace rendition and metadata, not originals", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    const originalBefore = await readFile(
      join(directory, "originals", "sun.jpg"),
    );

    assert.deepEqual(
      await updateMediaVaultAsset(directory, firstUpdate),
      { ok: true, record: updatedFirstRecord },
    );
    assert.deepEqual(
      await readFile(join(directory, "originals", "sun.jpg")),
      originalBefore,
    );
    assert.deepEqual(
      await readFile(join(directory, "media", "sun.png")),
      Buffer.from(firstUpdate.renditionBytes),
    );
    assert.deepEqual(
      await readFile(join(directory, "media", "sun.png.bak")),
      Buffer.from(firstImport.renditionBytes),
    );
    assert.equal(
      await readFile(join(directory, "media.jsonl"), "utf8"),
      serializeMediaJsonLines([updatedFirstRecord]),
    );
    assert.equal(
      await readFile(join(directory, "media.jsonl.bak"), "utf8"),
      serializeMediaJsonLines([firstRecord]),
    );
    assert.equal(
      await pathExists(join(directory, ".blooket-api-media-edit.json")),
      false,
    );
  });
});

test("identical edits are idempotent without creating backups", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    const identical: MediaVaultUpdate = {
      expectedRecord: firstRecord,
      expectedRenditionSha256: sha256(firstImport.renditionBytes),
      record: firstRecord,
      renditionFormat: "png",
      renditionBytes: firstImport.renditionBytes,
    };

    assert.deepEqual(
      await updateMediaVaultAsset(directory, identical),
      { ok: true, record: firstRecord },
    );
    assert.equal(
      await pathExists(join(directory, "media", "sun.png.bak")),
      false,
    );
  });
});

test("edits require an existing canonical media record", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);

    assert.deepEqual(
      await updateMediaVaultAsset(directory, {
        expectedRecord: secondRecord,
        expectedRenditionSha256: sha256(Uint8Array.from([99])),
        record: secondRecord,
        renditionFormat: "png",
        renditionBytes: Uint8Array.from([99]),
      }),
      {
        ok: false,
        kind: "invalid",
        code: "media-record-missing",
      },
    );
    assert.deepEqual(
      await updateMediaVaultAsset(directory, {
        ...firstUpdate,
        record: {
          ...updatedFirstRecord,
          path: "media/sun.gif",
        },
      }),
      {
        ok: false,
        kind: "invalid",
        code: "media-path-mismatch",
      },
    );
  });
});

test("stale edit preconditions prevent lost updates", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    const stale = { ...firstUpdate };

    assert.equal(
      (await updateMediaVaultAsset(directory, firstUpdate)).ok,
      true,
    );
    assert.deepEqual(
      await updateMediaVaultAsset(directory, {
        ...stale,
        record: {
          ...updatedFirstRecord,
          description: "A stale overwrite.",
        },
        renditionBytes: Uint8Array.from([90, 91, 92]),
      }),
      {
        ok: false,
        kind: "conflict",
        code: "media-edit-conflict",
      },
    );
    assert.equal(
      await readFile(join(directory, "media.jsonl"), "utf8"),
      serializeMediaJsonLines([updatedFirstRecord]),
    );
    assert.deepEqual(
      await readFile(join(directory, "media", "sun.png")),
      Buffer.from(firstUpdate.renditionBytes),
    );
  });
});

test("vault edits fail while another writer holds the lock", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    const held = await tryAcquireFileLock(
      join(directory, ".blooket-api-media-vault.lock"),
    );
    assert.equal(held.ok, true);
    if (!held.ok) {
      return;
    }
    try {
      assert.deepEqual(
        await updateMediaVaultAsset(directory, firstUpdate),
        {
          ok: false,
          kind: "io",
          code: "media-vault-locked",
        },
      );
    } finally {
      await held.lock.release();
    }
  });
});

test("legacy edit markers recover against legacy JSONL", async () => {
  await withTemporaryDirectory(async (directory) => {
    const previousRecord = {
      id: "sun",
      path: "media/sun.png",
      description: "A bright yellow sun.",
      english: true,
    };
    const nextRecord = {
      ...previousRecord,
      description: "A warm edited sun.",
      english: false,
    };
    const previousIndex = JSON.stringify(previousRecord) + "
";
    const nextIndex = JSON.stringify(nextRecord) + "
";
    const previousRendition = Buffer.from(firstImport.renditionBytes);
    const nextRendition = Buffer.from(firstUpdate.renditionBytes);
    const marker = {
      version: 1,
      id: "sun",
      renditionFormat: "png",
      previousRecord,
      nextRecord,
      previousIndexSha256: sha256(previousIndex),
      nextIndexSha256: sha256(nextIndex),
      previousRenditionSha256: sha256(previousRendition),
      nextRenditionSha256: sha256(nextRendition),
    } as const;

    await mkdir(join(directory, "media"));
    await writeFile(join(directory, "media.jsonl"), previousIndex);
    await writeFile(
      join(directory, "media", "sun.png.bak"),
      previousRendition,
    );
    await writeFile(
      join(directory, "media", "sun.png"),
      nextRendition,
    );
    await writeFile(
      join(directory, ".blooket-api-media-edit.json"),
      JSON.stringify(marker) + "
",
    );

    assert.deepEqual(await loadMediaVault(directory), {
      ok: true,
      records: [{
        ...previousRecord,
        name: "sun",
      }],
    });
    assert.deepEqual(
      await readFile(join(directory, "media", "sun.png")),
      previousRendition,
    );
    assert.equal(
      await readFile(join(directory, "media.jsonl"), "utf8"),
      previousIndex,
    );
  });
});

test("load rolls back an interrupted rendition-first edit", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    await createInterruptedEdit(directory, false);

    assert.deepEqual(await loadMediaVault(directory), {
      ok: true,
      records: [firstRecord],
    });
    assert.deepEqual(
      await readFile(join(directory, "media", "sun.png")),
      Buffer.from(firstImport.renditionBytes),
    );
    assert.equal(
      await pathExists(join(directory, ".blooket-api-media-edit.json")),
      false,
    );
  });
});

test("load completes cleanup after edited metadata commits", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    await createInterruptedEdit(directory, true);

    assert.deepEqual(await loadMediaVault(directory), {
      ok: true,
      records: [updatedFirstRecord],
    });
    assert.deepEqual(
      await readFile(join(directory, "media", "sun.png")),
      Buffer.from(firstUpdate.renditionBytes),
    );
    assert.equal(
      await pathExists(join(directory, ".blooket-api-media-edit.json")),
      false,
    );
  });
});

test("unknown edited rendition state fails recovery", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    await createInterruptedEdit(directory, false);
    const rendition = join(directory, "media", "sun.png");
    await writeFile(rendition, Uint8Array.from([70, 80, 90]));

    assert.deepEqual(await loadMediaVault(directory), {
      ok: false,
      kind: "io",
      code: "media-vault-recovery-failed",
    });
    assert.deepEqual(
      await readFile(rendition),
      Buffer.from([70, 80, 90]),
    );
    assert.equal(
      await pathExists(join(directory, ".blooket-api-media-edit.json")),
      true,
    );
  });
});

test("simultaneous import and edit markers fail closed", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    await createInterruptedEdit(directory, false);
    await writeMarker(directory);

    assert.deepEqual(await loadMediaVault(directory), {
      ok: false,
      kind: "io",
      code: "media-vault-recovery-failed",
    });
    assert.equal(
      await pathExists(join(directory, ".blooket-api-media-edit.json")),
      true,
    );
    assert.equal(
      await pathExists(join(directory, ".blooket-api-media-import.json")),
      true,
    );
  });
});

test("later imports retain one previous canonical index backup", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    const second = await importMediaVaultAsset(directory, secondImport);
    assert.equal(second.ok, true);

    assert.equal(
      await readFile(join(directory, "media.jsonl.bak"), "utf8"),
      serializeMediaJsonLines([firstRecord]),
    );
    assert.equal(
      await readFile(join(directory, "media.jsonl"), "utf8"),
      serializeMediaJsonLines([
        firstRecord,
        secondRecord,
      ]),
    );
  });
});

test("concurrent distinct imports preserve both metadata updates", async () => {
  await withTemporaryDirectory(async (directory) => {
    const results = await Promise.all([
      importMediaVaultAsset(directory, firstImport),
      importMediaVaultAsset(directory, secondImport),
    ]);

    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(
      results.filter(
        (result) => !result.ok
          && result.kind === "io"
          && result.code === "media-vault-locked",
      ).length,
      1,
    );

    const retry = results[0]?.ok
      ? await importMediaVaultAsset(directory, secondImport)
      : await importMediaVaultAsset(directory, firstImport);
    assert.equal(retry.ok, true);

    const loaded = await loadMediaVault(directory);
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.deepEqual(
        [...loaded.records].map((record) => record.id).sort(),
        ["horse", "sun"],
      );
    }
  });
});

test("duplicate IDs conflict without replacing durable assets", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    const beforeIndex = await readFile(
      join(directory, "media.jsonl"),
      "utf8",
    );
    const beforeOriginal = await readFile(
      join(directory, "originals", "sun.jpg"),
    );

    const duplicate: MediaVaultImport = {
      ...firstImport,
      record: {
        ...firstRecord,
        description: "A different description.",
      },
      originalBytes: Uint8Array.from([99]),
    };
    assert.deepEqual(await importMediaVaultAsset(directory, duplicate), {
      ok: false,
      kind: "conflict",
      code: "media-id-conflict",
    });
    assert.equal(
      await readFile(join(directory, "media.jsonl"), "utf8"),
      beforeIndex,
    );
    assert.deepEqual(
      await readFile(join(directory, "originals", "sun.jpg")),
      beforeOriginal,
    );
  });
});

test("vault imports fail while another writer holds the lock", async () => {
  await withTemporaryDirectory(async (directory) => {
    const held = await tryAcquireFileLock(
      join(directory, ".blooket-api-media-vault.lock"),
    );
    assert.equal(held.ok, true);
    if (!held.ok) {
      return;
    }
    try {
      assert.deepEqual(
        await importMediaVaultAsset(directory, firstImport),
        {
          ok: false,
          kind: "io",
          code: "media-vault-locked",
        },
      );
    } finally {
      await held.lock.release();
    }
  });
});

test("load rolls back inode-proven interrupted asset publication", async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await createInterruptedFixture(directory, false);
    const loaded = await loadMediaVault(directory);

    assert.deepEqual(loaded, { ok: true, records: [] });
    for (const path of fixture.transactionPaths) {
      assert.equal(await pathExists(path), false);
    }
    assert.equal(await pathExists(fixture.markerPath), false);
  });
});

test("named v2 import recovery preserves the display name", async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await createInterruptedFixture(
      directory,
      true,
      {
        markerVersion: 2,
        name: "Bright Sun",
      },
    );
    const loaded = await loadMediaVault(directory);

    assert.deepEqual(loaded, {
      ok: true,
      records: [{
        ...firstRecord,
        name: "Bright Sun",
      }],
    });
    assert.equal(await pathExists(fixture.original), true);
    assert.equal(await pathExists(fixture.rendition), true);
    assert.equal(await pathExists(fixture.markerPath), false);
  });
});

test("load cleans staging after metadata commits", async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await createInterruptedFixture(directory, true);
    const loaded = await loadMediaVault(directory);

    assert.deepEqual(loaded, { ok: true, records: [firstRecord] });
    assert.equal(await pathExists(fixture.original), true);
    assert.equal(await pathExists(fixture.rendition), true);
    assert.equal(await pathExists(fixture.originalStage), false);
    assert.equal(await pathExists(fixture.renditionStage), false);
    assert.equal(await pathExists(fixture.markerPath), false);
  });
});

test("rollback preserves a final file with a different inode", async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await createInterruptedFixture(directory, false, {
      linkOriginal: false,
      linkRendition: false,
    });
    await writeFile(fixture.original, "preexisting");

    assert.deepEqual(await loadMediaVault(directory), {
      ok: true,
      records: [],
    });
    assert.equal(await readFile(fixture.original, "utf8"), "preexisting");
    assert.equal(await pathExists(fixture.originalStage), false);
    assert.equal(await pathExists(fixture.markerPath), false);
  });
});

test("committed metadata with missing assets fails recovery", async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeMarker(directory);
    await writeFile(
      join(directory, "media.jsonl"),
      serializeMediaJsonLines([firstRecord]),
    );

    assert.deepEqual(await loadMediaVault(directory), {
      ok: false,
      kind: "io",
      code: "media-vault-recovery-failed",
    });
    assert.equal(
      await pathExists(join(directory, ".blooket-api-media-import.json")),
      true,
    );
  });
});

test("unproven orphan finals survive failed recovery", async () => {
  await withTemporaryDirectory(async (directory) => {
    await mkdir(join(directory, "originals"), { recursive: true });
    await writeMarker(directory);
    const original = join(directory, "originals", "sun.jpg");
    await writeFile(original, "unproven");

    assert.deepEqual(await loadMediaVault(directory), {
      ok: false,
      kind: "io",
      code: "media-vault-recovery-failed",
    });
    assert.equal(await readFile(original, "utf8"), "unproven");
  });
});

test("invalid indexes reject imports before asset publication", async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeFile(join(directory, "media.jsonl"), "{invalid\n");

    assert.deepEqual(
      await importMediaVaultAsset(directory, firstImport),
      {
        ok: false,
        kind: "invalid",
        code: "media-index-invalid",
      },
    );
    assert.equal(
      await pathExists(join(directory, "originals", "sun.jpg")),
      false,
    );
    assert.equal(
      await pathExists(join(directory, "media", "sun.png")),
      false,
    );
  });
});

test("corrupt markers fail closed without deleting assets", async () => {
  await withTemporaryDirectory(async (directory) => {
    await mkdir(join(directory, "originals"), { recursive: true });
    const original = join(directory, "originals", "sun.jpg");
    await writeFile(original, "keep-me");
    await writeFile(
      join(directory, ".blooket-api-media-import.json"),
      "{\"version\":1,\"id\":\"sun\"}\n",
    );

    assert.deepEqual(await loadMediaVault(directory), {
      ok: false,
      kind: "io",
      code: "media-vault-recovery-failed",
    });
    assert.equal(await readFile(original, "utf8"), "keep-me");
  });
});

test("symbolic vault asset directories are refused", async () => {
  await withTemporaryDirectory(async (directory) => {
    const outside = join(directory, "outside");
    await mkdir(outside);
    await symlink(outside, join(directory, "media"));

    assert.deepEqual(
      await importMediaVaultAsset(directory, firstImport),
      {
        ok: false,
        kind: "io",
        code: "media-vault-unsafe",
      },
    );
  });
});

async function createInterruptedEdit(
  directory: string,
  committed: boolean,
): Promise<void> {
  const previousIndex = serializeMediaJsonLines([firstRecord]);
  const nextIndex = serializeMediaJsonLines([updatedFirstRecord]);
  const previousRendition = Buffer.from(firstImport.renditionBytes);
  const nextRendition = Buffer.from(firstUpdate.renditionBytes);
  const marker = {
    version: 1,
    id: firstRecord.id,
    renditionFormat: "png",
    previousRecord: firstRecord,
    nextRecord: updatedFirstRecord,
    previousIndexSha256: sha256(previousIndex),
    nextIndexSha256: sha256(nextIndex),
    previousRenditionSha256: sha256(previousRendition),
    nextRenditionSha256: sha256(nextRendition),
  } as const;

  await writeFile(
    join(directory, "media", "sun.png.bak"),
    previousRendition,
  );
  await writeFile(
    join(directory, ".blooket-api-media-edit.json"),
    JSON.stringify(marker) + "\n",
  );
  await writeFile(
    join(directory, "media", "sun.png"),
    nextRendition,
  );
  if (committed) {
    await writeFile(join(directory, "media.jsonl"), nextIndex);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeMarker(directory: string): Promise<void> {
  const marker = {
    version: 1,
    id: firstRecord.id,
    description: firstRecord.description,
    english: firstRecord.english,
    sourceFormat: firstImport.sourceFormat,
    renditionFormat: firstImport.renditionFormat,
    token: TOKEN,
  } as const;
  await writeFile(
    join(directory, ".blooket-api-media-import.json"),
    JSON.stringify(marker) + "\n",
  );
}

async function createInterruptedFixture(
  directory: string,
  committed: boolean,
  options: {
    readonly linkOriginal?: boolean;
    readonly linkRendition?: boolean;
    readonly markerVersion?: 1 | 2;
    readonly name?: string;
  } = {},
): Promise<{
  readonly markerPath: string;
  readonly original: string;
  readonly rendition: string;
  readonly originalStage: string;
  readonly renditionStage: string;
  readonly transactionPaths: readonly string[];
}> {
  const record = {
    ...firstRecord,
    name: options.name ?? firstRecord.name,
  };
  const marker = options.markerVersion === 2
    ? {
        version: 2 as const,
        id: record.id,
        name: record.name,
        description: record.description,
        english: record.english,
        sourceFormat: firstImport.sourceFormat,
        renditionFormat: firstImport.renditionFormat,
        token: TOKEN,
      }
    : {
        version: 1 as const,
        id: record.id,
        description: record.description,
        english: record.english,
        sourceFormat: firstImport.sourceFormat,
        renditionFormat: firstImport.renditionFormat,
        token: TOKEN,
      };
  const markerPath = join(directory, ".blooket-api-media-import.json");
  const original = join(directory, "originals", "sun.jpg");
  const rendition = join(directory, "media", "sun.png");
  const originalStage = join(
    directory,
    "originals",
    ".sun." + TOKEN + ".original.staged",
  );
  const renditionStage = join(
    directory,
    "media",
    ".sun." + TOKEN + ".rendition.staged",
  );

  await mkdir(join(directory, "originals"), { recursive: true });
  await mkdir(join(directory, "media"), { recursive: true });
  await writeFile(markerPath, JSON.stringify(marker) + "\n");
  await writeFile(originalStage, firstImport.originalBytes);
  await writeFile(renditionStage, firstImport.renditionBytes);
  if (options.linkOriginal !== false) {
    await link(originalStage, original);
  }
  if (options.linkRendition !== false) {
    await link(renditionStage, rendition);
  }
  if (committed) {
    await writeFile(
      join(directory, "media.jsonl"),
      serializeMediaJsonLines([record]),
    );
  }

  return {
    markerPath,
    original,
    rendition,
    originalStage,
    renditionStage,
    transactionPaths: [
      original,
      rendition,
      originalStage,
      renditionStage,
    ],
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    return error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
      ? false
      : Promise.reject(error);
  }
}
