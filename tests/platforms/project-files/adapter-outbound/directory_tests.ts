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
//   - Filesystem tests for durable project-directory persistence and recovery.
// - Must-Not:
//   - Contact Blooket or use production teacher directories.
// - Allows:
//   - Inputs: Temporary project directories and deliberate crash-state
//     fixtures.
//   - Outputs: Deterministic load, save, backup, and recovery verdicts.
//   - Side effects: Temporary filesystem writes removed after each test.
// - Split-When:
//   - Host-specific project persistence implementations require separate
//     suites.
// - Merge-When:
//   - Project persistence no longer spans local project files.
// - Summary:
//   - Verifies round trips, backups, crash rollback, and symlink refusal.
// - Description:
//   - Mirrors the project-files adapter using real Linux filesystem behavior.
// - Usage:
//   - Run on Linux now and macOS before release promotion.
// - Defaults:
//   - All test state lives under the operating-system temporary directory.
//
import assert from "node:assert/strict";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { decodeProjectBundle } from
  "../../../../src/projects/project-bundles/domain/project-bundle.ts";
import {
  loadProjectDirectory,
  saveProjectDirectory,
} from
  "../../../../src/platforms/project-files/adapter-outbound/directory.ts";

const firstProject = {
  schemaVersion: 1,
  title: "Vocabulary One",
  description: "First vocabulary review.",
  quizLanguage: "English",
  visibility: "private",
  mediaIndex: "media.jsonl",
  coverImage: { description: "A sun.", mediaId: "sun" },
  questions: [],
};
const firstMedia = {
  id: "sun",
  path: "media/sun.avif",
  description: "A bright yellow sun.",
  english: true,
};
const secondProject = {
  ...firstProject,
  title: "Vocabulary Two",
  coverImage: { description: "A horse.", mediaId: "horse" },
};
const secondMedia = {
  id: "horse",
  path: "media/horse.webp",
  description: "A brown horse.",
  english: true,
};

const firstBundle = mustDecode(
  JSON.stringify(firstProject),
  `${JSON.stringify(firstMedia)}\n`,
);
const secondBundle = mustDecode(
  JSON.stringify(secondProject),
  `${JSON.stringify(secondMedia)}\n`,
);

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-project-files-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("new project directories save and load one validated bundle", async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await saveProjectDirectory(directory, firstBundle);
    const loaded = await loadProjectDirectory(directory);

    assert.deepEqual(result, { ok: true });
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.deepEqual(loaded.bundle, firstBundle);
    }
    await assert.rejects(
      readFile(join(directory, ".blooket-api-project-write.json")),
    );
  });
});

test(
  "replacement keeps the previous valid project and media backups",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      assert.deepEqual(await saveProjectDirectory(directory, firstBundle), {
      ok: true,
    });
    assert.deepEqual(await saveProjectDirectory(directory, secondBundle), {
      ok: true,
    });

    const projectBackup = await readFile(
      join(directory, "project.json.bak"),
      "utf8",
    );
    const mediaBackup = await readFile(
      join(directory, "media.jsonl.bak"),
      "utf8",
    );
    const backup = decodeProjectBundle(projectBackup, mediaBackup);
    const loaded = await loadProjectDirectory(directory);

    assert.equal(backup.ok, true);
    if (backup.ok) {
      assert.deepEqual(backup.value, firstBundle);
    }
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.deepEqual(loaded.bundle, secondBundle);
    }
    });
  },
);

test("load rolls back an interrupted media-first replacement", async () => {
  await withTemporaryDirectory(async (directory) => {
    assert.deepEqual(await saveProjectDirectory(directory, firstBundle), {
      ok: true,
    });

    const projectPath = join(directory, "project.json");
    const mediaPath = join(directory, "media.jsonl");
    await copyFile(projectPath, join(directory, "project.json.bak"));
    await copyFile(mediaPath, join(directory, "media.jsonl.bak"));
    await writeFile(mediaPath, `${JSON.stringify(secondMedia)}\n`);
    await writeFile(
      join(directory, ".blooket-api-project-write.json"),
      '{"version":1,"hadProject":true,"hadMedia":true}\n',
    );

    const loaded = await loadProjectDirectory(directory);
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.deepEqual(loaded.bundle, firstBundle);
    }
    await assert.rejects(
      readFile(join(directory, ".blooket-api-project-write.json")),
    );
  });
});

test(
  "save recovers a prior interrupted transaction before replacing",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      assert.deepEqual(await saveProjectDirectory(directory, firstBundle), {
      ok: true,
    });

    const projectPath = join(directory, "project.json");
    const mediaPath = join(directory, "media.jsonl");
    await copyFile(projectPath, join(directory, "project.json.bak"));
    await copyFile(mediaPath, join(directory, "media.jsonl.bak"));
    await writeFile(mediaPath, `${JSON.stringify(secondMedia)}\n`);
    await writeFile(
      join(directory, ".blooket-api-project-write.json"),
      '{"version":1,"hadProject":true,"hadMedia":true}\n',
    );

    assert.deepEqual(await saveProjectDirectory(directory, secondBundle), {
      ok: true,
    });
    const backup = decodeProjectBundle(
      await readFile(join(directory, "project.json.bak"), "utf8"),
      await readFile(join(directory, "media.jsonl.bak"), "utf8"),
    );
    assert.equal(backup.ok, true);
    if (backup.ok) {
      assert.deepEqual(backup.value, firstBundle);
    }
    });
  },
);

test(
  "unsafe backup paths fail before a transaction marker is created",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      assert.deepEqual(await saveProjectDirectory(directory, firstBundle), {
      ok: true,
    });
    const outside = join(directory, "outside-backup.json");
    await writeFile(outside, "safe");
    await symlink(outside, join(directory, "project.json.bak"));

    const saved = await saveProjectDirectory(directory, secondBundle);

    assert.deepEqual(saved, {
      ok: false,
      kind: "io",
      code: "project-directory-unsafe",
    });
    assert.equal(await readFile(outside, "utf8"), "safe");
    await assert.rejects(
      readFile(join(directory, ".blooket-api-project-write.json")),
    );
    });
  },
);

test("recovery fails closed when a required backup is missing", async () => {
  await withTemporaryDirectory(async (directory) => {
    assert.deepEqual(await saveProjectDirectory(directory, firstBundle), {
      ok: true,
    });
    await rm(join(directory, "project.json.bak"), { force: true });
    await writeFile(
      join(directory, ".blooket-api-project-write.json"),
      '{"version":1,"hadProject":true,"hadMedia":true}\n',
    );

    const loaded = await loadProjectDirectory(directory);

    assert.deepEqual(loaded, {
      ok: false,
      kind: "io",
      code: "project-recovery-failed",
    });
  });
});

test(
  "unsupported project versions fail at the migration boundary",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeFile(
      join(directory, "project.json"),
      `${JSON.stringify({ ...firstProject, schemaVersion: 2 })}\n`,
    );
    await writeFile(
      join(directory, "media.jsonl"),
      `${JSON.stringify(firstMedia)}\n`,
    );

    const loaded = await loadProjectDirectory(directory);

    assert.equal(loaded.ok, false);
    if (!loaded.ok && loaded.kind === "invalid") {
      assert.equal(loaded.issues[0]?.path, "$.project.schemaVersion");
      assert.equal(loaded.issues[0]?.code, "unsupported-version");
    }
    });
  },
);

test("symbolic project files are refused instead of followed", async () => {
  await withTemporaryDirectory(async (directory) => {
    const outside = join(directory, "outside.json");
    await writeFile(outside, "safe");
    await symlink(outside, join(directory, "project.json"));
    await writeFile(join(directory, "media.jsonl"), "");

    const loaded = await loadProjectDirectory(directory);
    const saved = await saveProjectDirectory(directory, firstBundle);

    assert.deepEqual(loaded, {
      ok: false,
      kind: "io",
      code: "project-files-unreadable",
    });
    assert.deepEqual(saved, {
      ok: false,
      kind: "io",
      code: "project-directory-unsafe",
    });
    assert.equal(await readFile(outside, "utf8"), "safe");
  });
});

function mustDecode(projectJson: string, mediaJsonl: string) {
  const result = decodeProjectBundle(projectJson, mediaJsonl);
  if (!result.ok) {
    throw new Error("invalid test project bundle");
  }
  return result.value;
}
