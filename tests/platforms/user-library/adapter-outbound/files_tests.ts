// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - MIT
// Confidential:
//   - false
// License-File:
//   - LICENSE
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
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
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

// The bounded source reader must not wait for a writer on a named pipe.
test("teacher library FIFO sources are refused without blocking",
  async () => { await withDirectory(async root => {
    const file = join(root, "image.bin");
    const run = promisify(execFile);
    await run("mkfifo", [file]);
    const moduleUrl = new URL(
      "../../../../src/platforms/user-library/adapter-outbound/files.ts",
      import.meta.url,
    ).href;
    const script =
      `import { boundedBytes } from ${JSON.stringify(moduleUrl)};` +
      "try { await boundedBytes(process.argv[1], 10);" +
      "process.stdout.write('unexpected-success'); }" +
      "catch (error) { process.stdout.write(error.message); }";
    const { stdout } = await run(process.execPath,
      ["--input-type=module", "--eval", script, file],
      { timeout: 8_000 });
    assert.equal(stdout, "invalid-or-oversized-library-file");
  }); },
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
