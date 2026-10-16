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

test("native set metadata excludes NUL bytes", () => {
  const set: BlooketWriteOperation = {
    operationId: "plan:test:set:nul", kind: "set", title: "Title",
    description: "Notes", visibility: "private", coverMediaId: null,
  };
  if (set.kind !== "set") return;
  for (const modified of [
    { ...set, title: "Bad\0Title" },
    { ...set, description: "Bad\0Notes" },
  ]) assert.deepEqual(lowerBlooketWriteSubmission(modified,
    { remoteSetId: null }), { ok: false, code: "invalid-set-content" });
});

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
    { ...base.question, prompt: "Solve`*unfinished" },
    { ...base.question, prompt: "Picture`~`https://provider.invalid" },
    { ...base.question, answer: "sun`*`x`*`" },
    { ...base.question, answer: "sun`*unfinished" },
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

test("native set and remote identifier bounds fail before submission", () => {
  const set: BlooketWriteOperation = { operationId: "plan:test:set:bounds",
    kind: "set", title: "Quiz", description: "Description",
    visibility: "private", coverMediaId: null };
  for (const operation of [
    { ...set, title: "" },
    { ...set, title: " \t " },
    { ...set, title: "X".repeat(1_001) },
    { ...set, description: "X".repeat(10_001) },
  ]) assert.deepEqual(lowerBlooketWriteSubmission(operation,
    { remoteSetId: null }), { ok: false, code: "invalid-set-content" });
  const question: BlooketWriteOperation = {
    operationId: "plan:test:q:remote", kind: "question",
    localQuestionId: "q1", questionNumber: 1,
    question: { type: "typing-answer", prompt: "Type sun",
      timeLimitSeconds: 20, imageMediaId: null, matchMode: "exact",
      answer: "sun" },
  };
  for (const remoteSetId of ["", "x".repeat(513), "wrong\0id"]) {
    assert.deepEqual(lowerBlooketWriteSubmission(question,
      { remoteSetId }), { ok: false,
      code: "invalid-remote-set-binding" });
  }
});

test("native question and answer bounds fail before browser lowering", () => {
  const base: BlooketWriteOperation = {
    operationId: "plan:test:q:bounds", kind: "question",
    localQuestionId: "bounds", questionNumber: 1,
    question: { type: "typing-answer", prompt: "Type sun.",
      timeLimitSeconds: 10, imageMediaId: null, matchMode: "exact",
      answer: "sun" },
  };
  if (base.kind !== "question") return;
  for (const question of [
    { ...base.question, prompt: "x".repeat(20_001) },
    { ...base.question, prompt: "" },
    { ...base.question, prompt: " \t " },
    { ...base.question, prompt: "Type\0sun" },
    { ...base.question, timeLimitSeconds: 86_401 },
    { ...base.question, timeLimitSeconds: 0 },
  ]) assert.deepEqual(lowerBlooketWriteSubmission(
    { ...base, question }, { remoteSetId: "remote-set-1" },
  ), { ok: false, code: "invalid-question-content" });
  for (const answer of ["", " \t ", "x".repeat(10_001), "sun\0moon"]) {
    assert.deepEqual(lowerBlooketWriteSubmission({ ...base,
      question: { ...base.question, answer },
    }, { remoteSetId: "remote-set-1" }),
    { ok: false, code: "invalid-answer-content" });
  }
  const mc: BlooketWriteOperation = { ...base, question: {
    type: "multiple-choice", prompt: "Which star?", timeLimitSeconds: 10,
    randomOrder: true, imageMediaId: null, answers: [
      { text: "Sun", correct: true, imageMediaId: null },
      { text: "Moon", correct: false, imageMediaId: null },
    ],
  } };
  if (mc.kind !== "question" || mc.question.type !== "multiple-choice")
    return;
  for (const answer of ["", " \t ", "x".repeat(10_001), "Sun\0Moon"]) {
    assert.deepEqual(lowerBlooketWriteSubmission({ ...mc,
      question: { ...mc.question, answers: [
        { ...mc.question.answers[0]!, text: answer },
        mc.question.answers[1]!,
      ] },
    }, { remoteSetId: "remote-set-1" }),
    { ok: false, code: "invalid-answer-content" });
  }
});

test("multiple-choice native slots reject ambiguous answer sets", () => {
  const base: BlooketWriteOperation = {
    operationId: "plan:test:q:slots", kind: "question",
    localQuestionId: "slots", questionNumber: 1,
    question: { type: "multiple-choice", prompt: "Which is a star?",
      timeLimitSeconds: 20, randomOrder: true, imageMediaId: null,
      answers: [
        { text: "Sun", correct: true, imageMediaId: null },
        { text: "Moon", correct: false, imageMediaId: null },
      ],
    },
  };
  if (base.kind !== "question" || base.question.type !== "multiple-choice")
    return;
  const original = base.question.answers;
  for (const answers of [
    [original[0]!],
    [...original, original[0]!, original[1]!, original[0]!],
    original.map(answer => ({ ...answer, correct: false })),
    [{ ...original[0]!, text: "Moon" }, original[1]!],
  ]) assert.deepEqual(lowerBlooketWriteSubmission({ ...base,
    question: { ...base.question, answers },
  }, { remoteSetId: "remote-set-1" }),
  { ok: false, code: "invalid-answer-content" });
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
      { ...questionOperation, questionNumber: 10_001 },
      { remoteSetId: "remote-set-1" },
    ),
    { ok: false, code: "invalid-question-number" },
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
