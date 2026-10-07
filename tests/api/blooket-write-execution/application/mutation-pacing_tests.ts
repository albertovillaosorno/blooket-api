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
//   - Deterministic tests for one-account mutation serialization and pacing.
// - Must-Not:
//   - Sleep in wall-clock time or execute provider mutations.
// - Allows:
//   - Inputs: Injected virtual clock, pacing policies, and abort signals.
//   - Outputs: Lease timing, serialization, and cancellation assertions.
//   - Side effects: Virtual time advancement only.
// - Split-When:
//   - Persisted task budgets need an independent scheduling contract.
// - Merge-When:
//   - Mutation pacing is removed from write execution.
// - Summary:
//   - Proves no parallel leases and conservative rolling-window starts.
// - Description:
//   - The injected runtime makes rate behavior exact and fast to test.
// - Usage:
//   - Run with the repository Node test suite.
// - Defaults:
//   - Production defaults are at least 2s apart and at most 20 per minute.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BLOOKET_MUTATION_PACING,
  createBlooketMutationPacer,
  type BlooketMutationPacingRuntime,
} from
  "../../../../src/api/blooket-write-execution/application/mutation-pacing.ts";

function virtualRuntime() {
  let now = 0;
  const sleeps: number[] = [];
  const runtime: BlooketMutationPacingRuntime = {
    now: () => now,
    sleep: async (milliseconds, signal) => {
      if (signal?.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      sleeps.push(milliseconds);
      now += milliseconds;
    },
  };
  return { runtime, sleeps, now: () => now };
}

test(
  "default pacing is no faster than 2 seconds and 20 starts per minute",
  () => {
  assert.deepEqual(DEFAULT_BLOOKET_MUTATION_PACING, {
    minimumStartIntervalMs: 2_000,
    maximumStartsPerMinute: 20,
  });
  for (const policy of [
    { minimumStartIntervalMs: 1_999, maximumStartsPerMinute: 20 },
    { minimumStartIntervalMs: 2_000, maximumStartsPerMinute: 21 },
  ])
    assert.throws(
      () => createBlooketMutationPacer(policy, virtualRuntime().runtime),
      /invalid-mutation-pacing-policy/u,
    );
  },
);

test(
  "leases serialize mutation windows and enforce the start interval",
  async () => {
  const clock = virtualRuntime();
  const pacer = createBlooketMutationPacer(undefined, clock.runtime);
  const first = await pacer.acquire();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  let secondResolved = false;
  const secondPromise = pacer.acquire().then((result) => {
    secondResolved = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(secondResolved, false);
  first.lease.release();
  const second = await secondPromise;
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.lease.startedAtMs, 2_000);
  assert.deepEqual(clock.sleeps, [2_000]);
  second.lease.release();
  },
);

test(
  "the rolling minute blocks the twenty-first start until expiry",
  async () => {
  const clock = virtualRuntime();
  const pacer = createBlooketMutationPacer(undefined, clock.runtime);
  const starts: number[] = [];
  for (let index = 0; index < 21; index += 1) {
    const result = await pacer.acquire();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    starts.push(result.lease.startedAtMs);
    result.lease.release();
  }
  assert.equal(starts[19], 38_000);
  assert.equal(starts[20], 60_000);
  assert.equal(clock.now(), 60_000);
  },
);

test("a cancelled queued lease never consumes a mutation start", async () => {
  const clock = virtualRuntime();
  const pacer = createBlooketMutationPacer(undefined, clock.runtime);
  const first = await pacer.acquire();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const controller = new AbortController();
  const queued = pacer.acquire(controller.signal);
  controller.abort();
  first.lease.release();
  assert.deepEqual(await queued, {
    ok: false,
    code: "mutation-pacing-cancelled",
  });
  const next = await pacer.acquire();
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.lease.startedAtMs, 2_000);
  next.lease.release();
});
