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
//   - Unit tests for lowering write plans into observed Blooket form semantics.
// - Must-Not:
//   - Invoke a browser, filesystem, network, or server action.
// - Allows:
//   - Inputs: Fixed set/question operations and remote targets.
//   - Outputs: Exact provider submission shapes and fail-closed target
//     verdicts.
//   - Side effects: None.
// - Split-When:
//   - Provider form variants require separate lowering profiles.
// - Merge-When:
//   - Provider submission lowering is removed.
// - Summary:
//   - Pins mc/typing, matching, numbering, media slots, and privacy semantics.
// - Description:
//   - Fixtures mirror recovered Create Set and Add Question client state.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Invalid media combinations and target bindings are rejected.
//
import assert from "node:assert/strict";
import test from "node:test";

import { lowerBlooketWriteSubmission } from
  "../../../../src/api/blooket-write-execution/application/lower-submission.ts";
import type { BlooketWriteOperation } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

test(
  "set lowering maps visibility and preserves an opaque cover media slot",
  () => {
  const operation: BlooketWriteOperation = {
    operationId: "plan:test:set",
    kind: "set",
    title: "Astronomy",
    description: "Review",
    visibility: "private",
    coverMediaId: "cover-1",
  };

  assert.deepEqual(
    lowerBlooketWriteSubmission(operation, { remoteSetId: null }),
    {
      ok: true,
      value: {
        schemaVersion: 1,
        kind: "create-set",
        title: "Astronomy",
        description: "Review",
        private: true,
        coverImage: { mediaId: "cover-1" },
      },
    },
  );
  },
);

test(
  "multiple choice lowering keeps answer order correctness and media slots",
  () => {
  const operation: BlooketWriteOperation = {
    operationId: "plan:test:q:0",
    kind: "question",
    localQuestionId: "q1",
    questionNumber: 1,
    question: {
      type: "multiple-choice",
      prompt: "Which is a star?",
      timeLimitSeconds: 20,
      randomOrder: false,
      imageMediaId: "question-image",
      answers: [
        {
          text: "Sun",
          correct: true,
          imageMediaId: null,
        },
        {
          text: null,
          correct: false,
          imageMediaId: "moon",
        },
      ],
    },
  };

  assert.deepEqual(
    lowerBlooketWriteSubmission(
      operation,
      { remoteSetId: "remote-set-1" },
    ),
    {
      ok: true,
      value: {
        schemaVersion: 1,
        kind: "add-question",
        remoteSetId: "remote-set-1",
        number: 1,
        question: "Which is a star?",
        answers: [
          { kind: "text", text: "Sun", correct: true },
          {
            kind: "image",
            image: { mediaId: "moon" },
            correct: false,
          },
        ],
        image: { mediaId: "question-image" },
        audio: "",
        qType: "mc",
        random: false,
        answerTypes: null,
        timeLimit: 20,
      },
    },
  );
  },
);

test("typing lowering maps match mode to observed Blooket answerTypes", () => {
  const operation: BlooketWriteOperation = {
    operationId: "plan:test:q:1",
    kind: "question",
    localQuestionId: "q2",
    questionNumber: 2,
    question: {
      type: "typing-answer",
      prompt: "Type moon.",
      timeLimitSeconds: 15,
      imageMediaId: null,
      matchMode: "contains",
      answer: "moon",
    },
  };

  assert.deepEqual(
    lowerBlooketWriteSubmission(
      operation,
      { remoteSetId: "remote-set-1" },
    ),
    {
      ok: true,
      value: {
        schemaVersion: 1,
        kind: "add-question",
        remoteSetId: "remote-set-1",
        number: 2,
        question: "Type moon.",
        answers: [
          { kind: "text", text: "moon", correct: true },
        ],
        image: null,
        audio: "",
        qType: "typing",
        random: true,
        answerTypes: ["contains"],
        timeLimit: 15,
      },
    },
  );
});

test("provider text markers fail before browser lowering", () => {
  const base: BlooketWriteOperation = {
    operationId: "plan:test:q:marker",
    kind: "question",
    localQuestionId: "marker",
    questionNumber: 1,
    question: {
      type: "typing-answer",
      prompt: "Type sun.",
      timeLimitSeconds: 10,
      imageMediaId: null,
      matchMode: "exact",
      answer: "sun",
    },
  };
  for (const question of [
    { ...base.question, prompt: "Solve`*`x^2`*`" },
    { ...base.question, answer: "sun`*`x`*`" },
    { ...base.question, answer: "sun`~`https://provider.invalid" },
  ]) {
    assert.deepEqual(
      lowerBlooketWriteSubmission(
        { ...base, question },
        { remoteSetId: "remote-set-1" },
      ),
      { ok: false, code: "ambiguous-provider-text" },
    );
  }
});

test(
  "target and impossible answer invariants fail before browser mechanics",
  () => {
  const setOperation: BlooketWriteOperation = {
    operationId: "plan:test:set",
    kind: "set",
    title: "Set",
    description: "",
    visibility: "public",
    coverMediaId: null,
  };
  assert.deepEqual(
    lowerBlooketWriteSubmission(
      setOperation,
      { remoteSetId: "premature" },
    ),
    {
      ok: false,
      code: "unexpected-remote-set-binding",
    },
  );

  const questionOperation: BlooketWriteOperation = {
    operationId: "plan:test:q:0",
    kind: "question",
    localQuestionId: "q1",
    questionNumber: 1,
    question: {
      type: "multiple-choice",
      prompt: "Question",
      timeLimitSeconds: 10,
      randomOrder: true,
      imageMediaId: null,
      answers: [{
        text: "ambiguous",
        correct: true,
        imageMediaId: "also-image",
      }],
    },
  };
  assert.deepEqual(
    lowerBlooketWriteSubmission(
      questionOperation,
      { remoteSetId: "remote-set-1" },
    ),
    {
      ok: false,
      code: "invalid-answer-content",
    },
  );
  assert.deepEqual(
    lowerBlooketWriteSubmission(
      questionOperation,
      { remoteSetId: null },
    ),
    {
      ok: false,
      code: "missing-remote-set-binding",
    },
  );
  },
);
