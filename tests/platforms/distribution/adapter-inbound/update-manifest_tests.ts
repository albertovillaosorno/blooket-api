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
//   - Release-command argument, failure and secret-containment regressions.
// - Must-Not:
//   - Provision real publishers, publish artifacts, or change repository state.
// - Allows:
//   - Inputs: Ephemeral key environments and owned Git command doubles.
//   - Outputs: Sanitized CLI outcomes and credential-containment assertions.
//   - Side effects: Child processes and test-owned temporary files.
// - Split-When:
//   - Hosted release invocation needs its own authorized acceptance.
// - Merge-When:
//   - Final manifest production no longer has a command entrypoint.
// - Summary:
//   - Keeps key values out of arguments, diagnostics and Git children.
// - Description:
//   - Test keys and Git doubles never establish production CI acceptance.
// - Usage:
//   - Run through the ordinary repository test runner.
// - Defaults:
//   - Missing configuration and invalid output selectors refuse production.
//
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL(
  "../../../../src/platforms/distribution/adapter-inbound/update-manifest.ts",
  import.meta.url,
));
async function run(args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env, BLOOKET_UPDATE_SIGNING_KEY: undefined,
    BLOOKET_UPDATE_PUBLISHER_KEYS: undefined, ...extra };
  try {
    const result = await execute(process.execPath, [entry, ...args],
      { env, timeout: 15_000, maxBuffer: 65_536 });
    return { ...result, code: 0 };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
}
function keyEnvironment() {
  const keys = generateKeyPairSync("ed25519");
  return {
    BLOOKET_UPDATE_SIGNING_KEY: String(keys.privateKey.export({
      format: "pem", type: "pkcs8" })),
    BLOOKET_UPDATE_PUBLISHER_KEYS: JSON.stringify([
      String(keys.publicKey.export({ format: "pem", type: "spki" })),
    ]),
  };
}
test("manifest command requires explicit publisher inputs", async () => {
  const result = await run();
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr,
    "Release manifest unavailable: publisher-configuration-unavailable.\n");
});
test("invalid keys never appear in release diagnostics", async () => {
  const env = keyEnvironment();
  const marker = "SYNTHETIC-KEY-MUST-NOT-BE-PRINTED";
  for (const configured of [
    { ...env, BLOOKET_UPDATE_SIGNING_KEY: marker },
    { ...env, BLOOKET_UPDATE_PUBLISHER_KEYS: JSON.stringify([
      env.BLOOKET_UPDATE_SIGNING_KEY]) },
    { ...env, BLOOKET_UPDATE_PUBLISHER_KEYS: JSON.stringify([
      JSON.parse(env.BLOOKET_UPDATE_PUBLISHER_KEYS)[0] +
        env.BLOOKET_UPDATE_SIGNING_KEY]) },
  ]) {
    const result = await run([], configured);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr,
      "Release manifest unavailable: publisher-configuration-unavailable.\n");
    assert.equal(result.stderr.includes(marker), false);
    assert.equal(result.stderr.includes(env.BLOOKET_UPDATE_SIGNING_KEY), false);
  }
});
test("release output selectors cannot escape repository artifact storage",
  async () => {
    for (const args of [["../outside"], ["/tmp/outside"], ["one", "two"]]) {
      const result = await run(args, keyEnvironment());
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr,
        "Release manifest unavailable: invalid-output-name.\n");
    }
  });
test("Git observation children never receive publisher key environment",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "manifest-git-environment-"));
    try {
      // A Git double returns a dirty marker only if a signing input leaked.
      // Its clean path reaches a deliberately absent artifact directory.
      const program = "#!" + process.execPath + "\n" +
        "if (process.argv[2] === 'status') {\n" +
        "  if (process.env.BLOOKET_UPDATE_SIGNING_KEY ||\n" +
        "      process.env.BLOOKET_UPDATE_PUBLISHER_KEYS)\n" +
        "    process.stdout.write('private-env-forwarded');\n" +
        "} else process.stdout.write('a'.repeat(40));\n";
      await writeFile(join(root, "git"), program, { mode: 0o700 });
      const result = await run(["absent-fixture-" + process.pid], {
        ...keyEnvironment(), PATH: root + delimiter + process.env["PATH"],
      });
      assert.equal(result.code, 1);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout),
        { status: "manifest-failed", reason: "storage" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
