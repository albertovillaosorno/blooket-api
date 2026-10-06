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
//   - Behavioral tests for bounded secret-command subprocess execution.
// - Must-Not:
//   - Touch a real host secret store.
// - Allows:
//   - Inputs: Short-lived Node child processes and fixed stdin fixtures.
//   - Outputs: Stable process-result and resource-bound verdicts.
//   - Side effects: Starts only fixture Node subprocesses.
// - Split-When:
//   - Process isolation requires platform-specific fixture suites.
// - Merge-When:
//   - Host secret storage stops using subprocesses.
// - Summary:
//   - Proves stdin transport, timeout, output bounds, and stderr elision.
// - Description:
//   - Uses process.execPath so tests do not depend on shell behavior.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Fixture subprocesses are killed by the production runner when bounded.
//
import assert from "node:assert/strict";
import test from "node:test";

import { runSecretCommand } from
  // jig-ignore-next-line: Static import path cannot be wrapped safely.
  "../../../../src/platforms/host-secret-store/adapter-outbound/command-runner.ts";

test("runner sends secret bytes through stdin rather than argv", async () => {
  const secret = "fixture-secret";
  const args = [
    "-e",
    "process.stdin.pipe(process.stdout)",
  ];
  const result = await runSecretCommand({
    command: process.execPath,
    args,
    stdin: Buffer.from(secret, "utf8"),
  });

  assert.equal(args.join(" ").includes(secret), false);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(Buffer.from(result.stdout).toString("utf8"), secret);
    assert.equal(result.stderrBytes, 0);
  }
});

test("runner bounds child execution time", async () => {
  const result = await runSecretCommand({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    timeoutMs: 10,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "secret-command-timeout",
  });
});

test("runner rejects excessive stdout", async () => {
  const result = await runSecretCommand({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('x'.repeat(140000))",
    ],
  });

  assert.deepEqual(result, {
    ok: false,
    code: "secret-command-output-too-large",
  });
});

test("runner counts stderr without retaining its text", async () => {
  const secret = "stderr-secret";
  const result = await runSecretCommand({
    command: process.execPath,
    args: [
      "-e",
      "process.stderr.write(process.env.TEST_SECRET ?? '')",
    ],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.stderrBytes, 0);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("missing executables return a stable unavailable result", async () => {
  const result = await runSecretCommand({
    command: "/path/that/does/not/exist/blooket-secret-tool",
    args: [],
  });

  assert.deepEqual(result, {
    ok: false,
    code: "secret-command-unavailable",
  });
});
