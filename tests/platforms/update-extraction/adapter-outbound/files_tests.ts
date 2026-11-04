// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - LicenseRef-Proprietary
// Confidential:
//   - true
// License-File:
//   - LICENSE
//
// Boundary-Contract:
// - Owns:
//   - Update archive snapshot and extracted-file reading regressions.
// - Must-Not:
//   - Install software, use credentials, or assert native Apple trust.
// - Allows:
//   - Inputs: Test-owned regular files and substituted named pipes.
//   - Outputs: Bounded refusal and byte-integrity test verdicts.
//   - Side effects: Temporary local files removed after each test.
// - Split-When:
//   - A host-specific extraction reader needs separate coverage.
// - Merge-When:
//   - Archive staging no longer opens local file descriptors.
// - Summary:
//   - Verifies archive and extracted-file readers refuse blocking pipes.
// - Description:
//   - Checks descriptor-time type validation and preserved regular bytes.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Synthetic fixtures never require an update or installation.
//
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { hashFile, snapshotArchive, syncDirectory } from
  "../../../../src/platforms/update-extraction/adapter-outbound/files.ts";

const run = promisify(execFile);
const moduleUrl = new URL(
  "../../../../src/platforms/update-extraction/adapter-outbound/files.ts",
  import.meta.url,
).href;

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "update-files-"));
  try { await work(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

// A swapped named pipe cannot hold the installer at open() before cancellation
// and the regular-file type check have a chance to run.
test("archive snapshots reject FIFO sources without blocking", async () => {
  await fixture(async root => {
    const source = join(root, "source.fifo");
    const destination = join(root, "copy.zip");
    await run("mkfifo", [source]);
    const script =
      `import { snapshotArchive } from ${JSON.stringify(moduleUrl)};` +
      "try { await snapshotArchive(process.argv[1], process.argv[2], " +
      "{ size: 0 }, new AbortController().signal); " +
      "process.stdout.write('unexpected-success'); } " +
      "catch (error) { process.stdout.write(error.message); }";
    const { stdout } = await run(process.execPath,
      ["--input-type=module", "--eval", script, source, destination],
      { timeout: 8_000 });
    assert.equal(stdout, "archive-bytes");
    await assert.rejects(stat(destination), { code: "ENOENT" });
  });
});

test("extracted-file hashing rejects FIFO sources without blocking",
  async () => {
  await fixture(async root => {
    const source = join(root, "extracted.fifo");
    await run("mkfifo", [source]);
    const script =
      `import { hashFile } from ${JSON.stringify(moduleUrl)};` +
      "try { await hashFile(process.argv[1], " +
      "new AbortController().signal); " +
      "process.stdout.write('unexpected-success'); } " +
      "catch (error) { process.stdout.write(error.message); }";
    const { stdout } = await run(process.execPath,
      ["--input-type=module", "--eval", script, source],
      { timeout: 8_000 });
    assert.equal(stdout, "extracted-bytes");
  });
});

test("directory syncing refuses FIFO paths without blocking", async () => {
  await fixture(async root => {
    const source = join(root, "directory.fifo");
    await run("mkfifo", [source]);
    const script =
      `import { syncDirectory } from ${JSON.stringify(moduleUrl)};` +
      "try { await syncDirectory(process.argv[1]); " +
      "process.stdout.write('unexpected-success'); } " +
      "catch { process.stdout.write('rejected'); }";
    const { stdout } = await run(process.execPath,
      ["--input-type=module", "--eval", script, source],
      { timeout: 8_000 });
    assert.equal(stdout, "rejected");
    await syncDirectory(root);
  });
});

test("regular archive snapshots and file hashes preserve exact bytes",
  async () => {
    await fixture(async root => {
      const source = join(root, "archive.zip");
      const destination = join(root, "snapshot.zip");
      const bytes = Buffer.from([0, 1, 2, 0xff, 3, 4]);
      const digest = createHash("sha256").update(bytes).digest("hex");
      await writeFile(source, bytes);
      await snapshotArchive(source, destination, {
        target: "darwin-arm64", name: "darwin-arm64.zip",
        url: "https://example.invalid/archive.zip", size: bytes.length,
        sha256: digest,
      }, new AbortController().signal);
      assert.deepEqual(await readFile(destination), bytes);
      assert.equal((await stat(destination)).mode & 0o777, 0o400);
      assert.equal(await hashFile(destination, new AbortController().signal),
        digest);
    });
  });
