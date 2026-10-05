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
//   - Filesystem tests for durable atomic local replacement.
// - Must-Not:
//   - Test project serialization or choose production user paths.
// - Allows:
//   - Inputs: Temporary local files and deliberate symbolic links.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: Temporary filesystem writes removed after each test.
// - Split-When:
//   - Host-specific replacement implementations need separate fixtures.
// - Merge-When:
//   - Atomic file replacement no longer has a platform adapter.
// - Summary:
//   - Verifies replacement, backup, permissions, and safe cleanup.
// - Description:
//   - Mirrors src/platforms/atomic-files/adapter-outbound/atomic-file.ts.
// - Usage:
//   - Run on Linux now and macOS before release promotion.
// - Defaults:
//   - Test state lives only in the operating-system temporary directory.
//
import assert from "node:assert/strict";
import {
  lstat,
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

import { writeAtomicFile } from
  "../../../../src/platforms/atomic-files/adapter-outbound/atomic-file.ts";

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-api-atomic-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("atomic writes create an owner-only file", async () => {
  await withTemporaryDirectory(async (directory) => {
    const target = join(directory, "project.json");
    await writeAtomicFile(target, "new");

    assert.equal(await readFile(target, "utf8"), "new");
    const metadata = await lstat(target);
    assert.equal(metadata.mode & 0o777, 0o600);
  });
});

test("atomic replacement preserves the previous value in backup", async () => {
  await withTemporaryDirectory(async (directory) => {
    const target = join(directory, "project.json");
    const backup = join(directory, "project.json.bak");
    await writeFile(target, "old", { mode: 0o600 });

    await writeAtomicFile(target, "new", { backupPath: backup });

    assert.equal(await readFile(target, "utf8"), "new");
    assert.equal(await readFile(backup, "utf8"), "old");
  });
});

test("atomic replacement leaves no generated temporary files", async () => {
  await withTemporaryDirectory(async (directory) => {
    const target = join(directory, "settings.json");
    await writeAtomicFile(target, "value");

    const names = await readdir(directory);
    assert.deepEqual(names, ["settings.json"]);
  });
});

test("atomic replacement refuses symbolic targets", async () => {
  await withTemporaryDirectory(async (directory) => {
    const realTarget = join(directory, "real.json");
    const symbolicTarget = join(directory, "project.json");
    await writeFile(realTarget, "safe", { mode: 0o600 });
    await symlink(realTarget, symbolicTarget);

    await assert.rejects(writeAtomicFile(symbolicTarget, "unsafe"));
    assert.equal(await readFile(realTarget, "utf8"), "safe");
    assert.equal((await lstat(symbolicTarget)).isSymbolicLink(), true);
  });
});
