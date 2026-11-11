// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: MIT
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns:
//   - Exhaustive crash-window and mismatch proofs of pure recovery decisions.
// - Must-Not:
//   - Open a provider browser, write files, or infer remote success.
// - Allows:
//   - Synthetic plans, recovery evidence and deterministic state-graph checks.
// - Summary:
//   - Proves no unconfirmed journal may silently advance a write checkpoint.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceBlooketWriteCheckpoint,
  initialBlooketWriteCheckpoint,
  type BlooketWriteReceipt,
} from "../../../../src/projects/blooket-write-plans/domain/checkpoint.ts";
import {
  analyzeWriteRecoveryProtocol,
  decideWriteRecovery,
  type WriteRecoveryAttempt,
} from "../../../../src/projects/blooket-write-plans/domain/recovery-automaton.ts";
import type {
  BlooketWritePlan,
  BlooketWriteOperation,
} from "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const RECEIPT: BlooketWriteReceipt = {
  kind: "set-created", remoteSetId: "remote-set-1",
};
const BASELINE = {
  schemaVersion: 1 as const,
  kind: "question-list" as const,
  itemCount: 0,
  sha256: "a".repeat(64),
};

function testPlan(operationCount = 3): BlooketWritePlan {
  const operations: BlooketWriteOperation[] = [{
    operationId: "plan:crash-check:set",
    kind: "set",
    title: "Sample",
    description: "",
    visibility: "private",
    coverMediaId: null,
  }];
  for (let number = 1; number < operationCount; number += 1) {
    operations.push({
      operationId: "plan:crash-check:q:" + number,
      kind: "question",
      localQuestionId: "q-" + number,
      questionNumber: number,
      question: {
        type: "typing-answer",
        prompt: "Number " + number,
        timeLimitSeconds: 20,
        imageMediaId: null,
        matchMode: "exact",
        answer: String(number),
      },
    });
  }
  return {
    schemaVersion: 1,
    planId: "plan:crash-check",
    desiredStateSha256: "fixture",
    operations,
  };
}

function attempt(
  plan: BlooketWritePlan, index: number,
  phase: "attempting" | "confirmed",
  receipt: BlooketWriteReceipt | null = null,
): WriteRecoveryAttempt {
  const operation = plan.operations[index];
  assert.ok(operation);
  return {
    planId: plan.planId,
    operationId: operation.operationId,
    operationIndex: index,
    phase,
    receipt,
  };
}

test("pure model explorer checks every modeled crash window of 1-100 operations", () => {
  for (const count of [1, 2, 3, 8, 16, 32, 100]) {
    const report = analyzeWriteRecoveryProtocol(testPlan(count));
    assert.deepEqual(report, {
      ok: true,
      exploredStates: 4 * count + 1,
      exploredTransitions: 5 * count,
      reachedTerminal: true,
      violations: [],
    });
  }
});

test("ambiguous attempt is never automatically promoted or retried", () => {
  const plan = testPlan();
  const first = initialBlooketWriteCheckpoint(plan);
  assert.deepEqual(decideWriteRecovery(plan, first, attempt(plan, 0, "attempting")), {
    action: "reconcile", reason: "ambiguous-attempt",
  });
  assert.deepEqual(decideWriteRecovery(plan, first, attempt(plan, 0, "confirmed")), {
    action: "reconcile", reason: "inconsistent-attempt-state",
  });
  const advanced = advanceBlooketWriteCheckpoint(
    plan, first, plan.operations[0]!.operationId, RECEIPT,
  );
  assert.equal(advanced.ok, true);
  if (!advanced.ok) return;
  assert.deepEqual(decideWriteRecovery(plan, advanced.value,
    attempt(plan, 0, "attempting")), {
    action: "reconcile", reason: "inconsistent-attempt-state",
  });
});

test("confirmed event may advance once and already advanced event may be cleared", () => {
  const plan = testPlan();
  const first = initialBlooketWriteCheckpoint(plan);
  const committed = decideWriteRecovery(
    plan, first, attempt(plan, 0, "confirmed", RECEIPT),
  );
  assert.equal(committed.action, "persist-confirmed");
  if (committed.action !== "persist-confirmed") return;
  assert.equal(committed.checkpoint.nextOperationIndex, 1);
  assert.equal(committed.checkpoint.remoteSetId, RECEIPT.remoteSetId);
  assert.deepEqual(decideWriteRecovery(plan, committed.checkpoint,
    attempt(plan, 0, "confirmed", RECEIPT)), {
    action: "clear-confirmed",
  });
  const question = attempt(plan, 1, "confirmed");
  const advancedQuestion = decideWriteRecovery(plan, committed.checkpoint, question);
  assert.equal(advancedQuestion.action, "persist-confirmed");
  if (advancedQuestion.action !== "persist-confirmed") return;
  assert.deepEqual(decideWriteRecovery(plan, advancedQuestion.checkpoint, question), {
    action: "clear-confirmed",
  });
});

test("mismatched operation, plan, receipt, and checkpoint never clear evidence", () => {
  const plan = testPlan();
  const initial = initialBlooketWriteCheckpoint(plan);
  const setAttempt = attempt(plan, 0, "confirmed", RECEIPT);
  const checkpoint = advanceBlooketWriteCheckpoint(
    plan, initial, setAttempt.operationId, RECEIPT,
  );
  assert.equal(checkpoint.ok, true);
  if (!checkpoint.ok) return;
  const mismatch = { action: "reconcile", reason: "inconsistent-attempt-state" };
  assert.deepEqual(decideWriteRecovery(plan, checkpoint.value,
    { ...setAttempt, receipt: { ...RECEIPT, remoteSetId: "forged" } }), mismatch);
  assert.deepEqual(decideWriteRecovery(plan, checkpoint.value,
    { ...setAttempt, operationId: "wrong" }), mismatch);
  assert.deepEqual(decideWriteRecovery(plan, checkpoint.value,
    { ...setAttempt, planId: "other-plan" }), mismatch);
  assert.deepEqual(decideWriteRecovery(plan,
    { ...checkpoint.value, planId: "other-plan" }, setAttempt), mismatch);
  assert.deepEqual(decideWriteRecovery(plan,
    { ...checkpoint.value, nextOperationIndex: Number.MAX_SAFE_INTEGER }, setAttempt), mismatch);
  assert.deepEqual(decideWriteRecovery(plan,
    { ...checkpoint.value, nextOperationIndex: 3 }, setAttempt), mismatch);
});

test("model checker covers existing-set append workflows with no create operation", () => {
  const source = testPlan();
  const operations = source.operations.slice(1);
  const append: BlooketWritePlan = {
    schemaVersion: 2,
    planId: source.planId,
    desiredStateSha256: source.desiredStateSha256,
    target: { remoteSetId: "existing-set", baseline: BASELINE },
    operations,
  };
  const report = analyzeWriteRecoveryProtocol(append);
  assert.equal(report.ok, true, JSON.stringify(report.violations));
  assert.equal(report.exploredStates, operations.length * 4 + 1);
});

test("model checker stops on impossible workflows and bounds resource consumption", () => {
  const source = testPlan();
  const invalid: BlooketWritePlan = {
    ...source,
    operations: source.operations.slice(1),
  };
  const unreachable = analyzeWriteRecoveryProtocol(invalid);
  assert.equal(unreachable.ok, false);
  assert.match(unreachable.violations[0] ?? "", /unreachable-plan-operation/u);
  const tooLarge = analyzeWriteRecoveryProtocol({
    ...source,
    operations: Array.from({ length: 4097 }, (_, index) => ({
      ...source.operations[0]!, operationId: "operation-" + index,
    })),
  });
  assert.deepEqual(tooLarge, {
    ok: false, exploredStates: 0, exploredTransitions: 0,
    reachedTerminal: false, violations: ["unsupported-operation-count"],
  });
});


test("duplicate operation identities cannot masquerade as safe sequential plans", () => {
  const source = testPlan(2);
  const duplicated: BlooketWritePlan = {
    ...source,
    operations: [source.operations[0]!, {
      ...source.operations[1]!, operationId: source.operations[0]!.operationId,
    }],
  };
  const result = analyzeWriteRecoveryProtocol(duplicated);
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations,
    ["duplicate-operation-id:" + source.operations[0]!.operationId]);
});
