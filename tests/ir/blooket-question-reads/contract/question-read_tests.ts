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
//   - Regression tests for observed Blooket question read contracts.
// - Must-Not:
//   - Assert remote IDs, media URLs, or undocumented account limits.
// - Allows:
//   - Inputs: Synthetic normalized question observations.
//   - Outputs: Exact decoding and fail-closed verdicts.
//   - Side effects: None.
// - Split-When:
//   - Another read contract needs independent fixtures.
// - Merge-When:
//   - Question read validation no longer exists independently.
// - Summary:
//   - Locks down the minimal fields proven by edit-page evidence.
// - Description:
//   - Media are presence booleans and answer strings remain opaque.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Inconsistent answers, numbers, and unknown fields are rejected.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeBlooketQuestionRead,
  decodeBlooketQuestionReadList,
} from
  "../../../../src/ir/blooket-question-reads/contract/question-read.ts";

const question = {
  schemaVersion: 1,
  number: 1,
  question: "Type sun.",
  qType: "typing",
  random: true,
  timeLimit: 10,
  answers: ["sun"],
  correctAnswers: ["sun"],
  answerTypes: ["exactly"],
  hasImage: false,
  hasAudio: false,
} as const;

test("question reads accept observed edit-page semantics", () => {
  assert.deepEqual(decodeBlooketQuestionRead(question), {
    ok: true,
    value: question,
  });
});

test("question reads reject invented fields and inconsistent answers", () => {
  const result = decodeBlooketQuestionRead({
    ...question,
    correctAnswers: ["star", "star"],
    answerTypes: ["exactly", "contains"],
    remoteQuestionId: "invented",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some((issue) => issue.code === "unknown-field"),
      true,
    );
    assert.equal(
      result.issues.some((issue) => issue.code === "unknown-correct-answer"),
      true,
    );
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "duplicate-correct-answer",
      ),
      true,
    );
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "answer-type-count-mismatch",
      ),
      true,
    );
  }
});

test("question lists reject duplicate question numbers", () => {
  const result = decodeBlooketQuestionReadList([
    question,
    { ...question, question: "Second" },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.code, "duplicate-question-number");
    assert.equal(result.issues[0]?.path, "$[1].number");
  }
});

test("question reads reject unsupported types and unsafe numbers", () => {
  const result = decodeBlooketQuestionRead({
    ...question,
    number: 0,
    qType: "poll",
    timeLimit: Number.MAX_SAFE_INTEGER + 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "expected-positive-integer",
      ),
      true,
    );
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "unsupported-question-type",
      ),
      true,
    );
  }
});
