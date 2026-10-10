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
  readPublicationSnapshot, readOtherPublicationSnapshots } from
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

test("sibling snapshot lookup skips its own snapshot and unrelated metadata",
  async () => { await fixture(async root => {
    assert.deepEqual(await readOtherPublicationSnapshots(root, "alpha"), []);
    const alpha = await publicationFiles(root, "alpha");
    const beta = await publicationFiles(root, "beta");
    await mkdir(dirname(alpha.snapshot), { recursive: true });
    await mkdir(dirname(beta.snapshot), { recursive: true });
    const a = { draftId: "alpha", revision: "test-a" };
    const b = { draftId: "beta", revision: "test-b" };
    await createPublicationSnapshot(alpha.snapshot, a);
    await createPublicationSnapshot(beta.snapshot, b);
    await writeFile(join(root, "publications", ".DS_Store"), "metadata");
    assert.deepEqual(await readOtherPublicationSnapshots(root, "alpha"), [
      { draftId: "beta", data: b },
    ]);
    assert.deepEqual(await readOtherPublicationSnapshots(root, "beta"), [
      { draftId: "alpha", data: a },
    ]);
  }); },
);

test("sibling snapshots reject forged IDs and symbolic entries",
  async () => { await fixture(async root => {
    const beta = await publicationFiles(root, "beta");
    await mkdir(dirname(beta.snapshot), { recursive: true });
    await createPublicationSnapshot(beta.snapshot, { draftId: "forged" });
    await assert.rejects(readOtherPublicationSnapshots(root, "alpha"));
    await rm(beta.snapshot);
    await writeFile(beta.snapshot, JSON.stringify({ draftId: "beta" }));
    const outside = join(root, "outside.json");
    await writeFile(outside, JSON.stringify({ draftId: "alpha" }));
    await symlink(outside, join(root, "publications", "symlink"));
    await assert.rejects(readOtherPublicationSnapshots(root, "alpha"));
    await rm(join(root, "publications", "symlink"));
    await rm(beta.snapshot);
    await symlink(outside, beta.snapshot);
    await assert.rejects(readOtherPublicationSnapshots(root, "alpha"));
    await rm(beta.snapshot);
    await writeFile(beta.snapshot, JSON.stringify({ draftId: "beta" }));
    assert.deepEqual(await readOtherPublicationSnapshots(root, "alpha"), [
      { draftId: "beta", data: { draftId: "beta" } },
    ]);
  }); },
);

test("sibling publication scans enforce bounded snapshots",
  async () => { await fixture(async root => {
    const beta = await publicationFiles(root, "beta");
    await mkdir(dirname(beta.snapshot), { recursive: true });
    await writeFile(beta.snapshot, "x".repeat(1_500_001));
    await assert.rejects(readOtherPublicationSnapshots(root, "alpha"));
    await rm(beta.snapshot);
    await writeFile(beta.snapshot, "{invalid-json");
    await assert.rejects(readOtherPublicationSnapshots(root, "alpha"));
  }); },
);

test("sibling scan rejects aggregate snapshot size beyond its byte budget",
  async () => { await fixture(async root => {
    // Each individual snapshot is under the file limit, but the aggregate
    // needs a separate cap to avoid memory exhaustion on user machines.
    for (let index = 0; index < 17; index++) {
      const draftId = "large-draft-" + index;
      const paths = await publicationFiles(root, draftId);
      await mkdir(dirname(paths.snapshot), { recursive: true });
      const data = JSON.stringify({ draftId, filler: "x".repeat(1_490_000) });
      await writeFile(paths.snapshot, data);
    }
    await assert.rejects(readOtherPublicationSnapshots(root, "other"));
  }); },
);

test("orphan journal evidence without a snapshot stops sibling reuse",
  async () => { await fixture(async root => {
    const orphan = await publicationFiles(root, "orphan");
    await mkdir(dirname(orphan.snapshot), { recursive: true });
    assert.deepEqual(await readOtherPublicationSnapshots(root, "alpha"), []);
    for (const evidence of [orphan.attempt, orphan.checkpoint,
      orphan.budget]) {
      await writeFile(evidence, "{maybe-a-prior-write}");
      await assert.rejects(readOtherPublicationSnapshots(root, "alpha"),
        /publication-storage-unavailable/u);
      await rm(evidence);
    }
    assert.deepEqual(await readOtherPublicationSnapshots(root, "alpha"), []);
  }); },
);
