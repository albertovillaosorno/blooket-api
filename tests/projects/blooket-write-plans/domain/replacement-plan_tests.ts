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
//   - Behavioral tests for validated deterministic Blooket write planning.
// - Must-Not:
//   - Call Blooket or imply remote selectors, routes, or IDs.
// - Allows:
//   - Inputs: Fixed local project/media fixtures.
//   - Outputs: Deterministic plan and readiness verdicts.
//   - Side effects: None.
// - Split-When:
//   - Set and question operation fixtures require independent suites.
// - Merge-When:
//   - Desired-state write planning is removed.
// - Summary:
//   - Proves validation, determinism, operation identity, and media lowering.
// - Description:
//   - Mirrors the replacement plan and its saved-question fixtures.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Media descriptions never enter remote-facing plan payloads.
//
import assert from "node:assert/strict";
import test from "node:test";
import { buildBlooketReplacementPlan } from
  "../../../../src/projects/blooket-write-plans/domain/replacement-plan.ts";
import { initialBlooketWriteCheckpoint, decodeBlooketWriteCheckpoint } from
  "../../../../src/projects/blooket-write-plans/domain/checkpoint.ts";
import { replacementFixture } from "./replacement-fixtures.ts";
const baseline = () => ({ schemaVersion: 1 as const,
  kind: "question-list" as const, itemCount: 2, sha256: "a".repeat(64) });

test("replacement binds one saved position and preserves its before-image",
  () => {
    const f = replacementFixture();
    const target = { remoteSetId: "fixture-remote", baseline: baseline() };
    const plan = buildBlooketReplacementPlan(f.desired, target, f.previous);
    assert.ok(plan);
    assert.equal(plan.operations.length, 1);
    assert.equal(plan.operations[0].kind, "replace-question");
    assert.equal(plan.operations[0].questionNumber, 2);
    assert.deepEqual(plan.operations[0].previous, f.previous);
    assert.equal(plan.operations[0].question.timeLimitSeconds, 20);
    const initial = initialBlooketWriteCheckpoint(plan);
    assert.equal(initial.remoteSetId, "fixture-remote");
    assert.equal(decodeBlooketWriteCheckpoint({ ...initial,
      remoteSetId: "foreign-target" }, plan).ok, false);
    assert.equal(Object.isFrozen(plan.operations[0].question), true);
    Reflect.set(f.previous, "question", "Changed caller state");
    target.baseline.sha256 = "b".repeat(64);
    assert.equal(plan.operations[0].previous.question,
      "Old second question.");
    assert.equal(plan.target.baseline.sha256, "a".repeat(64));
  });

test("replacement identity changes with prior state or exact target", () => {
  const f = replacementFixture();
  const target = { remoteSetId: "fixture-remote", baseline: baseline() };
  const first = buildBlooketReplacementPlan(f.desired, target, f.previous)!;
  assert.equal(buildBlooketReplacementPlan(f.desired, target,
    f.previous)!.planId, first.planId);
  assert.notEqual(buildBlooketReplacementPlan(f.desired,
    { ...target, remoteSetId: "another-set" }, f.previous)!.planId,
  first.planId);
  assert.notEqual(buildBlooketReplacementPlan(f.desired, target,
    { ...f.previous, timeLimit: 11 })!.planId, first.planId);
});

test("replacement refuses count changes and unverifiable old media", () => {
  const f = replacementFixture();
  const target = { remoteSetId: "fixture-remote", baseline: baseline() };
  assert.equal(buildBlooketReplacementPlan(f.desired,
    { ...target, baseline: { ...baseline(), itemCount: 1 } },
    f.previous), undefined);
  for (const previous of [{ ...f.previous, number: 3 },
    { ...f.previous, hasImage: true }, { ...f.previous, hasAudio: true }])
    assert.equal(buildBlooketReplacementPlan(f.desired, target, previous),
      undefined);
});
