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
    schemaVersion: 1,
    planId: value.planId,
    nextOperationIndex: 0,
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
    ),
    { ok: false, code: "write-plan-complete" },
  );
});

test("checkpoint decoding binds progress to one exact plan", () => {
  const value = plan();
  assert.deepEqual(
    decodeBlooketWriteCheckpoint({
      schemaVersion: 1,
      planId: value.planId,
      nextOperationIndex: 1,
    }, value),
    {
      ok: true,
      value: {
        schemaVersion: 1,
        planId: value.planId,
        nextOperationIndex: 1,
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
      schemaVersion: 1,
      planId: value.planId,
      nextOperationIndex: 1,
    }, changedResult.value);
    assert.equal(decoded.ok, false);
    if (!decoded.ok) {
      assert.equal(decoded.issues[0]?.code, "write-plan-mismatch");
    }
  }
});

test("checkpoint decoding rejects unknown fields and invalid bounds", () => {
  const value = plan();
  const decoded = decodeBlooketWriteCheckpoint({
    schemaVersion: 1,
    planId: value.planId,
    nextOperationIndex: value.operations.length + 1,
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
