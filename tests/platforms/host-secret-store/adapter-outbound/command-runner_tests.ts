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
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";

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
    captureStdout: true,
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
    timeoutMs: 50,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "secret-command-timeout",
  });
});

test("runner drains uncaptured stdout without retaining it", async () => {
  const result = await runSecretCommand({
    command: process.execPath,
    args: ["-e", "process.stdout.write('discard-me')"],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.stdout.byteLength, 0);
  }
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
      "process.stdin.pipe(process.stderr)",
    ],
    stdin: Buffer.from(secret, "utf8"),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.stderrBytes, Buffer.byteLength(secret));
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


for (const failure of ["output-limit", "child-error",
  "stdin-error", "stdout-error", "stderr-error"] as const) {
  test(`runner ${failure} keeps the child owned until close`, async t => {
    const signals: string[] = [];
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: (signal: string) => { signals.push(signal); return true; },
    });
    const spawn = t.mock.method(childProcess, "spawn", () => child);
    syncBuiltinESMExports();
    try {
      let settled = false;
      const pending = runSecretCommand({ command: "synthetic", args: [],
        captureStdout: true });
      void pending.then(() => { settled = true; }, () => { settled = true; });
      if (failure === "output-limit")
        child.stdout.emit("data", Buffer.alloc(140_000));
      else if (failure === "child-error")
        child.emit("error", new Error("spawn-failed"));
      else child[failure === "stdin-error" ? "stdin" :
        failure === "stdout-error" ? "stdout" : "stderr"]
        .emit("error", new Error("stream-failed"));
      await nextTurn();
      assert.equal(settled, false, "a signal is not subprocess completion");
      assert.deepEqual(signals, failure === "child-error"
        ? [] : ["SIGKILL"]);
      child.emit("close", null, failure === "child-error"
        ? null : "SIGKILL");
      assert.deepEqual(await pending, { ok: false,
        code: failure === "output-limit"
          ? "secret-command-output-too-large"
          : "secret-command-unavailable",
      });
      assert.equal(settled, true);
    } finally {
      child.emit("close", null, null);
      spawn.mock.restore();
      syncBuiltinESMExports();
    }
  });
}


test("runner timeout retains subprocess ownership until close", async t => {
  const signals: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: (signal: string) => { signals.push(signal); return true; },
  });
  const spawn = t.mock.method(childProcess, "spawn", () => child);
  syncBuiltinESMExports();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let settled = false;
    const pending = runSecretCommand({ command: "synthetic", args: [],
      timeoutMs: 50 });
    void pending.then(() => { settled = true; }, () => { settled = true; });
    t.mock.timers.tick(50);
    await nextTurn();
    assert.equal(settled, false);
    assert.deepEqual(signals, ["SIGKILL"]);
    child.emit("error", new Error("late-kill-error"));
    child.stdout.emit("data", Buffer.alloc(200_000));
    child.emit("close", null, "SIGKILL");
    assert.deepEqual(await pending, { ok: false,
      code: "secret-command-timeout" });
  } finally {
    child.emit("close", null, null);
    spawn.mock.restore();
    syncBuiltinESMExports();
  }
});
