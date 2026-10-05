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
//   - Behavioral tests for version-one local question documents.
// - Must-Not:
//   - Test account capabilities or browser automation.
// - Allows:
//   - Inputs: Fixed multiple-choice and typing-answer fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Question variants need independently versioned fixture suites.
// - Merge-When:
//   - Local question documents cease to exist.
// - Summary:
//   - Verifies strict Blooket-targetable question structure.
// - Description:
//   - Mirrors src/projects/question-documents/domain/question.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Multiple choice requires 2-4 answers and one correct answer.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeQuestionDocument } from
  "../../../../src/projects/question-documents/domain/question.ts";

const multipleChoice = {
  id: "q1",
  type: "multiple-choice",
  prompt: "Which word means sol?",
  timeLimitSeconds: 20,
  randomOrder: true,
  image: null,
  answers: [
    { text: "Sun", correct: true, image: null },
    { text: "Son", correct: false, image: null },
  ],
};

const typingAnswer = {
  id: "q2",
  type: "typing-answer",
  prompt: "Type the English word for sol.",
  timeLimitSeconds: 20,
  image: null,
  matchMode: "exact",
  answer: "sun",
};

test("multiple choice accepts 2-4 answers with a correct answer", () => {
  assert.equal(decodeQuestionDocument(multipleChoice).ok, true);
});

test("multiple choice rejects fewer than two answers", () => {
  const result = decodeQuestionDocument({
    ...multipleChoice,
    answers: [multipleChoice.answers[0]],
  });

  assert.equal(result.ok, false);
});

test("multiple choice rejects a set without a correct answer", () => {
  const result = decodeQuestionDocument({
    ...multipleChoice,
    answers: multipleChoice.answers.map((answer) => ({
      ...answer,
      correct: false,
    })),
  });

  assert.equal(result.ok, false);
});

test("multiple choice admits image-only answers structurally", () => {
  const result = decodeQuestionDocument({
    ...multipleChoice,
    answers: [
      {
        text: null,
        correct: true,
        image: {
          description: "A bright yellow sun in a blue sky.",
          mediaId: null,
        },
      },
      multipleChoice.answers[1],
    ],
  });

  assert.equal(result.ok, true);
});

test("typing answers admit exact and contains matching", () => {
  assert.equal(decodeQuestionDocument(typingAnswer).ok, true);
  assert.equal(
    decodeQuestionDocument({ ...typingAnswer, matchMode: "contains" }).ok,
    true,
  );
});

test("typing answers reject unknown matching modes", () => {
  const result = decodeQuestionDocument({
    ...typingAnswer,
    matchMode: "fuzzy",
  });

  assert.equal(result.ok, false);
});
