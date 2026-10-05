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
  type MediaVaultImport,
} from
  "../../../../src/platforms/media-vault-files/adapter-outbound/directory.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";

const TOKEN = "12345678-1234-4234-8234-123456789abc";
const firstRecord = {
  id: "sun",
  path: "media/sun.png",
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
const secondRecord = {
  id: "horse",
  path: "media/horse.png",
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
      JSON.stringify(firstRecord) + "\n",
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

test("later imports retain one previous canonical index backup", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importMediaVaultAsset(directory, firstImport);
    const second = await importMediaVaultAsset(directory, secondImport);
    assert.equal(second.ok, true);

    assert.equal(
      await readFile(join(directory, "media.jsonl.bak"), "utf8"),
      JSON.stringify(firstRecord) + "\n",
    );
    assert.equal(
      await readFile(join(directory, "media.jsonl"), "utf8"),
      JSON.stringify(firstRecord)
        + "\n"
        + JSON.stringify(secondRecord)
        + "\n",
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
      JSON.stringify(firstRecord) + "\n",
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
  } = {},
): Promise<{
  readonly markerPath: string;
  readonly original: string;
  readonly rendition: string;
  readonly originalStage: string;
  readonly renditionStage: string;
  readonly transactionPaths: readonly string[];
}> {
  const marker = {
    version: 1,
    id: firstRecord.id,
    description: firstRecord.description,
    english: firstRecord.english,
    sourceFormat: firstImport.sourceFormat,
    renditionFormat: firstImport.renditionFormat,
    token: TOKEN,
  } as const;
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
      JSON.stringify(firstRecord) + "\n",
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
