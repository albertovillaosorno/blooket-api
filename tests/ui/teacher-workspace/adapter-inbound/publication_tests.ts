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
import { publishTextDraft, publicationStopReason } from
  "../../../../src/ui/teacher-workspace/adapter-inbound/publication.js";

const ID = "synthetic-draft";
const REV = "a".repeat(64);
const state = (phase: string, done: number, total = 3) => ({
  draftId: ID, revision: REV, phase, completedOperations: done,
  totalOperations: total, remoteSetId: done === 0 ? null : "synthetic-set",
  published: phase === "verified",
});

test("resumption uses immutable journal revision after local draft changes",
  async () => {
  const newerRevision = "b".repeat(64);
  const sent: unknown[] = [];
  const replies = [state("ready", 1, 2), state("advanced", 2, 2),
    state("verified", 2, 2)];
  const result = await publishTextDraft(ID, newerRevision,
    async (name, payload) => {
      sent.push({ name, payload });
      return replies.shift();
    });
  assert.equal(result.published, true);
  assert.deepEqual(sent, [
    { name: "blooket.publication.status", payload: { draftId: ID } },
    { name: "blooket.publication.step", payload: {
      draftId: ID, expectedRevision: REV,
    } },
    { name: "blooket.publication.verify", payload: { draftId: ID } },
  ]);
});

test("a malformed frozen revision stops before another mutation", async () => {
  const names: string[] = [];
  await assert.rejects(publishTextDraft(ID, REV, async name => {
    names.push(name);
    return { ...state("ready", 1, 2), revision: "invalid" };
  }), /publication-progress-invalid/u);
  assert.deepEqual(names, ["blooket.publication.status"]);
});

test("a long admitted text quiz does not stop at 128 writes",
  async () => {
  let started = 0, verified = 0, status = 0;
  const result = await publishTextDraft(ID, REV, async name => {
    if (name === "blooket.publication.status") {
      status++;
      return { draftId: ID, phase: "not-started", published: false };
    }
    if (name === "blooket.publication.step")
      return state("advanced", ++started, 133);
    verified++;
    return state("verified", started, 133);
  });
  assert.equal(result.phase, "verified");
  assert.equal(result.published, true);
  assert.equal(started, 133);
  assert.equal(verified, 1);
  assert.equal(status, 1);
});

test("oversized remote plan cannot start a second UI write",
  async () => {
  const calls: string[] = [];
  await assert.rejects(publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return state("ready", 0, 10_001);
  }), /publication-progress-invalid/u);
  assert.deepEqual(calls, ["blooket.publication.status"]);
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

test("signed-out preflight without snapshot shows a recoverable stop",
  async () => {
  const calls: string[] = [];
  const reports: string[] = [];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return name.endsWith("status")
      ? { draftId: ID, phase: "not-started", published: false }
      : { draftId: ID, phase: "session-required",
          state: "signed-out", published: false };
  }, value => reports.push(value.phase));
  assert.equal(result.phase, "session-required");
  assert.equal(result.state, "signed-out");
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.step"]);
  assert.deepEqual(reports, ["not-started", "session-required"]);
});

test("an inconclusive journal probe stops without another write", async () => {
  const calls: string[] = [];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return name.endsWith("status") ? state("ready", 0) :
      state("reconciliation-required", 0);
  });
  assert.equal(result.phase, "reconciliation-required");
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.step", "blooket.publication.reconcile"]);
});

test("an existing ambiguous journal never opens another write", async () => {
  const calls: string[] = [];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return state("reconciliation-required", 0);
  });
  assert.equal(result.phase, "reconciliation-required");
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.reconcile"]);
});

test("an existing recovered journal resumes only its next unfinished step",
  async () => {
  const calls: string[] = [];
  const replies = [state("reconciliation-required", 1),
    state("recovered", 2), state("advanced", 3), state("verified", 3)];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return replies.shift();
  });
  assert.equal(result.published, true);
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.reconcile", "blooket.publication.step",
    "blooket.publication.verify"]);
});

test("a lost initial Create Set acknowledgement cannot create a duplicate",
  async () => {
  const calls: string[] = [];
  const replies = [state("reconciliation-required", 0, 2),
    state("recovered", 1, 2), state("advanced", 2, 2),
    state("verified", 2, 2)];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return replies.shift();
  });
  assert.equal(result.published, true);
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.reconcile", "blooket.publication.step",
    "blooket.publication.verify"]);
});

test("inconclusive preexisting recovery performs no new write",
  async () => {
  const calls: string[] = [];
  const replies = [state("reconciliation-required", 0, 2),
    state("reconciliation-required", 0, 2)];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return replies.shift();
  });
  assert.equal(result.phase, "reconciliation-required");
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.reconcile"]);
});

test("an existing journal finishing on recovery verifies without Save",
  async () => {
  const calls: string[] = [];
  const replies = [state("reconciliation-required", 2),
    state("recovered", 3), state("verified", 3)];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return replies.shift();
  });
  assert.equal(result.published, true);
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.reconcile", "blooket.publication.verify"]);
});

test("an existing ambiguous journal can be canceled before remote probing",
  async () => {
  const calls: string[] = [];
  let cancelled = false;
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return state("reconciliation-required", 1);
  }, () => { cancelled = true; }, () => cancelled);
  assert.equal(result.phase, "paused");
  assert.deepEqual(calls, ["blooket.publication.status"]);
});

test("a preexisting ambiguous journal cannot change identity on recovery",
  async () => {
  for (const patch of [{ remoteSetId: "other-set" },
    { revision: "b".repeat(64) }, { completedOperations: 3 },
    { totalOperations: 4 }, { phase: "verified", published: true }]) {
    const calls: string[] = [];
    const replies = [state("reconciliation-required", 1),
      { ...state("recovered", 2), ...patch }];
    await assert.rejects(publishTextDraft(ID, REV, async name => {
      calls.push(name);
      return replies.shift();
    }), /publication-progress-invalid/u);
    assert.deepEqual(calls, ["blooket.publication.status",
      "blooket.publication.reconcile"]);
  }
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
        step.published === true ||
        (step.phase === "advanced" && step.completedOperations !== 1))
      await assert.rejects(publishTextDraft(ID, REV, send),
        /publication-progress-invalid/u);
    else {
      const result = await publishTextDraft(ID, REV, send);
      assert.notEqual(result.phase, "verified");
    }
    assert.equal(calls.filter(c => c.endsWith("step")).length, 1);
  }
});

test("remote set identity cannot switch after one confirmed operation",
  async () => {
  const calls: string[] = [];
  const result = publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return name.endsWith("status") ? state("ready", 1) : {
      ...state("advanced", 2), remoteSetId: "different-set",
    };
  });
  await assert.rejects(result, /publication-progress-invalid/u);
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.step"]);
});

test("impossible ready states never authorize a new publication step",
  async () => {
  for (const invalid of [
    state("ready", 3, 3),
    { ...state("ready", 0, 3), remoteSetId: "already-created" },
    { ...state("ready", 1, 3), remoteSetId: null },
    state("writes-complete", 2, 3),
    { ...state("writes-complete", 3, 3), remoteSetId: null },
  ]) {
    const calls: string[] = [];
    await assert.rejects(publishTextDraft(ID, REV, async name => {
      calls.push(name);
      return invalid;
    }), /publication-progress-invalid/u);
    assert.deepEqual(calls, ["blooket.publication.status"]);
  }
});

test("impossible initial publication status cannot start a Blooket write",
  async () => {
  for (const invalid of [
    { draftId: ID, phase: "not-started", published: false,
      remoteSetId: "unexpected-set" },
    { draftId: ID, phase: "not-started", published: false,
      remoteSetId: null },
    { draftId: ID, phase: "not-started", published: false,
      revision: REV },
    { ...state("not-started", 1, 3) },
    { ...state("not-started", 0, 3) },
    { draftId: ID, phase: "not-started", published: false,
      completedOperations: 0, totalOperations: 1 },
  ]) {
    const calls: string[] = [];
    await assert.rejects(publishTextDraft(ID, REV, async name => {
      calls.push(name);
      return invalid;
    }), /publication-progress-invalid/u);
    assert.deepEqual(calls, ["blooket.publication.status"]);
  }
});

test("a missing first Create Set identity never advances to Add Question",
  async () => {
  const calls: string[] = [];
  const result = publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return name.endsWith("status")
      ? { draftId: ID, phase: "not-started", published: false }
      : { ...state("advanced", 1, 2), remoteSetId: null };
  });
  await assert.rejects(result, /publication-progress-invalid/u);
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.step"]);
});

test("a changed frozen plan cannot schedule the next operation",
  async () => {
  const calls: string[] = [];
  const replies = [state("ready", 1), state("advanced", 2, 4)];
  await assert.rejects(publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return replies.shift();
  }), /publication-progress-invalid/u);
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

test("a preexisting human stop needs no frozen revision or new write",
  async () => {
  const calls: string[] = [];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return { draftId: ID, phase: "human-action-required",
      state: "security-challenge", published: false };
  });
  assert.equal(result.phase, "human-action-required");
  assert.deepEqual(calls, ["blooket.publication.status"]);
});

test("a preflight human stop does not start an account write", async () => {
  const calls: string[] = [];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return name.endsWith("status")
      ? { draftId: ID, phase: "not-started", published: false }
      : { draftId: ID, phase: "human-action-required",
        state: "organization-prompt", published: false };
  });
  assert.equal(result.phase, "human-action-required");
  assert.equal(result.state, "organization-prompt");
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.step"]);
});

test("rate-limited preflight stays a stop without busy retry", async () => {
  const calls: string[] = [];
  const result = await publishTextDraft(ID, REV, async name => {
    calls.push(name);
    return name.endsWith("status")
      ? { draftId: ID, phase: "not-started", published: false }
      : { draftId: ID, phase: "wait", state: "rate-limited",
        published: false };
  });
  assert.equal(result.phase, "wait");
  assert.deepEqual(calls, ["blooket.publication.status",
    "blooket.publication.step"]);
});

test("cross-draft progress and impossible success cannot advance writes",
  async () => {
  for (const bad of [
    { ...state("ready", 0), draftId: "another-draft" },
    { draftId: ID, phase: "not-started", published: true },
    { ...state("ready", 0), published: true },
  ]) {
    const calls: string[] = [];
    await assert.rejects(publishTextDraft(ID, REV, async name => {
      calls.push(name);
      return bad;
    }), /publication-progress-invalid/u);
    assert.deepEqual(calls, ["blooket.publication.status"]);
  }
});

test("final verify rejects a different revision, set, or operation count",
  async () => {
  const confirmed = {
    ...state("writes-complete", 2, 2), remoteSetId: "set-original",
  };
  const valid = {
    ...state("verified", 2, 2), remoteSetId: "set-original",
  };
  const invalid = [
    { ...valid, revision: "b".repeat(64) },
    { ...valid, remoteSetId: "set-replaced" },
    { ...valid, completedOperations: 1 },
    { ...valid, totalOperations: 3 },
    { ...valid, remoteSetId: null },
  ];
  for (const reply of invalid) {
    const calls: string[] = [];
    await assert.rejects(publishTextDraft(ID, REV, async name => {
      calls.push(name);
      return name.endsWith("status") ? confirmed : reply;
    }), /publication-progress-invalid/u);
    assert.deepEqual(calls, ["blooket.publication.status",
      "blooket.publication.verify"]);
  }
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

test("publication error labels classify only owned safe codes", () => {
  assert.equal(publicationStopReason(
    Error("blooket-authentication-required")), "sign-in");
  assert.equal(publicationStopReason(
    Error("blooket-browser-companion-update-required")), "extension");
  assert.equal(publicationStopReason(
    Error("blooket-publication-remote-conflict")), "conflict");
  for (const code of ["blooket-publication-media-unsupported",
    "blooket-media-not-prepared", "blooket-media-stale",
    "blooket-media-invalid", "blooket-media-unavailable"])
    assert.equal(publicationStopReason(Error(code)), "media");
  assert.equal(publicationStopReason(
    Error("blooket-publication-question-limit")), "capacity");
  assert.equal(publicationStopReason(
    Error("blooket-publication-busy")), "busy");
  assert.equal(publicationStopReason(
    Error("publication-storage-unavailable")), "storage");
  assert.equal(publicationStopReason(
    Error("blooket-publication-recovery-required")), "storage");
  assert.equal(publicationStopReason(
    Error("blooket-publication-invalid-draft")), "content");
  assert.equal(publicationStopReason(
    Error("blooket-publication-single-edit-required")), "single-edit");
  assert.equal(publicationStopReason(
    Error("blooket-publication-edit-unsupported")), "edit-unsupported");
  assert.equal(publicationStopReason(
    Error("blooket-write-baseline-not-captured")), "verification");
  for (const code of ["mutation-task-start-budget-exhausted",
    "mutation-task-duration-exhausted"])
    assert.equal(publicationStopReason(Error(code)), "limit");
  assert.equal(publicationStopReason(Error("mutation-pacing-failed")),
    "pacing");
  assert.equal(publicationStopReason(
    Error("blooket-publication-cancelled")), "paused");
  assert.equal(publicationStopReason(
    Error("private browser token: should-not-render")), "unknown");
  assert.equal(publicationStopReason({
    message: "blooket-authentication-required",
  }), "unknown");
});


test("one intent can reconcile a lost question reply and finish publication",
  async () => {
  const names: string[] = [];
  const replies = [
    { draftId: ID, phase: "not-started", published: false },
    state("advanced", 1), state("reconciliation-required", 1),
    state("recovered", 2), state("advanced", 3), state("verified", 3),
  ];
  const result = await publishTextDraft(ID, REV, async name => {
    names.push(name);
    return replies.shift();
  });
  assert.equal(result.published, true);
  assert.deepEqual(names, ["blooket.publication.status",
    "blooket.publication.step", "blooket.publication.step",
    "blooket.publication.reconcile", "blooket.publication.step",
    "blooket.publication.verify"]);
});


test("cancellation before recovery stops reads and writes", async () => {
  const names: string[] = [];
  let cancelled = false;
  const result = await publishTextDraft(ID, REV, async name => {
    names.push(name);
    return name.endsWith("status") ? state("ready", 1)
      : state("reconciliation-required", 1);
  }, observed => {
    if (observed.phase === "reconciliation-required") cancelled = true;
  }, () => cancelled);
  assert.equal(result.phase, "paused");
  assert.deepEqual(names, ["blooket.publication.status",
    "blooket.publication.step"]);
});

test("a recovery probe cannot retarget, skip a write or claim verification",
  async () => {
  for (const patch of [{ remoteSetId: "other-set" },
    { revision: "b".repeat(64) }, { completedOperations: 3 },
    { totalOperations: 4 }, { phase: "verified", published: true }]) {
    const names: string[] = [];
    const replies = [state("ready", 1), state("reconciliation-required", 1),
      { ...state("recovered", 2), ...patch }];
    await assert.rejects(publishTextDraft(ID, REV, async name => {
      names.push(name);
      return replies.shift();
    }), /publication-progress-invalid/u);
    assert.deepEqual(names, ["blooket.publication.status",
      "blooket.publication.step", "blooket.publication.reconcile"]);
  }
});
