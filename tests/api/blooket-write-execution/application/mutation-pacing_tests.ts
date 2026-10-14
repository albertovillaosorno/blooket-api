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
  assert.equal(Object.isFrozen(DEFAULT_BLOOKET_MUTATION_PACING), true);
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

test(
  "queued cancellation resolves while the incumbent still holds its lease",
  async () => {
  const clock = virtualRuntime();
  const pacer = createBlooketMutationPacer(undefined, clock.runtime);
  const first = await pacer.acquire();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  try {
    const controller = new AbortController();
    let settled = false;
    const pending = pacer.acquire(controller.signal).then((result) => {
      settled = true;
      return result;
    });
    controller.abort();
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
    assert.equal(settled, true);
    assert.deepEqual(await pending, {
      ok: false, code: "mutation-pacing-cancelled",
    });
  } finally {
    first.lease.release();
  }
  const next = await pacer.acquire();
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.lease.startedAtMs, 2_000);
  next.lease.release();
  },
);

test(
  "two canceled reservations cannot bypass the active pacing lease",
  async () => {
  const clock = virtualRuntime();
  const pacer = createBlooketMutationPacer(undefined, clock.runtime);
  const first = await pacer.acquire();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  try {
    const a = new AbortController();
    const b = new AbortController();
    const cancelledA = pacer.acquire(a.signal);
    const cancelledB = pacer.acquire(b.signal);
    let active = false;
    const next = pacer.acquire().then((result) => {
      active = true;
      return result;
    });
    a.abort();
    b.abort();
    assert.deepEqual(await cancelledA, {
      ok: false, code: "mutation-pacing-cancelled",
    });
    assert.deepEqual(await cancelledB, {
      ok: false, code: "mutation-pacing-cancelled",
    });
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
    assert.equal(active, false);
    first.lease.release();
    const acquired = await next;
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    assert.equal(acquired.lease.startedAtMs, 2_000);
    acquired.lease.release();
  } finally {
    first.lease.release();
  }
  },
);


test("wall-clock rollback fails closed without sleeping until the old future",
  async () => {
  let now = 12_000;
  const sleeps: number[] = [];
  const runtime: BlooketMutationPacingRuntime = {
    now: () => now,
    sleep: async milliseconds => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
  };
  const pacer = createBlooketMutationPacer(undefined, runtime);
  const first = await pacer.acquire();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  first.lease.release();
  now = 1_000;
  await assert.rejects(pacer.acquire(), /mutation-pacing-clock-invalid/u);
  assert.deepEqual(sleeps, []);
  now = 13_000;
  const next = await pacer.acquire();
  assert.equal(next.ok, true);
  if (next.ok) {
    assert.equal(next.lease.startedAtMs, 14_000);
    next.lease.release();
  }
});

test("nonfinite pacing clock never grants a mutation lease", async () => {
  let now = Number.NaN;
  const pacer = createBlooketMutationPacer(undefined, {
    now: () => now,
    sleep: async () => { throw Error("should-not-sleep"); },
  });
  await assert.rejects(pacer.acquire(), /mutation-pacing-clock-invalid/u);
  now = 0;
  const result = await pacer.acquire();
  assert.equal(result.ok, true);
  if (result.ok) result.lease.release();
});


test("rollback during paced sleep frees the queue without a mutation start",
  async () => {
  let time = 10_000;
  let sleeps = 0;
  const pacer = createBlooketMutationPacer(undefined, {
    now: () => time,
    sleep: async () => { sleeps++; time = 5_000; },
  });
  const first = await pacer.acquire();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  first.lease.release();
  await assert.rejects(pacer.acquire(), /mutation-pacing-clock-invalid/u);
  assert.equal(sleeps, 1);
  time = 15_000;
  const recovered = await pacer.acquire();
  assert.equal(recovered.ok, true);
  if (recovered.ok) {
    assert.equal(recovered.lease.startedAtMs, 15_000);
    recovered.lease.release();
  }
});

test("rollback on the final grant releases the exclusive slot", async () => {
  let calls = 0;
  const pacer = createBlooketMutationPacer(undefined, {
    now: () => { calls++; return calls === 2 ? 0 : 2_000; },
    sleep: async () => { throw Error("should-not-sleep"); },
  });
  await assert.rejects(pacer.acquire(), /mutation-pacing-clock-invalid/u);
  const recovered = await pacer.acquire();
  assert.equal(recovered.ok, true);
  if (recovered.ok) recovered.lease.release();
});


test("mutable caller policy cannot accelerate an admitted pacing queue",
  async () => {
  const policy = {
    minimumStartIntervalMs: 2_000,
    maximumStartsPerMinute: 20,
  };
  const clock = virtualRuntime();
  const pacer = createBlooketMutationPacer(policy, clock.runtime);
  const first = await pacer.acquire();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  first.lease.release();
  // A configuration object may be retained by a settings adapter and later
  // modified. Its validated lease policy must be frozen at construction.
  policy.minimumStartIntervalMs = 0;
  policy.maximumStartsPerMinute = 10_000;
  const second = await pacer.acquire();
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.lease.startedAtMs, 2_000);
  assert.deepEqual(clock.sleeps, [2_000]);
  second.lease.release();
});


test("queued starts retain the original rolling-minute policy",
  async () => {
  const policy = {
    minimumStartIntervalMs: 2_000,
    maximumStartsPerMinute: 1,
  };
  const clock = virtualRuntime();
  const pacer = createBlooketMutationPacer(policy, clock.runtime);
  const first = await pacer.acquire();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  first.lease.release();
  policy.maximumStartsPerMinute = 20;
  const second = await pacer.acquire();
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.lease.startedAtMs, 60_000);
  assert.deepEqual(clock.sleeps, [60_000]);
  second.lease.release();
});

test("runtime pacing rejects policy accessors without evaluating them", () => {
  let accessed = false;
  const policy: Record<string, unknown> = {
    maximumStartsPerMinute: 20,
  };
  Object.defineProperty(policy, "minimumStartIntervalMs", {
    enumerable: true,
    get() { accessed = true; return 2_000; },
  });
  assert.throws(() => createBlooketMutationPacer(
    policy as unknown as typeof DEFAULT_BLOOKET_MUTATION_PACING,
    virtualRuntime().runtime,
  ), /invalid-mutation-pacing-policy/u);
  assert.equal(accessed, false);
});
