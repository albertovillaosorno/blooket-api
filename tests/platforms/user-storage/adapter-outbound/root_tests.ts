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
//   - Synthetic local preference persistence and safe-descriptor checks.
// - Must-Not:
//   - Read real teacher directories or persist credential fixtures.
// - Allows:
//   - Inputs: Test-owned temporary settings files and symbolic links.
//   - Outputs: Exact defaults, prior value, and fail-closed assertions.
//   - Side effects: Temporary files, cleaned up after each test.
// - Split-When:
//   - Native preference storage needs independent acceptance fixtures.
// - Merge-When:
//   - Preference storage moves to the validated settings-file boundary.
// - Summary:
//   - Prevents a substituted symbolic file or oversized JSON from loading.
// - Description:
//   - Confirms no ambiguous read silently recreates teacher settings.
// - Usage:
//   - Run through the repository Node tests.
// - Defaults:
//   - Temporary fixture content is fictional and unprivileged.
//
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPreferences, savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "preferences-boundary-"));
  try { await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("fresh preferences are durable and the exact byte limit is admitted",
  async () => {
  await withRoot(async root => {
    const original = await loadPreferences(root);
    const path = join(root, "settings.json");
    const text = await readFile(path, "utf8");
    assert.deepEqual(await loadPreferences(root), original);
    assert.ok(text.length < 65_536);
    await writeFile(path, text.padEnd(65_536, " "));
    assert.deepEqual(await loadPreferences(root), original);
    await savePreferences(root, { ...original, locale: "es" });
    assert.equal((await loadPreferences(root)).locale, "es");
  });
  },
);

test("on-disk v3 settings migrate in memory without erasing original data",
  async () => {
  await withRoot(async root => {
    const current = await loadPreferences(root);
    const path = join(root, "settings.json");
    const { publication: _discard, ...legacy } = current;
    const prior = JSON.stringify({ ...legacy, schemaVersion: 3,
      locale: "en" }, null, 2) + "\n";
    await writeFile(path, prior);
    const migrated = await loadPreferences(root);
    assert.equal(migrated.schemaVersion, 4);
    assert.equal(migrated.locale, "en");
    assert.deepEqual(migrated.publication, current.publication);
    assert.equal(await readFile(path, "utf8"), prior);
    await savePreferences(root, { ...migrated, publication: {
      minimumStartIntervalMs: 6_000,
      maximumStartsPerMinute: 10,
      maximumTaskStarts: 8,
      maximumTaskDurationMs: 600_000,
    } });
    const modern = await loadPreferences(root);
    assert.equal(modern.schemaVersion, 4);
    assert.equal(modern.publication.minimumStartIntervalMs, 6_000);
    const priorCopy = await readFile(join(root,
      "settings.previous.json"), "utf8");
    assert.equal(priorCopy, prior);
  });
},
);

test("oversized teacher settings refuse read rather than resetting defaults",
  async () => {
  await withRoot(async root => {
    const path = join(root, "settings.json");
    const original = await loadPreferences(root);
    await writeFile(path, JSON.stringify(original).padEnd(65_537, " "));
    await assert.rejects(loadPreferences(root), /settings-unreadable/u);
    assert.equal((await readFile(path)).byteLength, 65_537);
  });
  },
);

test("dangling or external preference symlinks cannot be read or replaced",
  async () => {
  await withRoot(async root => {
    const outside = join(root, "outside.json");
    const path = join(root, "settings.json");
    const original = await loadPreferences(root);
    const text = await readFile(path, "utf8");
    await writeFile(outside, text);
    await rm(path);
    await symlink(outside, path);
    await assert.rejects(loadPreferences(root), /settings-unreadable/u);
    await assert.rejects(savePreferences(root, original));
    assert.equal(await readFile(outside, "utf8"), text);
    await rm(path);
    await symlink(join(root, "missing.json"), path);
    await assert.rejects(loadPreferences(root), /settings-unreadable/u);
    assert.equal(await readFile(outside, "utf8"), text);
  });
  },
);
