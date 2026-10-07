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
//   - Regression evidence for build-scoped Blooket HTTP action candidates.
// - Must-Not:
//   - Send requests, claim action responses, or activate HTTP publication.
// - Allows:
//   - Inputs: Sanitized validated set/question submission fixtures.
//   - Outputs: Exact multipart field candidates or unsupported verdicts.
//   - Side effects: None.
// - Split-When:
//   - Another observed build requires an incompatible multipart contract.
// - Merge-When:
//   - HTTP action candidates are removed.
// - Summary:
//   - Pins privacy, question, answer, timing, and media lowering semantics.
// - Description:
//   - These fixtures validate request candidates only, never remote success.
// - Usage:
//   - Run with the repository Node test suite.
// - Defaults:
//   - Media-backed candidates remain unsupported.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  ADD_QUESTION_ACTION,
  CREATE_SET_ACTION,
  UPDATE_QUESTION_ACTION,
  UPDATE_SET_ACTION,
  VERIFIED_BLOOKET_BUILD,
  lowerHttpAction,
} from "../../../../src/api/blooket-http-actions/application/payload.ts";
import type {
  BlooketAddQuestionSubmission,
  BlooketCreateSetSubmission,
} from
  "../../../../src/ir/blooket-write-submissions/contract/write-submission.ts";

const INITIAL_STATE = JSON.stringify([
  { status: "UNSET", message: "", fieldErrors: {} },
  "$K1",
]);

test("observed update hashes remain identifiers, not write support", () => {
  assert.equal(
    UPDATE_QUESTION_ACTION,
    "ef65a6a8bc45e5d082f1e6334883b7bbd2b028df",
  );
  assert.equal(
    UPDATE_SET_ACTION,
    "8e84d51f7a6c74727758776d1e40038cc07b36db",
  );
});

function set(privateSet: boolean): BlooketCreateSetSubmission {
  return {
    schemaVersion: 1,
    kind: "create-set",
    title: "Synthetic astronomy",
    description: "Synthetic review fixture",
    private: privateSet,
    coverImage: null,
  };
}

test("create candidates preserve the observed inverted privacy field", () => {
  assert.equal(
    VERIFIED_BLOOKET_BUILD,
    "4e10e84779aaa361fd4310c02366e37ebee7b60d",
  );
  assert.deepEqual(lowerHttpAction(set(true)), {
    actionId: CREATE_SET_ACTION,
    route: "/create",
    fields: [
      ["0", INITIAL_STATE],
      ["1_title", "Synthetic astronomy"],
      ["1_desc", "Synthetic review fixture"],
      ["1_coverImage", ""],
    ],
  });
  assert.deepEqual(lowerHttpAction(set(false)), {
    actionId: CREATE_SET_ACTION,
    route: "/create",
    fields: [
      ["0", INITIAL_STATE],
      ["1_title", "Synthetic astronomy"],
      ["1_desc", "Synthetic review fixture"],
      ["1_coverImage", ""],
      ["1_private", "on"],
    ],
  });
});

test(
  "multiple-choice candidates preserve answers correctness and seconds",
  () => {
  const submission: BlooketAddQuestionSubmission = {
    schemaVersion: 1,
    kind: "add-question",
    remoteSetId: "opaque-set-id",
    number: 3,
    question: "Which object is a star?",
    answers: [
      { kind: "text", text: "Sun", correct: true },
      { kind: "text", text: "Moon", correct: false },
      { kind: "text", text: "Earth", correct: false },
    ],
    image: null,
    audio: "",
    qType: "mc",
    random: true,
    answerTypes: null,
    timeLimit: 20,
  };
  const payload = lowerHttpAction(submission);
  assert.ok(payload);
  assert.equal(payload.actionId, ADD_QUESTION_ACTION);
  assert.equal(payload.route, "/edit");
  assert.deepEqual(payload.fields, [
    ["0", INITIAL_STATE],
    ["1_setId", "opaque-set-id"],
    [
      "1_question",
      JSON.stringify({
        number: 3,
        question: "Which object is a star?",
        answers: ["Sun", "Moon", "Earth"],
        correctAnswers: ["Sun"],
        image: "",
        audio: "",
        qType: "mc",
        random: true,
        answerTypes: null,
        timeLimit: 20,
      }),
    ],
    ["1_coverImage", ""],
    ["1_answer-0", "Sun"],
    ["1_answer-1", "Moon"],
    ["1_answer-2", "Earth"],
    ["1_answer-3", ""],
  ]);
  },
);

test(
  "typing candidates preserve repeated accepted answers and match modes",
  () => {
  const submission: BlooketAddQuestionSubmission = {
    schemaVersion: 1,
    kind: "add-question",
    remoteSetId: "opaque-set-id",
    number: 4,
    question: "Name the star.",
    answers: [
      { kind: "text", text: "sun", correct: true },
      { kind: "text", text: "the sun", correct: true },
    ],
    image: null,
    audio: "",
    qType: "typing",
    random: true,
    answerTypes: ["exactly", "contains"],
    timeLimit: 15,
  };
  const payload = lowerHttpAction(submission);
  assert.ok(payload);
  assert.deepEqual(payload.fields, [
    ["0", INITIAL_STATE],
    ["1_setId", "opaque-set-id"],
    [
      "1_question",
      JSON.stringify({
        number: 4,
        question: "Name the star.",
        answers: ["sun", "the sun"],
        correctAnswers: ["sun", "the sun"],
        image: "",
        audio: "",
        qType: "typing",
        random: true,
        answerTypes: ["exactly", "contains"],
        timeLimit: 15,
      }),
    ],
    ["1_coverImage", ""],
    ["1_accepted-answers", "sun"],
    ["1_accepted-answers", "the sun"],
  ]);
  },
);

test(
  "media-backed candidates remain unsupported before any HTTP mutation",
  () => {
  assert.equal(
    lowerHttpAction({ ...set(true), coverImage: { mediaId: "cover" } }),
    undefined,
  );
  const base: BlooketAddQuestionSubmission = {
    schemaVersion: 1,
    kind: "add-question",
    remoteSetId: "set",
    number: 1,
    question: "Synthetic question",
    answers: [{ kind: "text", text: "A", correct: true }],
    image: null,
    audio: "",
    qType: "mc",
    random: false,
    answerTypes: null,
    timeLimit: 10,
  };
  assert.equal(
    lowerHttpAction({ ...base, image: { mediaId: "question-image" } }),
    undefined,
  );
  assert.equal(
    lowerHttpAction({
      ...base,
      answers: [
        {
          kind: "image",
          image: { mediaId: "answer-image" },
          correct: true,
        },
      ],
    }),
    undefined,
  );
  },
);
