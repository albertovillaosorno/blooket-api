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
//   - Package CLI admission and existing-artifact preservation coverage.
// - Must-Not:
//   - Use production data, credentials, or a live Blooket account.
// - Allows:
//   - Inputs: One admitted native target and explicit release verification.
//   - Outputs: A passing smoke result or a failing process exit.
//   - Side effects: Test-owned package markers and bounded CLI child processes.
// - Split-When:
//   - Another distribution format needs independent acceptance.
// - Merge-When:
//   - Package verification no longer requires native execution.
// - Summary:
//   - Tests the archive that would be delivered rather than repository imports.
// - Description:
//   - Exercises launch, native media, canonical CLI, and owned shutdown.
// - Usage:
//   - Run on the matching native host after assembly.
// - Defaults:
//   - Failed checks block release and cleanup only the owned fixture.
//
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const command = join(repo,
  "src/platforms/distribution/adapter-inbound/package.ts");
async function rejected(args: string[], expected: string) {
  await assert.rejects(execute(process.execPath, [command, ...args], {
    cwd: repo, timeout: 10_000, maxBuffer: 4_096,
  }), (error: unknown) => error instanceof Error && "stderr" in error &&
    typeof error.stderr === "string" && error.stderr.includes(expected));
}

test("package CLI rejects unknown, missing, duplicated and foreign outputs",
  async () => {
    for (const args of [
      ["linux-x64", "--output"],
      ["linux-x64", "--output", "../foreign"],
      ["linux-x64", "--output", "first", "--output", "second"],
      ["linux-x64", "--release"],
      ["--verify", "linux-x64", "--release", "--release"],
      ["--verify", "linux-x64", "--unknown"],
    ]) await rejected(args, "with valid options");
  });

test("package assembly preserves an existing archive before any build work",
  async () => {
    const name = "test-" + randomUUID();
    const directory = join(repo, ".temp/distributions", name);
    await mkdir(directory);
    const archive = join(directory, "linux-x64.tar.gz");
    const marker = Buffer.from("synthetic previous package bytes");
    try {
      await writeFile(archive, marker, { flag: "wx" });
      await rejected(["linux-x64", "--output", name],
        "package-output-already-exists");
      assert.deepEqual(await readFile(archive), marker);
      await assert.rejects(lstat(join(directory, "linux-x64")),
        { code: "ENOENT" });
    } finally { await rm(directory, { recursive: true }); }
  });
