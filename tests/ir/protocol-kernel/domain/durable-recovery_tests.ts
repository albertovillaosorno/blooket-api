// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: LicenseRef-Proprietary
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns: Cross-provider durable transition ordering and crash-cut evidence.
// - Must-Not: Access actual filesystem, emit network writes or infer success.
// - Allows: Deterministic in-memory CAS, failures, and restart simulations.

import assert from "node:assert/strict";
import test from "node:test";
import { executeDurableRecovery } from
  "../../../../src/ir/protocol-kernel/domain/durable-recovery.ts";

interface State {
  readonly sequence: number;
  readonly transactionId: string;
}

function replica() {
  const events: string[] = [];
  let durable: State = { sequence: 0, transactionId: "account:14" };
  let pending = true;
  let failCommit = false;
  let failCleanup = false;
  const ports = {
    persist: async (before: State, after: State) => {
      events.push("persist:" + after.sequence);
      if (failCommit) return { ok: false as const, cause: "disk-failure" };
      if (before.sequence !== durable.sequence ||
          before.transactionId !== durable.transactionId ||
          after.transactionId !== before.transactionId ||
          after.sequence !== before.sequence + 1)
        return { ok: false as const, cause: "cas-conflict" };
      durable = after;
      return { ok: true as const };
    },
    finalize: async (_checkpoint: State) => {
      events.push("finalize");
      if (failCleanup) return { ok: false as const, cause: "cleanup-failed" };
      pending = false;
      return { ok: true as const };
    },
  };
  return {
    events,
    ports,
    durable: () => durable,
    pending: () => pending,
    failCommit: () => { failCommit = true; },
    failCleanup: () => { failCleanup = true; },
    repairCleanup: () => { failCleanup = false; },
  };
}

test("ready and unresolved remote outcomes never touch storage", async () => {
  const storage = replica();
  const checkpoint = storage.durable();
  assert.deepEqual(await executeDurableRecovery({
    kind: "ready", checkpoint,
  }, storage.ports), { ok: true, kind: "ready", checkpoint });
  assert.deepEqual(await executeDurableRecovery({
    kind: "hold", checkpoint, reason: "unknown-remote-result",
  }, storage.ports), { ok: true, kind: "blocked",
    reason: "unknown-remote-result", checkpoint });
  assert.deepEqual(storage.events, []);
  assert.equal(storage.pending(), true);
});

test("commit followed by finalization maintains a durable happens-before order", async () => {
  const storage = replica();
  const checkpoint = storage.durable();
  const next = { ...checkpoint, sequence: 1 };
  assert.deepEqual(await executeDurableRecovery({
    kind: "commit-and-finalize", checkpoint, next,
  }, storage.ports), { ok: true, kind: "recovered", checkpoint: next });
  assert.deepEqual(storage.events, ["persist:1", "finalize"]);
  assert.equal(storage.pending(), false);
  assert.deepEqual(storage.durable(), next);
});

test("a failed CAS or failed storage write never clears an in-doubt journal", async () => {
  for (const failing of ["disk", "stale"] as const) {
    const storage = replica();
    const checkpoint = storage.durable();
    const before = failing === "stale" ? { ...checkpoint, sequence: 1 }
      : checkpoint;
    const next = { ...before, sequence: before.sequence + 1 };
    if (failing === "disk") storage.failCommit();
    const result = await executeDurableRecovery({
      kind: "commit-and-finalize", checkpoint: before, next,
    }, storage.ports);
    assert.deepEqual(result, { ok: false, stage: "persist",
      cause: failing === "disk" ? "disk-failure" : "cas-conflict" });
    assert.deepEqual(storage.events, ["persist:" + next.sequence]);
    assert.equal(storage.pending(), true);
    assert.equal(storage.durable().sequence, 0);
  }
});

test("crash after durable commit is restartable without duplicate persistence", async () => {
  const storage = replica();
  storage.failCleanup();
  const checkpoint = storage.durable();
  const next = { ...checkpoint, sequence: 1 };
  assert.deepEqual(await executeDurableRecovery({
    kind: "commit-and-finalize", checkpoint, next,
  }, storage.ports), { ok: false, stage: "finalize",
    cause: "cleanup-failed", checkpoint: next });
  assert.deepEqual(storage.durable(), next);
  assert.equal(storage.pending(), true);
  storage.repairCleanup();
  assert.deepEqual(await executeDurableRecovery({
    kind: "finalize", checkpoint: storage.durable(),
  }, storage.ports), { ok: true, kind: "finalized", checkpoint: next });
  assert.deepEqual(storage.events, ["persist:1", "finalize", "finalize"]);
  assert.equal(storage.pending(), false);
});

test("commit-only transitions never require a cleanup port", async () => {
  const storage = replica();
  const checkpoint = storage.durable();
  const next = { ...checkpoint, sequence: 1 };
  assert.deepEqual(await executeDurableRecovery({
    kind: "commit", checkpoint, next,
  }, { persist: storage.ports.persist }), {
    ok: true, kind: "committed", checkpoint: next,
  });
  assert.deepEqual(storage.events, ["persist:1"]);
  assert.equal(storage.pending(), true);
});

test("finalization without a cleanup port fails closed", async () => {
  const storage = replica();
  await assert.rejects(() => executeDurableRecovery({
    kind: "finalize", checkpoint: storage.durable(),
  }, { persist: storage.ports.persist }),
  /durable-recovery-finalize-port-required/u);
  assert.deepEqual(storage.events, []);
});
