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
//   - Deterministic tests for mutation task budget state transitions.
// - Must-Not:
//   - Persist files, sleep, or execute provider mutations.
// - Allows:
//   - Inputs: Synthetic policies, timestamps, and serialized state.
//   - Outputs: Exact admission and refusal assertions.
//   - Side effects: None.
// - Split-When:
//   - Provider-specific quota state gains a separate contract.
// - Merge-When:
//   - Task-level mutation budgets are removed.
// - Summary:
//   - Proves attempt counts, deadlines, restart decoding, and strict failures.
// - Description:
//   - State round-trips through JSON without inventing progress.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Invalid policy, clock rollback, and unknown fields fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  admitBlooketMutationTaskStart,
  decodeBlooketMutationTaskBudgetState,
} from
  "../../../../src/projects/blooket-write-plans/domain/mutation-budget.ts";

test("task budgets count attempts and survive a serialized restart", () => {
  const policy = { maximumStarts: 2, maximumDurationMs: 60_000 };
  const first = admitBlooketMutationTaskStart(null, policy, 10_000);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.state, {
    version: 1,
    startedAtMs: 10_000,
    starts: 1,
  });
  const restored = decodeBlooketMutationTaskBudgetState(
    JSON.parse(JSON.stringify(first.state)),
  );
  assert.deepEqual(restored, first.state);
  const second = admitBlooketMutationTaskStart(restored, policy, 12_000);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.state.starts, 2);
  assert.deepEqual(
    admitBlooketMutationTaskStart(second.state, policy, 14_000),
    {
      ok: false,
      code: "mutation-task-start-budget-exhausted",
    },
  );
});

test("task duration expires at its exact bounded deadline", () => {
  const policy = { maximumStarts: 10, maximumDurationMs: 5_000 };
  const state = { version: 1 as const, startedAtMs: 20_000, starts: 1 };
  assert.equal(admitBlooketMutationTaskStart(state, policy, 24_999).ok, true);
  assert.deepEqual(admitBlooketMutationTaskStart(state, policy, 25_000), {
    ok: false,
    code: "mutation-task-duration-exhausted",
  });
  assert.deepEqual(admitBlooketMutationTaskStart(state, policy, 19_999), {
    ok: false,
    code: "mutation-task-budget-invalid",
  });
});

test(
  "task budget decoding rejects coercion unknown fields and unsafe policy",
  () => {
    assert.equal(decodeBlooketMutationTaskBudgetState(null), null);
    for (const candidate of [
      {},
      { version: 1, startedAtMs: "0", starts: 0 },
      { version: 1, startedAtMs: 0, starts: -1 },
      { version: 1, startedAtMs: 0, starts: 0, extra: true },
      { version: 2, startedAtMs: 0, starts: 0 },
    ])
      assert.equal(decodeBlooketMutationTaskBudgetState(candidate), undefined);
    assert.deepEqual(
      admitBlooketMutationTaskStart(
        null,
        { maximumStarts: 0, maximumDurationMs: 60_000 },
        0,
      ),
      { ok: false, code: "mutation-task-budget-invalid" },
    );
  },
);
