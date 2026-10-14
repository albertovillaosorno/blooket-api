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
//   - Portable UI publication pacing and uncertainty regressions.
// - Must-Not:
//   - Access the provider, browser, account, or real publication journals.
// - Allows:
//   - Inputs: Synthetic command replies and a bounded cancellation signal.
//   - Outputs: Deterministic command sequences and terminal progress states.
//   - Side effects: In-memory test state only.
// - Split-When:
//   - A second UI publication orchestrator is introduced.
// - Merge-When:
//   - UI publication moves into the service.
// - Summary:
//   - No duplicate writes after uncertainty, cancellation, or stale progress.
// - Description:
//   - Verifies the UI never infers a remote publication receipt.
// - Usage:
//   - Run through the ordinary repository test command.
// - Defaults:
//   - Refuse a malformed or unrecognized canonical progress reply.
//
import test from "node:test";
import assert from "node:assert/strict";
import { publishTextDraft } from
  "../../../../src/ui/teacher-workspace/adapter-inbound/publication.js";

const ID = "synthetic-draft";
const REV = "a".repeat(64);
const state = (phase: string, done: number, total = 3) => ({
  draftId: ID, phase, completedOperations: done,
  totalOperations: total, published: phase === "verified",
});

test("one UI publish intent advances and verifies each durable operation",
  async () => {
  const calls: string[] = [];
  const replies = [
    { draftId: ID, phase: "not-started", published: false },
    state("advanced", 1), state("advanced", 2), state("advanced", 3),
    state("verified", 3),
  ];
  const reports: string[] = [];
  const verified = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return replies.shift();
  }, p => reports.push(p.phase));
  assert.equal(verified.phase, "verified");
  assert.equal(verified.published, true);
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.step", "blooket.publication.step",
    "blooket.publication.step", "blooket.publication.verify"]);
  assert.deepEqual(reports, ["not-started", "advanced", "advanced",
    "advanced", "verified"]);
});

test("an ambiguous journal stops UI automation without replay", async () => {
  const calls: string[] = [];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return name.endsWith("status") ? state("ready", 0) :
      state("reconciliation-required", 0);
  });
  assert.equal(result.phase, "reconciliation-required");
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.step"]);
});

test("an existing ambiguous journal never opens another write", async () => {
  const calls: string[] = [];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return state("reconciliation-required", 0);
  });
  assert.equal(result.phase, "reconciliation-required");
  assert.deepEqual(calls, ["blooket.publication.status"]);
});

test("cancellation between steps never calls another Blooket writer",
  async () => {
  const calls: string[] = [];
  let stopped = false;
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return name.endsWith("status")
      ? state("ready", 0) : state("advanced", 1);
  }, state => { if (state.phase === "advanced") stopped = true; },
  () => stopped);
  assert.equal(result.phase, "paused");
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.step"]);
});

test("nonadvancing or malformed replies fail closed", async () => {
  for (const step of [
    state("ready", 0), state("advanced", 0),
    state("advanced", 2), state("unexpected", 1),
    { ...state("verified", 1), published: true },
    { phase: "advanced", completedOperations: "1" },
  ]) {
    const calls: string[] = [];
    const send = async (name: string) => {
      calls.push(name);
      return name.endsWith("status") ? state("ready", 0) : step;
    };
    if (typeof step.completedOperations !== "number" ||
        step.published === true)
      await assert.rejects(publishTextDraft(ID, REV, send),
        /publication-progress-invalid/u);
    else {
      const result = await publishTextDraft(ID, REV, send);
      assert.notEqual(result.phase, "verified");
    }
    assert.equal(calls.filter(c => c.endsWith("step")).length, 1);
  }
});

test("a changed frozen plan cannot schedule the next operation",
  async () => {
  const calls: string[] = [];
  const replies = [state("ready", 1), state("advanced", 2, 4)];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return replies.shift();
  });
  assert.equal(result.phase, "advanced");
  assert.equal(result.completedOperations, 2);
  assert.equal(calls.filter(name => name.endsWith("step")).length, 1);
});

test("status cannot claim publication without fresh verification",
  async () => {
  let calls = 0;
  await assert.rejects(publishTextDraft(ID, REV, async () => {
    calls++;
    return state("verified", 3);
  }), /publication-progress-invalid/u);
  assert.equal(calls, 1);
});

test("completed publication only performs fresh verification", async () => {
  const calls: string[] = [];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return name.endsWith("status") ? state("writes-complete", 3) :
      state("verified", 3);
  });
  assert.equal(result.published, true);
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.verify"]);
});
