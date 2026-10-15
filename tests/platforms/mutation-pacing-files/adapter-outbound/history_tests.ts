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
//   - Synthetic crash/restart pacing history and file-safety regression tests.
// - Must-Not:
//   - Use real account state, provider APIs, or teacher data paths.
// - Allows:
//   - Inputs: Disposable files and deterministic epoch clocks.
//   - Outputs: Fail-closed admission and durable history assertions.
//   - Side effects: Only temporary private files removed after tests.
// - Split-When:
//   - Another runtime needs different persistence admission contracts.
// - Merge-When:
//   - Account pacing history no longer survives service restarts.
// - Summary:
//   - Proves durable start intervals across simulated service restarts.
// - Description:
//   - No uncertain result permits a new mutation without a fresh reservation.
// - Usage:
//   - Run with the repository Node test suite.
// - Defaults:
//   - Corrupt or unsafe evidence blocks writes rather than resetting history.
//
import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveDurableMutationStart } from
  "../../../../src/platforms/mutation-pacing-files/adapter-outbound/history.ts";

const POLICY = {
  minimumStartIntervalMs: 2_000,
  maximumStartsPerMinute: 2,
};
async function fixture(run: (file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "mutation-pacing-history-"));
  try { await run(join(root, "starts.json")); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const reserve = (file: string, time: number,
  policy = POLICY) => reserveDurableMutationStart(file, policy, () => time);

test("persistent start history survives a fresh caller and restart",
  async () => {
  await fixture(async file => {
    assert.deepEqual(await reserve(file, 10_000), { kind: "admitted" });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await assert.rejects(lstat(file + ".lock"), /ENOENT/u);
    const initial = await readFile(file, "utf8");
    assert.deepEqual(await reserve(file, 10_500),
      { kind: "wait", waitMs: 1_500 });
    assert.equal(await readFile(file, "utf8"), initial);
    assert.deepEqual(await reserve(file, 12_000), { kind: "admitted" });
    assert.deepEqual(await reserve(file, 14_000),
      { kind: "wait", waitMs: 56_000 });
    assert.deepEqual(await reserve(file, 70_000), { kind: "admitted" });
    const history = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(history, {
      schemaVersion: 1, lastStartMs: 70_000, starts: [12_000, 70_000],
    });
  });
});

test("concurrent writers cannot reserve the same first start", async () => {
  await fixture(async file => {
    const results = await Promise.allSettled(Array.from({ length: 8 },
      () => reserve(file, 20_000)));
    const admitted = results.filter(r => r.status === "fulfilled" &&
      r.value.kind === "admitted");
    assert.equal(admitted.length, 1);
    for (const result of results) {
      if (result.status === "fulfilled")
        assert.ok(result.value.kind === "admitted" ||
          result.value.waitMs >= 2_000);
    }
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(saved.starts, [20_000]);
  });
});

test("stricter interval and minute quota apply to prior stored starts",
  async () => { await fixture(async file => {
    const generous = { minimumStartIntervalMs: 2_000,
      maximumStartsPerMinute: 20 };
    assert.deepEqual(await reserve(file, 100_000, generous),
      { kind: "admitted" });
    assert.deepEqual(await reserve(file, 102_000, generous),
      { kind: "admitted" });
    const stricter = { minimumStartIntervalMs: 10_000,
      maximumStartsPerMinute: 1 };
    assert.deepEqual(await reserve(file, 105_000, stricter),
      { kind: "wait", waitMs: 57_000 });
    assert.deepEqual(await reserve(file, 162_000, stricter),
      { kind: "admitted" });
  }); },
);

test("malformed, rollback and future histories remain unchanged", async () => {
  await fixture(async file => {
    assert.deepEqual(await reserve(file, 100_000),
      { kind: "admitted" });
    const text = await readFile(file, "utf8");
    for (const clock of [99_999, Number.NaN, Infinity, -1]) {
      await assert.rejects(reserve(file, clock),
        /mutation-pacing-history-unavailable/u);
      assert.equal(await readFile(file, "utf8"), text);
    }
    for (const value of ["not-json", "{}", JSON.stringify({
      schemaVersion: 1, starts: [0, 1], lastStartMs: 0,
    }), JSON.stringify({
      schemaVersion: 1, starts: [1, 2], lastStartMs: 2, extra: true,
    }), JSON.stringify({
      schemaVersion: 1, starts: Array(21).fill(1), lastStartMs: 1,
    }), "x".repeat(4_097)]) {
      await writeFile(file, value);
      await assert.rejects(reserve(file, 200_000),
        /mutation-pacing-history-unavailable/u);
      assert.equal(await readFile(file, "utf8"), value);
    }
  });
});

test("symlinked pacing ledger cannot escape its owned data root", async () => {
  await fixture(async file => {
    const outside = file + ".outside";
    await writeFile(outside, "fixture private outside bytes");
    await symlink(outside, file);
    await assert.rejects(reserve(file, 2_000),
      /mutation-pacing-history-unavailable/u);
    assert.equal(await readFile(outside, "utf8"),
      "fixture private outside bytes");
  });
});

test("symbolic lock files block reservations without touching the target",
  async () => { await fixture(async file => {
  const outside = file + ".outside";
  await writeFile(outside, "owner-controlled-external-file");
  await symlink(outside, file + ".lock");
  await assert.rejects(reserve(file, 2_000),
    /mutation-pacing-history-unavailable/u);
  assert.equal(await readFile(outside, "utf8"),
    "owner-controlled-external-file");
  await assert.rejects(readFile(file, "utf8"));
  }); },
);

test("a successful reservation counts even without a provider receipt",
  async () => { await fixture(async file => {
    assert.deepEqual(await reserve(file, 0), { kind: "admitted" });
    assert.deepEqual(await reserve(file, 1_000),
      { kind: "wait", waitMs: 1_000 });
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(saved.starts, [0]);
  }); },
);

test("duplicate JSON keys and noncanonical history cannot reset starts",
  async () => { await fixture(async file => {
  const tampered = [
    '{"schemaVersion":1,"lastStartMs":10,"starts":[10],"starts":[2]}\n',
    '{"starts":[10],"schemaVersion":1,"lastStartMs":10}\n',
    '{ "schemaVersion":1,"lastStartMs":10,"starts":[10]}\n',
    '{"schemaVersion":1,"lastStartMs":10,"starts":[10]}',
  ];
  for (const text of tampered) {
    await writeFile(file, text);
    await assert.rejects(reserve(file, 100_000),
      /mutation-pacing-history-unavailable/u);
    assert.equal(await readFile(file, "utf8"), text);
  }
  }); },
);

test("runtime pacing policy getters and symbols are never evaluated",
  async () => { await fixture(async file => {
  let evaluated = 0;
  const accessor = { ...POLICY };
  Object.defineProperty(accessor, "maximumStartsPerMinute", {
    enumerable: true,
    get() { evaluated++; throw Error("untrusted getter"); },
  });
  await assert.rejects(reserveDurableMutationStart(file, accessor, () => 0),
    /mutation-pacing-history-unavailable/u);
  assert.equal(evaluated, 0);
  const symbolPolicy = { ...POLICY, [Symbol("extra")]: "untrusted" };
  await assert.rejects(reserveDurableMutationStart(file, symbolPolicy),
    /mutation-pacing-history-unavailable/u);
  await assert.rejects(readFile(file, "utf8"));
  }); },
);

test("historical timestamps are strictly nondecreasing and count-bounded",
  async () => { await fixture(async file => {
  const invalid = [
    { schemaVersion: 1, starts: [10, 9], lastStartMs: 9 },
    { schemaVersion: 1, starts: [10, "11"], lastStartMs: 11 },
    { schemaVersion: 1, starts: [], lastStartMs: 0 },
    { schemaVersion: 1, starts: [100], lastStartMs: 99 },
    { schemaVersion: 1, starts: [-1], lastStartMs: -1 },
  ];
  for (const entry of invalid) {
    const before = JSON.stringify(entry);
    await writeFile(file, before);
    await assert.rejects(reserve(file, 20_000),
      /mutation-pacing-history-unavailable/u);
    assert.equal(await readFile(file, "utf8"), before);
  }
  }); },
);
