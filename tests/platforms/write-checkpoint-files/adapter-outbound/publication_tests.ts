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
//   - Filesystem tests for durable sequential write-checkpoint persistence.
// - Must-Not:
//   - Execute Blooket writes or use production project directories.
// - Allows:
//   - Inputs: Temporary checkpoint files, plans, locks, and symbolic links.
//   - Outputs: Load/save progression and refusal verdicts.
//   - Side effects: Temporary filesystem state removed after each test.
// - Split-When:
//   - Parallel checkpoint persistence needs an independent fixture suite.
// - Merge-When:
//   - Durable write checkpoints are removed.
// - Summary:
//   - Proves missing, idempotent, sequential, and unsafe-file behavior.
// - Description:
//   - Mirrors the write-checkpoint-files adapter.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - A missing file represents operation index zero.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { publicationFiles, createPublicationSnapshot,
  readPublicationSnapshot } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/write-checkpoint-files/adapter-outbound/publication.ts";

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "publication-files-"));
  try { await work(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("publication snapshots are exclusive and do not replace recovery state",
  async () => { await fixture(async root => {
    const paths = await publicationFiles(root, "draft-fixture");
    await mkdir(dirname(paths.snapshot), { recursive: true });
    assert.equal(await readPublicationSnapshot(paths.snapshot), undefined);
    await createPublicationSnapshot(paths.snapshot, { fixture: true });
    const original = await readFile(paths.snapshot, "utf8");
    await assert.rejects(createPublicationSnapshot(paths.snapshot,
      { fixture: false }));
    assert.equal(await readFile(paths.snapshot, "utf8"), original);
    assert.deepEqual(await readPublicationSnapshot(paths.snapshot),
      { fixture: true });
  }); });

test("snapshot reads reject symbolic files and oversized bytes",
  async () => { await fixture(async root => {
    const paths = await publicationFiles(root, "draft-fixture");
    await mkdir(dirname(paths.snapshot), { recursive: true });
    const target = join(root, "fixture.json");
    await writeFile(target, "{}");
    await symlink(target, paths.snapshot);
    await assert.rejects(readPublicationSnapshot(paths.snapshot));
    await rm(paths.snapshot);
    await writeFile(paths.snapshot, Buffer.alloc(1_500_001, 32));
    await assert.rejects(readPublicationSnapshot(paths.snapshot));
    await rm(paths.snapshot);
    await assert.rejects(createPublicationSnapshot(paths.snapshot,
      { fixture: "x".repeat(1_500_000) }));
    assert.equal(await readPublicationSnapshot(paths.snapshot), undefined);
  }); });
