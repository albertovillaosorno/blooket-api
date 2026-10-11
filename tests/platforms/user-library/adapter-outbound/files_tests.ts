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
//   - Bounded teacher library source-byte reads on the real filesystem.
// - Must-Not:
//   - Inspect teacher directories or follow external symlinks.
// - Allows:
//   - Inputs: Test-owned regular files, links, and byte limits.
//   - Outputs: Safe read bytes or exact rejection assertions.
//   - Side effects: Temporary local fixtures removed after the tests.
// - Split-When:
//   - A new media backend needs different reader semantics.
// - Merge-When:
//   - All user library reads share a single owned byte reader.
// - Summary:
//   - Prevents oversized metadata and substituted files from being parsed.
// - Description:
//   - The aggregate YAML tests also exercise this reader transitively.
// - Usage:
//   - Run as part of the ordinary Node test suite.
// - Defaults:
//   - No real user data is required.
//
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { boundedBytes } from
  "../../../../src/platforms/user-library/adapter-outbound/files.ts";

async function withDirectory(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "library-read-"));
  try { await work(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("library reads admit exact byte thresholds and reject overflow",
  async () => {
  await withDirectory(async root => {
    const path = join(root, "image.bin");
    const payload = Buffer.from([0, 127, 255]);
    await writeFile(path, payload);
    assert.deepEqual(await boundedBytes(path, 3), payload);
    await assert.rejects(boundedBytes(path, 2),
      /invalid-or-oversized-library-file/u);
    assert.deepEqual(await readFile(path), payload);
    for (const limit of [0, -1, 2.5, NaN, Infinity, 32_000_001])
      await assert.rejects(boundedBytes(path, limit),
        /invalid-library-read-limit/u);
  });
  },
);

test("teacher library source reads never follow symbolic aliases",
  async () => {
  await withDirectory(async root => {
    const outside = join(root, "outside.bin");
    const link = join(root, "metadata.bin");
    await writeFile(outside, Buffer.from([1, 2, 3]));
    await symlink(outside, link);
    await assert.rejects(boundedBytes(link, 100));
    await rm(link);
    await symlink(join(root, "missing.bin"), link);
    await assert.rejects(boundedBytes(link, 100));
    assert.deepEqual(await readFile(outside), Buffer.from([1, 2, 3]));
  });
  },
);
