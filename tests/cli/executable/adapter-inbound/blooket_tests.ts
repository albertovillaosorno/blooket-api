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
//   - Subprocess tests for the Node blooket CLI file input boundary.
// - Must-Not:
//   - Contact Blooket, load credentials, or modify user files.
// - Allows:
//   - Inputs: Synthetic media metadata and local named pipes.
//   - Outputs: CLI exit status and sanitized JSON failure assertions.
//   - Side effects: Test-owned temporary files removed after each test.
// - Split-When:
//   - A native launcher needs separate process-level coverage.
// - Merge-When:
//   - The CLI executable stops reading local file inputs.
// - Summary:
//   - Confirms regular-file input and prompt refusal of blocking pipes.
// - Description:
//   - Exercises real executable wiring, not a mocked CLI readText port.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - No live Blooket login or service is required.
//
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const executable = fileURLToPath(new URL(
  "../../../../src/cli/executable/adapter-inbound/blooket.ts",
  import.meta.url,
));

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blooket-cli-files-"));
  try { await work(root); }
  finally { await rm(root, { force: true, recursive: true }); }
}

test("CLI rejects FIFO media inputs without waiting for a writer", async () => {
  await fixture(async root => {
    const source = join(root, "media.fifo");
    await run("mkfifo", [source]);
    const failure = await run(process.execPath,
      [executable, "media", "search", "sun", "--media", source, "--json"],
      { timeout: 8_000 }).then(
      () => assert.fail("a named pipe must not succeed"),
      error => error,
    );
    assert.equal(failure.code, 3);
    assert.equal(failure.stderr, "");
    const result = JSON.parse(failure.stdout);
    assert.equal(result.ok, false);
    assert.equal(result.issues[0]?.code, "file-read-failed");
    assert.equal(failure.stdout.includes(source), false);
  });
});

test("CLI continues to read regular and caller-selected symbolic files",
  async () => {
    await fixture(async root => {
      const source = join(root, "media.jsonl");
      const alias = join(root, "media-link.jsonl");
      await writeFile(source, JSON.stringify({
        id: "sun", path: "media/sun.png",
        description: "A bright yellow sun.", english: true,
      }) + "\n");
      await symlink(source, alias);
      for (const path of [source, alias]) {
        const { stdout, stderr } = await run(process.execPath,
          [executable, "media", "search", "sun", "--media", path, "--json"],
          { timeout: 8_000 });
        assert.equal(stderr, "");
        const result = JSON.parse(stdout);
        assert.equal(result.ok, true);
      }
    });
  });
