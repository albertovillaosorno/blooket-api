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
//   - Behavioral tests for resumable sequential Blooket write checkpoints.
// - Must-Not:
//   - Execute remote operations or persist checkpoint files.
// - Allows:
//   - Inputs: Deterministic write plans and checkpoint candidates.
//   - Outputs: Resume, advancement, and mismatch verdicts.
//   - Side effects: None.
// - Split-When:
//   - Parallel progress requires a separate checkpoint model.
// - Merge-When:
//   - Write-plan resumability is removed.
// - Summary:
//   - Proves checkpoints cannot skip, reorder, or cross plan identities.
// - Description:
//   - Mirrors src/projects/blooket-write-plans/domain/checkpoint.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - A fresh checkpoint resumes at the set operation.
//
import assert from "node:assert/strict";
import test from "node:test";

const capabilities = {
  schemaVersion: 3,
  verifiedOn: "2026-10-05",
  evidence: [{ kind: "browser-observation", reference: "fixture" }],
  questionTypes: {
    multipleChoice: {
      availability: "supported",
      minAnswers: 2,
      maxAnswers: 4,
      requiresQuestionText: true,
      allowsMultipleCorrect: true,
    },
    typingAnswer: {
      availability: "supported",
      matchModes: ["exact", "contains"],
    },
  },
  features: {
    questionImages: "supported",
    answerImages: "supported",
    audio: "unknown",
  },
  setMetadata: {
    titleRequired: true,
    descriptionRequired: false,
    titleMaxLength: 75,
    descriptionMaxLength: 300,
    coverImageOptional: true,
    visibility: ["public", "private"],
  },
  upload: {
    maxBytes: null,
    canvasWidth: null,
    canvasHeight: null,
    maxPixels: null,
  },
} as const;

import {
  advanceBlooketWriteCheckpoint,
  decodeBlooketWriteCheckpoint,
  decodeBlooketWriteReceipt,
  initialBlooketWriteCheckpoint,
  nextBlooketWriteOperation,
} from
  "../../../../src/projects/blooket-write-plans/domain/checkpoint.ts";
import {
  buildBlooketWritePlan,
  type BlooketWritePlan,
} from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const project = JSON.stringify({
  schemaVersion: 1,
  title: "Math",
  description: "Math review.",
  quizLanguage: "English",
  visibility: "private",
  mediaIndex: "media.jsonl",
  coverImage: null,
  questions: [
    {
      id: "q1",
      type: "typing-answer",
      prompt: "2 + 2",
      timeLimitSeconds: 10,
      image: null,
      matchMode: "exact",
      answer: "4",
    },
  ],
});

function plan(): BlooketWritePlan {
  const result = buildBlooketWritePlan(project, "", capabilities);
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Fixture write plan failed.");
  }
  return result.value;
}

test("fresh checkpoints resume at the first operation", () => {
  const value = plan();
  const checkpoint = initialBlooketWriteCheckpoint(value);

  assert.deepEqual(checkpoint, {
    schemaVersion: 2,
    planId: value.planId,
    nextOperationIndex: 0,
    remoteSetId: null,
  });
  assert.deepEqual(
    nextBlooketWriteOperation(value, checkpoint),
    {
      ok: true,
      operation: value.operations[0] ?? null,
    },
  );
});

test("confirmed operations advance exactly one step", () => {
  const value = plan();
  const initial = initialBlooketWriteCheckpoint(value);
  const first = value.operations[0];
  assert.notEqual(first, undefined);
  if (first === undefined) {
    return;
  }

  const advanced = advanceBlooketWriteCheckpoint(
    value,
    initial,
    first.operationId,
    { kind: "set-created", remoteSetId: "remote-set-1" },
  );
  assert.equal(advanced.ok, true);
  if (advanced.ok) {
    assert.equal(advanced.value.nextOperationIndex, 1);
    assert.deepEqual(
      nextBlooketWriteOperation(value, advanced.value),
      {
        ok: true,
        operation: value.operations[1] ?? null,
      },
    );
  }
});

test("checkpoints reject skipped or cross-plan operations", () => {
  const value = plan();
  const initial = initialBlooketWriteCheckpoint(value);
  const second = value.operations[1];
  assert.notEqual(second, undefined);
  if (second === undefined) {
    return;
  }

  assert.deepEqual(
    advanceBlooketWriteCheckpoint(
      value,
      initial,
      second.operationId,
      null,
    ),
    { ok: false, code: "unexpected-operation" },
  );

  const otherResult = buildBlooketWritePlan(
    project.replace("Math review.", "Changed."),
    "",
    capabilities,
  );
  assert.equal(otherResult.ok, true);
  if (otherResult.ok) {
    assert.deepEqual(
      advanceBlooketWriteCheckpoint(
        otherResult.value,
        initial,
        second.operationId,
        null,
      ),
      { ok: false, code: "write-plan-mismatch" },
    );
  }
});

test("next operation rejects cross-plan checkpoints", () => {
  const value = plan();
  const checkpoint = initialBlooketWriteCheckpoint(value);
  const changedResult = buildBlooketWritePlan(
    project.replace("Math review.", "Changed."),
    "",
    capabilities,
  );
  assert.equal(changedResult.ok, true);
  if (!changedResult.ok) {
    return;
  }

  assert.deepEqual(
    nextBlooketWriteOperation(changedResult.value, checkpoint),
    { ok: false, code: "write-plan-mismatch" },
  );
});

test("completed checkpoints have no next operation", () => {
  const value = plan();
  let checkpoint = initialBlooketWriteCheckpoint(value);
  for (const operation of value.operations) {
    const advanced = advanceBlooketWriteCheckpoint(
      value,
      checkpoint,
      operation.operationId,
      operation.kind === "set"
        ? { kind: "set-created", remoteSetId: "remote-set-1" }
        : null,
    );
    assert.equal(advanced.ok, true);
    if (!advanced.ok) {
      return;
    }
    checkpoint = advanced.value;
  }

  assert.deepEqual(
    nextBlooketWriteOperation(value, checkpoint),
    { ok: true, operation: null },
  );
  assert.deepEqual(
    advanceBlooketWriteCheckpoint(
      value,
      checkpoint,
      "anything",
      null,
    ),
    { ok: false, code: "write-plan-complete" },
  );
});

test("checkpoint decoding binds progress to one exact plan", () => {
  const value = plan();
  assert.deepEqual(
    decodeBlooketWriteCheckpoint({
      schemaVersion: 2,
      planId: value.planId,
      nextOperationIndex: 1,
      remoteSetId: "remote-set-1",
    }, value),
    {
      ok: true,
      value: {
        schemaVersion: 2,
        planId: value.planId,
        nextOperationIndex: 1,
        remoteSetId: "remote-set-1",
      },
    },
  );

  const changedResult = buildBlooketWritePlan(
    project.replace("Math review.", "Changed."),
    "",
    capabilities,
  );
  assert.equal(changedResult.ok, true);
  if (changedResult.ok) {
    const decoded = decodeBlooketWriteCheckpoint({
      schemaVersion: 2,
      planId: value.planId,
      nextOperationIndex: 1,
      remoteSetId: "remote-set-1",
    }, changedResult.value);
    assert.equal(decoded.ok, false);
    if (!decoded.ok) {
      assert.equal(decoded.issues[0]?.code, "write-plan-mismatch");
    }
  }
});

test("legacy fresh checkpoints migrate without inventing a binding", () => {
  const value = plan();
  assert.deepEqual(
    decodeBlooketWriteCheckpoint({
      schemaVersion: 1,
      planId: value.planId,
      nextOperationIndex: 0,
    }, value),
    {
      ok: true,
      value: {
        schemaVersion: 2,
        planId: value.planId,
        nextOperationIndex: 0,
        remoteSetId: null,
      },
    },
  );
});

test("legacy advanced checkpoints fail without a remote binding", () => {
  const value = plan();
  const decoded = decodeBlooketWriteCheckpoint({
    schemaVersion: 1,
    planId: value.planId,
    nextOperationIndex: 1,
  }, value);

  assert.equal(decoded.ok, false);
  if (!decoded.ok) {
    assert.equal(
      decoded.issues.some(
        (issue) => issue.code === "missing-remote-set-binding",
      ),
      true,
    );
  }
});

test("set advancement requires an opaque remote set receipt", () => {
  const value = plan();
  const initial = initialBlooketWriteCheckpoint(value);
  const setOperation = value.operations[0];
  assert.equal(setOperation?.kind, "set");
  if (setOperation === undefined) {
    return;
  }

  assert.deepEqual(
    advanceBlooketWriteCheckpoint(
      value,
      initial,
      setOperation.operationId,
      null,
    ),
    { ok: false, code: "missing-set-receipt" },
  );
  const advanced = advanceBlooketWriteCheckpoint(
    value,
    initial,
    setOperation.operationId,
    { kind: "set-created", remoteSetId: "opaque-remote-set" },
  );
  assert.equal(advanced.ok, true);
  if (advanced.ok) {
    assert.equal(advanced.value.remoteSetId, "opaque-remote-set");
  }
});

test("question advancement rejects set-creation receipts", () => {
  const value = plan();
  const setOperation = value.operations[0];
  const questionOperation = value.operations[1];
  assert.equal(setOperation?.kind, "set");
  assert.equal(questionOperation?.kind, "question");
  if (setOperation === undefined || questionOperation === undefined) {
    return;
  }
  const bound = advanceBlooketWriteCheckpoint(
    value,
    initialBlooketWriteCheckpoint(value),
    setOperation.operationId,
    { kind: "set-created", remoteSetId: "remote-set-1" },
  );
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    return;
  }

  assert.deepEqual(
    advanceBlooketWriteCheckpoint(
      value,
      bound.value,
      questionOperation.operationId,
      { kind: "set-created", remoteSetId: "remote-set-2" },
    ),
    { ok: false, code: "unexpected-write-receipt" },
  );
  const advanced = advanceBlooketWriteCheckpoint(
    value,
    bound.value,
    questionOperation.operationId,
    null,
  );
  assert.equal(advanced.ok, true);
  if (advanced.ok) {
    assert.equal(advanced.value.remoteSetId, "remote-set-1");
  }
});

test("write receipts are exact opaque-id objects", () => {
  assert.deepEqual(
    decodeBlooketWriteReceipt({
      kind: "set-created",
      remoteSetId: "opaque:remote/id",
    }),
    {
      ok: true,
      value: {
        kind: "set-created",
        remoteSetId: "opaque:remote/id",
      },
    },
  );
  for (const candidate of [
    { kind: "set-created", remoteSetId: "" },
    { kind: "set-created", remoteSetId: "id", extra: true },
    { kind: "question-created", remoteSetId: "id" },
  ]) {
    assert.equal(decodeBlooketWriteReceipt(candidate).ok, false);
  }
});

test("fresh checkpoints reject premature remote bindings", () => {
  const value = plan();
  const decoded = decodeBlooketWriteCheckpoint({
    schemaVersion: 2,
    planId: value.planId,
    nextOperationIndex: 0,
    remoteSetId: "remote-set-1",
  }, value);

  assert.equal(decoded.ok, false);
  if (!decoded.ok) {
    assert.equal(
      decoded.issues.some(
        (issue) => issue.code === "unexpected-remote-set-binding",
      ),
      true,
    );
  }
});

test("checkpoint decoding rejects unknown fields and invalid bounds", () => {
  const value = plan();
  const decoded = decodeBlooketWriteCheckpoint({
    schemaVersion: 2,
    planId: value.planId,
    nextOperationIndex: value.operations.length + 1,
    remoteSetId: "remote-set-1",
    extra: true,
  }, value);

  assert.equal(decoded.ok, false);
  if (!decoded.ok) {
    assert.equal(
      decoded.issues.some((issue) => issue.code === "unknown-field"),
      true,
    );
    assert.equal(
      decoded.issues.some(
        (issue) => issue.code === "invalid-checkpoint-index",
      ),
      true,
    );
  }
});
