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
//   - Legacy strings migrate while v2 answers retain kind without media URLs.
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
  decodeBlooketQuestionImageEvidence,
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

test("version-four question images carry exact content evidence or unknown",
  () => {
    const old = decodeBlooketQuestionRead(question);
    assert.ok(old.ok);
    if (!old.ok) return;
    for (const imageEvidence of [
      null, { byteLength: 42, sha256: "a".repeat(64) },
    ]) {
      const candidate = {
        ...old.value, schemaVersion: 4, hasImage: true, imageEvidence,
      };
      assert.deepEqual(decodeBlooketQuestionRead(candidate), {
        ok: true, value: candidate,
      });
    }
    assert.equal(decodeBlooketQuestionRead({
      ...old.value, schemaVersion: 4, hasImage: true,
    }).ok, false);
    assert.equal(decodeBlooketQuestionRead({
      ...old.value, schemaVersion: 4,
      imageEvidence: { byteLength: 42, sha256: "a".repeat(64) },
    }).ok, false);
    assert.equal(decodeBlooketQuestionRead({
      ...old.value, imageEvidence: null,
    }).ok, false);
  },
);

test("image identity decoding rejects URLs, bounds, and malformed hashes",
  () => {
    const valid = { byteLength: 42, sha256: "a".repeat(64) };
    for (const value of [
      undefined, [], {}, { ...valid, url: "https://provider.invalid/media" },
      { ...valid, path: "/private" }, { ...valid, byteLength: 0 },
      { ...valid, byteLength: 2_500_000 }, { ...valid, byteLength: 1.5 },
      { ...valid, sha256: "A".repeat(64) },
      { ...valid, sha256: "a".repeat(63) },
    ]) assert.equal(decodeBlooketQuestionImageEvidence(value).ok, false);
    assert.deepEqual(decodeBlooketQuestionImageEvidence(null), {
      ok: true, value: null,
    });
  },
);

test("version-one question reads migrate to normalized answer facts", () => {
  assert.deepEqual(decodeBlooketQuestionRead(question), {
    ok: true,
    value: {
      schemaVersion: 3,
      number: 1,
      question: "Type sun.",
      equation: null,
      qType: "typing",
      random: true,
      timeLimit: 10,
      answers: [{
        kind: "text",
        content: "sun",
        correct: true,
        match: "exactly",
      }],
      hasImage: false,
      hasAudio: false,
    },
  });
});

test("legacy image answers migrate without retaining provider identity", () => {
  const providerUrl = "https://provider.invalid/media";
  const result = decodeBlooketQuestionRead({
    schemaVersion: 1,
    number: 2,
    question: "Pick the image.",
    qType: "mc",
    random: false,
    timeLimit: 20,
    answers: ["`~`" + providerUrl, "`*`x^2`*`"],
    correctAnswers: ["`~`" + providerUrl],
    answerTypes: null,
    hasImage: false,
    hasAudio: false,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.answers, [
      { kind: "image", content: null, correct: true, match: null },
      { kind: "math", content: "x^2", correct: false, match: null },
    ]);
    assert.equal(JSON.stringify(result.value).includes(providerUrl), false);
  }
});

test("version-two reads admit image presence without a provider URL", () => {
  assert.deepEqual(decodeBlooketQuestionRead({
    schemaVersion: 2,
    number: 2,
    question: "Pick the image.",
    qType: "mc",
    random: false,
    timeLimit: 20,
    answers: [
      { kind: "image", content: null, correct: true, match: null },
      { kind: "math", content: "x^2", correct: false, match: null },
    ],
    hasImage: false,
    hasAudio: false,
  }), {
    ok: true,
    value: {
      schemaVersion: 3,
      number: 2,
      question: "Pick the image.",
      equation: null,
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: [
        { kind: "image", content: null, correct: true, match: null },
        { kind: "math", content: "x^2", correct: false, match: null },
      ],
      hasImage: false,
      hasAudio: false,
    },
  });
});

test("legacy prompt equations migrate without leaking provider markers", () => {
  const result = decodeBlooketQuestionRead({
    schemaVersion: 2,
    number: 3,
    question: "Solve this`*`\\frac{1}{2}`*`",
    qType: "mc",
    random: false,
    timeLimit: 20,
    answers: [
      { kind: "text", content: "1/2", correct: true, match: null },
      { kind: "text", content: "2", correct: false, match: null },
    ],
    hasImage: false,
    hasAudio: false,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.schemaVersion, 3);
    assert.equal(result.value.question, "Solve this");
    assert.equal(result.value.equation, "\\frac{1}{2}");
    assert.equal(JSON.stringify(result.value).includes("`*`"), false);
  }
});

test(
  "version-three question media is normalized and mutually exclusive",
  () => {
  const normalized = {
    schemaVersion: 3,
    number: 3,
    question: "Solve this",
    equation: "x^2",
    qType: "mc",
    random: false,
    timeLimit: 20,
    answers: [
      { kind: "text", content: "4", correct: true, match: null },
      { kind: "text", content: "5", correct: false, match: null },
    ],
    hasImage: false,
    hasAudio: false,
  } as const;
  assert.deepEqual(decodeBlooketQuestionRead(normalized), {
    ok: true,
    value: normalized,
  });
  const ambiguous = decodeBlooketQuestionRead({
    ...normalized,
    hasImage: true,
  });
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok)
    assert.equal(
      ambiguous.issues.some((issue) =>
        issue.code === "ambiguous-question-media"),
      true,
    );
  for (const malformed of [
    { ...normalized, question: "Solve`*`x^2`*`", equation: null },
    { ...normalized, equation: "" },
  ])
    assert.equal(decodeBlooketQuestionRead(malformed).ok, false);
  assert.equal(decodeBlooketQuestionRead({
    ...normalized,
    schemaVersion: 2,
    question: "Solve`*`x^2",
  }).ok, false);
  },
);

test("math answers require one exact provider delimiter pair", () => {
  const malformedLegacy = decodeBlooketQuestionRead({
    schemaVersion: 1,
    number: 4,
    question: "Pick math.",
    qType: "mc",
    random: false,
    timeLimit: 20,
    answers: ["`*`x`*`y`*`", "plain"],
    correctAnswers: ["`*`x`*`y`*`"],
    answerTypes: null,
    hasImage: false,
    hasAudio: false,
  });
  assert.equal(malformedLegacy.ok, false);
  if (!malformedLegacy.ok)
    assert.equal(
      malformedLegacy.issues.some((issue) =>
        issue.code === "invalid-legacy-math-answer"),
      true,
    );

  assert.equal(decodeBlooketQuestionRead({
    schemaVersion: 3,
    number: 4,
    question: "Pick math.",
    equation: null,
    qType: "mc",
    random: false,
    timeLimit: 20,
    answers: [
      { kind: "math", content: "x`*`y", correct: true, match: null },
      { kind: "text", content: "plain", correct: false, match: null },
    ],
    hasImage: false,
    hasAudio: false,
  }).ok, false);
});

test(
  "version-two answer kinds reject mismatched content and typing media",
  () => {
  for (const answer of [
    {
      kind: "image",
      content: "https://provider.invalid",
      correct: true,
      match: null,
    },
    { kind: "math", content: null, correct: true, match: null },
    { kind: "image", content: null, correct: true, match: "exactly" },
  ]) {
    const result = decodeBlooketQuestionRead({
      schemaVersion: 2,
      number: 1,
      question: "Type sun.",
      qType: "typing",
      random: false,
      timeLimit: 10,
      answers: [answer],
      hasImage: false,
      hasAudio: false,
    });
    assert.equal(result.ok, false);
  }
  },
);

test("legacy typing reads require match modes before migration", () => {
  const result = decodeBlooketQuestionRead({
    ...question,
    answerTypes: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "typing-answer-types-required",
      ),
      true,
    );
  }
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

test("question collections use the browser read safety cap", () => {
  const bounded = Array.from({ length: 200 }, (_, index) => ({
    ...question,
    number: index + 1,
  }));
  const admitted = decodeBlooketQuestionReadList(bounded);
  assert.equal(admitted.ok, true);
  if (admitted.ok) assert.equal(admitted.value.length, 200);

  const oversized = decodeBlooketQuestionReadList([
    ...bounded,
    { ...question, number: 201 },
  ]);
  assert.equal(oversized.ok, false);
  if (!oversized.ok) {
    assert.equal(oversized.issues[0]?.path, "$");
    assert.equal(oversized.issues[0]?.code, "too-many-questions");
  }
});

test("oversized answer and match arrays fail before normalization", () => {
  const values = Array.from({ length: 101 }, (_, index) => "value-" + index);
  const legacy = {
    ...question,
    answers: values,
    correctAnswers: values,
    answerTypes: values.map(() => "exactly"),
  };
  const normalized = {
    schemaVersion: 3,
    number: 1,
    question: "Type sun.",
    equation: null,
    qType: "typing",
    random: true,
    timeLimit: 10,
    answers: values.map((content) => ({
      kind: "text", content, correct: true, match: "exactly",
    })),
    hasImage: false,
    hasAudio: false,
  };
  for (const candidate of [
    legacy,
    { ...legacy, answers: ["sun"], correctAnswers: ["sun"] },
    { ...legacy, answers: ["sun"], answerTypes: ["exactly"] },
    normalized,
  ]) {
    const result = decodeBlooketQuestionRead(candidate);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues.some(
        (issue) => issue.code === "too-many-answers",
      ), true);
    }
  }
});

test("canonical question fields keep browser safety bounds", () => {
  const current = {
    schemaVersion: 3, number: 1, question: "Type sun.", equation: null,
    qType: "typing", random: true, timeLimit: 10,
    answers: [{
      kind: "text", content: "sun", correct: true, match: "exactly",
    }],
    hasImage: false, hasAudio: false,
  };
  for (const candidate of [
    { ...current, number: 10_001 },
    { ...current, timeLimit: 86_401 },
    { ...current, question: "q".repeat(20_001) },
    {
      ...current,
      answers: [{ ...current.answers[0], content: "a".repeat(10_001) }],
    },
    { ...question, number: 10_001 },
    { ...question, timeLimit: 86_401 },
    { ...question, question: "q".repeat(20_001) },
    { ...question, answers: ["a".repeat(10_001)],
      correctAnswers: ["a".repeat(10_001)] },
  ]) {
    assert.equal(decodeBlooketQuestionRead(candidate).ok, false);
  }
  assert.equal(decodeBlooketQuestionRead({
    ...current, number: 10_000, timeLimit: 86_400,
    question: "q".repeat(20_000),
    answers: [{...current.answers[0], content: "a".repeat(10_000)}],
  }).ok, true);
});

test("legacy answer values cannot ambiguously identify multiple rows", () => {
  for (const candidate of [
    { answers: ["sun", "sun"], correctAnswers: ["sun"],
      answerTypes: ["exactly", "contains"], qType: "typing" },
    { answers: ["red", "red"], correctAnswers: ["red"],
      answerTypes: null, qType: "mc" },
  ]) {
    const result = decodeBlooketQuestionRead({
      ...question, ...candidate,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issues.some((issue) =>
      issue.code === "duplicate-legacy-answer"), true);
  }
});
