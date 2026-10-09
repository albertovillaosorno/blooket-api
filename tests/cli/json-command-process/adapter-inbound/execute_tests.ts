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
//   - Canonical child completion and bounded result regression coverage.
// - Must-Not:
//   - Execute arbitrary commands or expose subprocess output.
// - Allows:
//   - Inputs: Synthetic child lifecycle events.
//   - Outputs: Assertions about completion and stable failures.
//   - Side effects: Scoped test doubles only.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Tests canonical CLI child completion under failure.
// - Description:
//   - Sending a termination signal does not prove the writer has stopped.
// - Usage:
//   - Run with the Node test runner.
// - Defaults:
//   - Fixtures contain no credentials or teacher data.
//
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { executeJsonCommand } from
  "../../../../src/cli/json-command-process/adapter-inbound/execute.ts";

const operationId = "test:child-completion";
const result = { version: 1, operationId, ok: true, value: "synthetic" };

for (const failure of ["oversize", "spawn-error", "timeout",
  "publication-timeout", "stream-error", "kill-error"] as const) {
  test(`CLI ${failure} retains ownership until the child closes`, async t => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(),
      kill: (signal: string) => {
        signals.push(signal);
        if (failure === "kill-error") child.emit("error", new Error("kill"));
        return failure !== "kill-error";
      },
    });
    const signals: string[] = [];
    const spawn = t.mock.method(childProcess, "spawn", () => child);
    syncBuiltinESMExports();
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let settled = false;
      const pending = executeJsonCommand(
        failure === "publication-timeout" ? "blooket.publication.step"
          : "drafts.list", {}, operationId, "synthetic-data-root",
      );
      void pending.then(() => { settled = true; }, () => { settled = true; });
      const rejected = assert.rejects(pending, {
        message: failure === "oversize" ? "cli-result-too-large"
          : failure.endsWith("timeout") || failure === "kill-error"
            ? "cli-timeout" : "cli-unavailable",
      });
      if (failure === "oversize") {
        child.stdout.write(Buffer.alloc(2_000_001));
        // More output and another failure cannot replace the first cause.
        child.stdout.write(Buffer.alloc(2_000_001));
        child.emit("error", new Error("late failure"));
      } else if (failure === "spawn-error") {
        child.emit("error", new Error("spawn"));
      } else if (failure === "stream-error") {
        child.stdout.emit("error", new Error("pipe"));
      } else {
        t.mock.timers.tick(30_000);
        if (failure === "publication-timeout") {
          assert.deepEqual(signals, []);
          t.mock.timers.tick(95_000);
        }
      }
      await nextTurn();
      assert.equal(settled, false);
      child.stdout.write(JSON.stringify(result));
      child.emit("exit", 0);
      await nextTurn();
      assert.equal(settled, false);
      assert.deepEqual(signals, failure === "spawn-error" ? [] : ["SIGKILL"]);
      child.emit("close", 0);
      await rejected;
      assert.equal(settled, true);
    } finally {
      child.emit("close", 0);
      spawn.mock.restore();
      syncBuiltinESMExports();
    }
  });
}

test("CLI completion preserves correlation and structured failures",
  async t => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), kill: () => true,
  });
  const spawn = t.mock.method(childProcess, "spawn", () => child);
  syncBuiltinESMExports();
  try {
    for (const envelope of [result, { version: 1, operationId, ok: false,
      issues: [{ path: "$", code: "synthetic-stop", message: "Synthetic" }],
    }, { ...result, operationId: "test:another-child" }]) {
      const pending = executeJsonCommand(
        "drafts.list", {}, operationId, "synthetic-data-root",
      );
      const observed = envelope.operationId === operationId
        ? assert.doesNotReject(pending.then(value => {
            assert.deepEqual(value, envelope);
          }))
        : assert.rejects(pending, { message: "invalid-cli-result" });
      child.stdout.emit("data", Buffer.from(JSON.stringify(envelope)));
      child.emit("close", envelope.ok ? 0 : 1);
      await observed;
      // Fresh streams prevent a previous stdin end from owning the next call.
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
    }
  } finally {
    spawn.mock.restore();
    syncBuiltinESMExports();
  }
});
