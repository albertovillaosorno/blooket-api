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
//   - Portable real-file archive verification ingress regressions.
// - Must-Not:
//   - Install distributions, modify an existing package, or use user data.
// - Allows:
//   - Inputs: Synthetic archive bytes and owned disposable files.
//   - Outputs: Deterministic failure and byte-preservation assertions.
//   - Side effects: Temporary fixtures removed after each test.
// - Split-When:
//   - Native installer testing needs independent host-specific fixtures.
// - Merge-When:
//   - Package smoke verification no longer consumes local archives.
// - Summary:
//   - Proves archive verification never blocks on mutable source aliases.
// - Description:
//   - Exact descriptor snapshots must reject FIFOs, symlinks and oversize.
// - Usage:
//   - Run through the normal repository test runner.
// - Defaults:
//   - Preserve unrelated files and reject nonregular archive inputs.
//
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, open, readFile, rm, symlink, writeFile, mkdir } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { MAX_UPDATE_ARCHIVE_BYTES } from
  "../../../../src/ir/application-updates/contract/releases.ts";
import { snapshotDistributionVerificationArchive } from
  "../../../../src/platforms/distribution/adapter-outbound/verify.ts";

async function fixture(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "verify-package-input-"));
  try { await work(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("verification consumes an exact copied archive, not a reused path",
  async () => { await fixture(async directory => {
    const source = join(directory, "input.tar.gz");
    const staged = join(directory, "staged.tar.gz");
    const input = join(directory, "input");
    const unpacked = join(directory, "output");
    await mkdir(input);
    await mkdir(unpacked);
    await writeFile(join(input, "marker"), "verified local archive");
    const run = promisify(execFile);
    await run("tar", ["-czf", source, "-C", input, "."]);
    const bytes = await readFile(source);
    await snapshotDistributionVerificationArchive(source, staged);
    await rm(source);
    await run("tar", ["-xzf", staged, "-C", unpacked]);
    assert.deepEqual(await readFile(staged), bytes);
    assert.equal(await readFile(join(unpacked, "marker"), "utf8"),
      "verified local archive");
    await assert.rejects(snapshotDistributionVerificationArchive(staged,
      staged), { code: "EEXIST" });
    assert.deepEqual(await readFile(staged), bytes);
  }); });

test("verification archive rejects symlinks and oversized files",
  async () => { await fixture(async directory => {
    const source = join(directory, "input.tar.gz");
    const output = join(directory, "snapshot.tar.gz");
    const original = join(directory, "original.tar.gz");
    await writeFile(original, "synthetic regular file");
    await symlink(original, source);
    await assert.rejects(snapshotDistributionVerificationArchive(
      source, output));
    await rm(source);
    const oversized = await open(source, "wx");
    try { await oversized.truncate(MAX_UPDATE_ARCHIVE_BYTES + 1); }
    finally { await oversized.close(); }
    await assert.rejects(snapshotDistributionVerificationArchive(source,
      output), /distribution-archive-invalid/u);
    await rm(source);
    await writeFile(source, "");
    await assert.rejects(snapshotDistributionVerificationArchive(source,
      output), /distribution-archive-invalid/u);
    await assert.rejects(readFile(output), { code: "ENOENT" });
  }); });

test("verification archive does not block on FIFO source",
  { skip: process.platform === "win32" }, async () => {
    await fixture(async directory => {
      const fifo = join(directory, "input.tar.gz");
      const output = join(directory, "snapshot.tar.gz");
      const run = promisify(execFile);
      await run("mkfifo", [fifo]);
      const sourceModule = new URL(
        "../../../../src/platforms/distribution/adapter-outbound/" +
        "verify.ts", import.meta.url,
      ).href;
      const script = `import { snapshotDistributionVerificationArchive }` +
        ` from ${JSON.stringify(sourceModule)};` +
        `await snapshotDistributionVerificationArchive(` +
        `process.argv[1], process.argv[2]).then(` +
        `() => { throw Error("accepted-FIFO-archive"); },` +
        `() => undefined);`;
      await run(process.execPath,
        ["--input-type=module", "-e", script, fifo, output],
        { timeout: 5_000, killSignal: "SIGKILL" });
      await assert.rejects(readFile(output), { code: "ENOENT" });
    });
  });
