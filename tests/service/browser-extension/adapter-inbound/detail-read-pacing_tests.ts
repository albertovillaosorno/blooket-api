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
//   - Deterministic deadline regressions for native detail-read pacing.
// - Must-Not:
//   - Launch a browser, contact Blooket, or alter persistent Chrome state.
// - Allows:
//   - Inputs: Synthetic browser tab transitions and a monotonic test clock.
//   - Outputs: Assertions on confirmed routes and time-budget failures.
//   - Side effects: Test-local lease and pause counters.
// - Split-When:
//   - Another browser requires a different test fixture.
// - Merge-When:
//   - Read navigation becomes independently verified by another owner.
// - Summary:
//   - Prevents metadata read bursts without extending the read budget.
// - Description:
//   - Exercises cooldown, overlapping jobs, and expired admission.
// - Usage:
//   - Run through the repository Node test suite.
// - Defaults:
//   - No provider requests or retries are performed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { createDetailReadPacer } from
  // jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/service/browser-extension/adapter-inbound/detail-read-pacing.ts";

function fixture() {
  let tick = 0;
  let budget = 8_000;
  const waits: number[] = [];
  const acquire = createDetailReadPacer({
    now: () => tick,
    wait: async ms => { waits.push(ms); tick += ms; budget -= ms; },
  });
  return { acquire: () => acquire(() => budget), waits,
    advance: (ms: number) => { tick += ms; },
    budget: (ms: number) => { budget = ms; },
  };
}

test("metadata reads wait five seconds after completion, not admission",
  async () => {
  const f = fixture();
  const release = await f.acquire();
  assert.ok(release);
  assert.deepEqual(f.waits, []);
  f.advance(2_000);
  release();
  f.advance(750);
  const second = await f.acquire();
  assert.ok(second);
  assert.deepEqual(f.waits, [4_250]);
  second();
});

test("an old release cannot unlock a later read", async () => {
  const f = fixture();
  const first = await f.acquire();
  assert.ok(first);
  assert.equal(await f.acquire(), undefined);
  first();
  const second = await f.acquire();
  assert.ok(second);
  first();
  assert.equal(await f.acquire(), undefined);
  second();
});

test("a cooldown cannot consume the entire existing read budget", async () => {
  const f = fixture();
  (await f.acquire())!();
  f.budget(5_000);
  assert.equal(await f.acquire(), undefined);
  assert.deepEqual(f.waits, []);
  f.advance(5_000);
  assert.ok(await f.acquire());
});

test("an overdue wait does not authorize a read or keep its lease",
  async () => {
  let tick = 0;
  let remaining = 8_000;
  const acquire = createDetailReadPacer({
    now: () => tick,
    wait: async () => { tick += 8_000; remaining = 0; },
  });
  (await acquire(() => remaining))!();
  assert.equal(await acquire(() => remaining), undefined);
  remaining = 8_000;
  assert.ok(await acquire(() => remaining));
});

test("a rejected wait releases admission without bypassing cooldown",
  async () => {
  let tick = 0;
  const acquire = createDetailReadPacer({
    now: () => tick,
    wait: async () => { throw new Error("wait interrupted"); },
  });
  (await acquire(() => 8_000))!();
  await assert.rejects(acquire(() => 8_000), /wait interrupted/u);
  tick = 5_000;
  assert.ok(await acquire(() => 8_000));
});

test("an overlapping job cannot pass a waiting admission", async () => {
  let tick = 0;
  let finishWait!: () => void;
  const waiting = new Promise<void>(resolve => { finishWait = resolve; });
  const acquire = createDetailReadPacer({
    now: () => tick,
    wait: async () => { await waiting; tick = 5_000; },
  });
  (await acquire(() => 8_000))!();
  const next = acquire(() => 8_000);
  assert.equal(await acquire(() => 8_000), undefined);
  finishWait();
  assert.ok(await next);
});


test("an invalid pacing clock never authorizes native metadata actions",
  async () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, -1]) {
    let tick = invalid;
    const acquire = createDetailReadPacer({
      now: () => tick,
      wait: async () => { throw Error("an invalid clock must not wait"); },
    });
    assert.equal(await acquire(() => 8_000), undefined);
    tick = 10_000;
    assert.equal(await acquire(() => 8_000), undefined,
      "an invalid clock must not be repaired by an arbitrary next sample");
  }
});

test("a failed release-clock sample frees the lease but blocks new reads",
  async () => {
  let tick = 1_000;
  let throwClock = false;
  const acquire = createDetailReadPacer({
    now: () => {
      if (throwClock) throw Error("clock lost");
      return tick;
    },
    wait: async () => {},
  });
  const release = await acquire(() => 8_000);
  assert.ok(release);
  throwClock = true;
  assert.doesNotThrow(release);
  throwClock = false;
  tick = 8_000;
  assert.equal(await acquire(() => 8_000), undefined);
});

test("clock rollback after a valid lease blocks future metadata reads",
  async () => {
  let tick = 10_000;
  const acquire = createDetailReadPacer({
    now: () => tick,
    wait: async ms => { tick += ms; },
  });
  const release = await acquire(() => 8_000);
  assert.ok(release);
  release();
  tick = 9_999;
  assert.equal(await acquire(() => 8_000), undefined);
  tick = 20_000;
  assert.equal(await acquire(() => 8_000), undefined);
});


test("nonfinite or exhausted remaining budgets cannot admit a detail read",
  async () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, -1, 0]) {
    const acquire = createDetailReadPacer({
      now: () => 2_000,
      wait: async () => { throw Error("unexpected wait"); },
    });
    assert.equal(await acquire(() => invalid), undefined);
    assert.ok(await acquire(() => 8_000),
      "the refused preflight must not strand the exclusive slot");
  }
  let budget = 8_000;
  let tick = 1_000;
  const acquire = createDetailReadPacer({
    now: () => tick,
    wait: async ms => { tick += ms; budget = Number.NaN; },
  });
  (await acquire(() => budget))!();
  assert.equal(await acquire(() => budget), undefined);
});
