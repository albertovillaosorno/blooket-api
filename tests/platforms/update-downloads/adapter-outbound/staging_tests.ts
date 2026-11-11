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
//   - Directory-sync fail-closed tests for update archive staging.
// - Must-Not:
//   - Stage live releases, install applications, or access teacher files.
// - Allows:
//   - Inputs: Synthetic directories, regular files, symlinks, and FIFOs.
//   - Outputs: Synchronous durability success or bounded rejection.
//   - Side effects: Disposable OS temporary files and isolated subprocess.
// - Split-When:
//   - Staging moves to a different atomic publication protocol.
// - Merge-When:
//   - Update staging paths share the same safe-directory contract.
// - Summary:
//   - Refuses a swapped FIFO instead of hanging at directory sync.
// - Description:
//   - Verifies valid staging and rejects non-directory replacements.
// - Usage:
//   - Run in the portable Node regression suite.
// - Defaults:
//   - Non-directories must not be accepted as successful staging.
//
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { syncStagedDirectory } from
  "../../../../src/platforms/update-downloads/adapter-outbound/staging.ts";

test("update staging sync accepts directories, not files or links",
  { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "update-stage-sync-"));
    try {
      const directory = join(root, "valid");
      await mkdir(directory);
      await syncStagedDirectory(directory);
      const file = join(root, "file");
      await writeFile(file, "bytes");
      await assert.rejects(syncStagedDirectory(file));
      const link = join(root, "link");
      await symlink(directory, link);
      await assert.rejects(syncStagedDirectory(link));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test("update staging sync refuses substituted FIFOs without blocking",
  { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "update-stage-fifo-"));
    try {
      const fifo = join(root, "replacement");
      await promisify(execFile)("mkfifo", [fifo]);
      const moduleUrl = new URL(
        "../../../../src/platforms/update-downloads/adapter-outbound/" +
        "staging.ts", import.meta.url,
      ).href;
      const script = `import { syncStagedDirectory } from ` +
        `${JSON.stringify(moduleUrl)};` +
        `await syncStagedDirectory(process.argv[1]).then(` +
        `() => { throw Error("accepted-fifo"); }, () => undefined);`;
      await promisify(execFile)(process.execPath,
        ["--input-type=module", "-e", script, fifo],
        { timeout: 3_000, killSignal: "SIGKILL" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
