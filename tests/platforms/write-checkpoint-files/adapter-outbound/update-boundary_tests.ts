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
//   - Shared publication ownership and bounded attempt-file observation.
// - Must-Not:
//   - Install apps, inspect lesson content, reconcile, or delete journals.
// - Allows:
//   - Inputs: The trusted local user-data root.
//   - Outputs: An exclusive lock and attempt presence or storage failure.
//   - Side effects: Owned lock files and read-only directory iteration.
// - Split-When:
//   - Another persistent writer needs an independent update boundary.
// - Merge-When:
//   - Publication storage no longer crosses process boundaries.
// - Summary:
//   - Prevents new publication work while update composition inspects attempts.
// - Description:
//   - Unknown storage and symbolic paths fail closed without reading content.
// - Usage:
//   - Hold the boundary through observation and the entire safe restart.
// - Defaults:
//   - At most ten thousand publication folders and eight entries per folder.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, readFile, writeFile } from
  "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquirePublicationBoundary, publicationAttemptPresent } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/write-checkpoint-files/adapter-outbound/update-boundary.ts";

test("publication observation refuses an oversized physical catalog",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "publication-catalog-bound-"));
  try {
    const directory = join(root, "publications");
    await mkdir(directory);
    for (let offset = 0; offset < 10_001; offset += 64) {
      const count = Math.min(64, 10_001 - offset);
      await Promise.all(Array.from({ length: count }, (_, index) =>
        mkdir(join(directory, (offset + index).toString(16).padStart(64, "0"))),
      ));
    }
    const boundary = await acquirePublicationBoundary(root);
    assert.ok(boundary.ok);
    try {
      await assert.rejects(publicationAttemptPresent(root), {
        message: "publication-storage-unsafe",
      });
    } finally { await boundary.lock.release(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("any write-attempt journal blocks replacement without touching evidence",
  async () => {
  for (const contents of [
    '{"schemaVersion":3,"phase":"attempting"}\n',
    '{"schemaVersion":3,"phase":"confirmed"}\n',
    '{"corrupt":',
  ]) {
    const root = await mkdtemp(join(tmpdir(), "publication-attempt-stop-"));
    try {
      const directory = join(root, "publications", createHash("sha256")
        .update("synthetic-draft").digest("hex"));
      await mkdir(directory, { recursive: true });
      const file = join(directory, "attempt.json");
      await writeFile(file, contents);
      const boundary = await acquirePublicationBoundary(root);
      assert.ok(boundary.ok);
      if (!boundary.ok) continue;
      try {
        assert.equal(await publicationAttemptPresent(root), true);
        assert.equal(await readFile(file, "utf8"), contents);
        const second = await acquirePublicationBoundary(root);
        assert.equal(second.ok, false);
      } finally { await boundary.lock.release(); }
      assert.equal(await readFile(file, "utf8"), contents);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  },
);
