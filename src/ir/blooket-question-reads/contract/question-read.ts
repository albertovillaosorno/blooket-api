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
//   - Versioned runtime contracts for observed Blooket questions.
// - Must-Not:
//   - Guess remote question IDs, media URLs, mastery fields, or account limits.
// - Allows:
//   - Inputs: Untrusted normalized question candidates from browser adapters.
//   - Outputs: Exact decoded question semantics used for read-back comparison.
//   - Side effects: None.
// - Split-When:
//   - Another question family needs independently versioned read semantics.
// - Merge-When:
//   - Question reads become part of a stable provider-owned public contract.
// - Summary:
//   - Validates only fields established by authenticated edit-page evidence.
// - Description:
//   - Provider media URLs are reduced to answer kind and presence facts.
// - Usage:
//   - Decode browser observations before conflict or write verification.
// - Defaults:
//   - Unknown fields, unsupported types, and inconsistent answers fail closed.
//
import {
  type DecodeResult,
  type ValidationIssue,
} from "../../runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../runtime-decoding/domain/exact-object.ts";

export const BLOOKET_QUESTION_READ_VERSION = 2 as const;
const LEGACY_BLOOKET_QUESTION_READ_VERSION = 1 as const;
const LEGACY_IMAGE_ANSWER_MARKER = "`~`";
const LEGACY_MATH_ANSWER_MARKER = "`*`";

export type BlooketAnswerReadKind = "text" | "math" | "image";
export type BlooketAnswerMatch = "exactly" | "contains";

export interface BlooketAnswerRead {
  readonly kind: BlooketAnswerReadKind;
  readonly content: string | null;
  readonly correct: boolean;
  readonly match: BlooketAnswerMatch | null;
}

export interface BlooketQuestionRead {
  readonly schemaVersion: typeof BLOOKET_QUESTION_READ_VERSION;
  readonly number: number;
  readonly question: string;
  readonly qType: "mc" | "typing";
  readonly random: boolean;
  readonly timeLimit: number;
  readonly answers: readonly BlooketAnswerRead[];
  readonly hasImage: boolean;
  readonly hasAudio: boolean;
}

const QUESTION_KEYS = new Set([
  "schemaVersion",
  "number",
  "question",
  "qType",
  "random",
  "timeLimit",
  "answers",
  "hasImage",
  "hasAudio",
]);
const LEGACY_QUESTION_KEYS = new Set([
  ...QUESTION_KEYS,
  "correctAnswers",
  "answerTypes",
]);
const ANSWER_KEYS = new Set([
  "kind",
  "content",
  "correct",
  "match",
]);

export function decodeBlooketQuestionRead(
  value: unknown,
  path = "$",
): DecodeResult<BlooketQuestionRead> {
  if (!isRecord(value)) {
    return failure(path, "expected-object", "Expected a Blooket question.");
  }

  const issues: ValidationIssue[] = [];
  const version = value["schemaVersion"];
  if (
    version !== LEGACY_BLOOKET_QUESTION_READ_VERSION
    && version !== BLOOKET_QUESTION_READ_VERSION
  ) {
    issues.push({
      path: path + ".schemaVersion",
      code: "unsupported-version",
      message: "Expected Blooket question read version 1 or 2.",
    });
  }
  issues.push(...unknownFieldIssues(
    value,
    version === LEGACY_BLOOKET_QUESTION_READ_VERSION
      ? LEGACY_QUESTION_KEYS
      : QUESTION_KEYS,
    path,
  ));

  const number = positiveInteger(value["number"], path + ".number", issues);
  const question = requiredString(
    value["question"],
    path + ".question",
    issues,
  );
  const qType = value["qType"];
  if (qType !== "mc" && qType !== "typing") {
    issues.push({
      path: path + ".qType",
      code: "unsupported-question-type",
      message: 'Expected "mc" or "typing".',
    });
  }
  const random = booleanValue(value["random"], path + ".random", issues);
  const timeLimit = positiveInteger(
    value["timeLimit"],
    path + ".timeLimit",
    issues,
  );
  const answers = version === LEGACY_BLOOKET_QUESTION_READ_VERSION
    ? decodeLegacyAnswers(value, path, qType, issues)
    : decodeAnswers(value["answers"], path + ".answers", qType, issues);
  const hasImage = booleanValue(
    value["hasImage"],
    path + ".hasImage",
    issues,
  );
  const hasAudio = booleanValue(
    value["hasAudio"],
    path + ".hasAudio",
    issues,
  );

  if (issues.length > 0) return { ok: false, issues };
  if (
    number === undefined
    || question === undefined
    || (qType !== "mc" && qType !== "typing")
    || random === undefined
    || timeLimit === undefined
    || answers === undefined
    || hasImage === undefined
    || hasAudio === undefined
  ) {
    return failure(path, "decoder-invariant", "Decoder invariant failed.");
  }

  return {
    ok: true,
    value: {
      schemaVersion: BLOOKET_QUESTION_READ_VERSION,
      number,
      question,
      qType,
      random,
      timeLimit,
      answers,
      hasImage,
      hasAudio,
    },
  };
}

export function decodeBlooketQuestionReadList(
  value: unknown,
): DecodeResult<readonly BlooketQuestionRead[]> {
  if (!Array.isArray(value)) {
    return failure("$", "expected-array", "Expected a question array.");
  }
  const questions: BlooketQuestionRead[] = [];
  const issues: ValidationIssue[] = [];
  const numbers = new Set<number>();
  for (const [index, candidate] of value.entries()) {
    const path = "$[" + String(index) + "]";
    const decoded = decodeBlooketQuestionRead(candidate, path);
    if (!decoded.ok) {
      issues.push(...decoded.issues);
      continue;
    }
    if (numbers.has(decoded.value.number)) {
      issues.push({
        path: path + ".number",
        code: "duplicate-question-number",
        message: "Question number appears more than once.",
      });
      continue;
    }
    numbers.add(decoded.value.number);
    questions.push(decoded.value);
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: questions };
}

function decodeLegacyAnswers(
  value: Record<string, unknown>,
  path: string,
  qType: unknown,
  issues: ValidationIssue[],
): readonly BlooketAnswerRead[] | undefined {
  const answers = stringArray(value["answers"], path + ".answers", issues);
  const correctAnswers = stringArray(
    value["correctAnswers"],
    path + ".correctAnswers",
    issues,
  );
  const answerTypes = decodeLegacyAnswerTypes(
    value["answerTypes"],
    path + ".answerTypes",
    issues,
  );
  if (answers === undefined || correctAnswers === undefined) return undefined;

  const available = new Set(answers);
  const seen = new Set<string>();
  for (const [index, answer] of correctAnswers.entries()) {
    if (!available.has(answer)) {
      issues.push({
        path: path + ".correctAnswers[" + String(index) + "]",
        code: "unknown-correct-answer",
        message: "Correct answer must exist in answers.",
      });
    }
    if (seen.has(answer)) {
      issues.push({
        path: path + ".correctAnswers[" + String(index) + "]",
        code: "duplicate-correct-answer",
        message: "Correct answers must be unique.",
      });
    }
    seen.add(answer);
  }
  if (
    answerTypes !== undefined
    && answerTypes !== null
    && answerTypes.length !== answers.length
  ) {
    issues.push({
      path: path + ".answerTypes",
      code: "answer-type-count-mismatch",
      message: "Answer types must align with the answer array.",
    });
  }
  if (qType === "typing" && answerTypes === null) {
    issues.push({
      path: path + ".answerTypes",
      code: "typing-answer-types-required",
      message: "Typing answers require explicit match modes.",
    });
  }
  if (answerTypes === undefined) return undefined;

  const normalized: BlooketAnswerRead[] = [];
  for (const [index, answer] of answers.entries()) {
    const decoded = normalizeLegacyAnswer(
      answer,
      path + ".answers[" + String(index) + "]",
      qType,
      correctAnswers.includes(answer),
      qType === "typing" ? answerTypes?.[index] ?? null : null,
      issues,
    );
    if (decoded !== undefined) normalized.push(decoded);
  }
  return normalized;
}

function normalizeLegacyAnswer(
  answer: string,
  path: string,
  qType: unknown,
  correct: boolean,
  match: BlooketAnswerMatch | null,
  issues: ValidationIssue[],
): BlooketAnswerRead | undefined {
  if (answer.startsWith(LEGACY_IMAGE_ANSWER_MARKER)) {
    if (
      qType !== "mc"
      || answer.length <= LEGACY_IMAGE_ANSWER_MARKER.length
      || answer.indexOf(
        LEGACY_IMAGE_ANSWER_MARKER,
        LEGACY_IMAGE_ANSWER_MARKER.length,
      ) !== -1
    ) {
      issues.push({
        path,
        code: "invalid-legacy-image-answer",
        message: "Legacy image answer marker is malformed.",
      });
      return undefined;
    }
    return { kind: "image", content: null, correct, match: null };
  }
  if (answer.includes(LEGACY_IMAGE_ANSWER_MARKER)) {
    issues.push({
      path,
      code: "invalid-legacy-image-answer",
      message: "Legacy image answer marker is ambiguous.",
    });
    return undefined;
  }
  if (answer.startsWith(LEGACY_MATH_ANSWER_MARKER)) {
    if (
      qType !== "mc"
      || !answer.endsWith(LEGACY_MATH_ANSWER_MARKER)
      || answer.length <= LEGACY_MATH_ANSWER_MARKER.length * 2
    ) {
      issues.push({
        path,
        code: "invalid-legacy-math-answer",
        message: "Legacy math answer marker is malformed.",
      });
      return undefined;
    }
    return {
      kind: "math",
      content: answer.slice(
        LEGACY_MATH_ANSWER_MARKER.length,
        -LEGACY_MATH_ANSWER_MARKER.length,
      ),
      correct,
      match: null,
    };
  }
  return { kind: "text", content: answer, correct, match };
}

function decodeAnswers(
  value: unknown,
  path: string,
  qType: unknown,
  issues: ValidationIssue[],
): readonly BlooketAnswerRead[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      code: "expected-array",
      message: "Expected a normalized answer array.",
    });
    return undefined;
  }
  if (value.length > 100) {
    issues.push({
      path,
      code: "too-many-answers",
      message: "Expected at most 100 answers.",
    });
  }
  const answers: BlooketAnswerRead[] = [];
  for (const [index, candidate] of value.entries()) {
    const decoded = decodeAnswer(
      candidate,
      path + "[" + String(index) + "]",
      qType,
      issues,
    );
    if (decoded !== undefined) answers.push(decoded);
  }
  return answers;
}

function decodeAnswer(
  value: unknown,
  path: string,
  qType: unknown,
  issues: ValidationIssue[],
): BlooketAnswerRead | undefined {
  if (!isRecord(value)) {
    issues.push({
      path,
      code: "expected-object",
      message: "Expected a normalized Blooket answer.",
    });
    return undefined;
  }
  issues.push(...unknownFieldIssues(value, ANSWER_KEYS, path));
  const kind = value["kind"];
  if (kind !== "text" && kind !== "math" && kind !== "image") {
    issues.push({
      path: path + ".kind",
      code: "unsupported-answer-kind",
      message: 'Expected "text", "math", or "image".',
    });
  }
  const content = value["content"];
  if (
    (kind === "image" && content !== null)
    || ((kind === "text" || kind === "math")
      && (typeof content !== "string" || content.length === 0))
  ) {
    issues.push({
      path: path + ".content",
      code: "invalid-answer-content",
      message: "Answer content does not match its normalized kind.",
    });
  }
  const correct = booleanValue(
    value["correct"],
    path + ".correct",
    issues,
  );
  const match = value["match"];
  if (match !== null && match !== "exactly" && match !== "contains") {
    issues.push({
      path: path + ".match",
      code: "invalid-answer-match",
      message: 'Expected null, "exactly", or "contains".',
    });
  }
  if (qType === "mc" && match !== null) {
    issues.push({
      path: path + ".match",
      code: "unexpected-answer-match",
      message: "Multiple-choice answers do not carry typing match modes.",
    });
  }
  if (
    qType === "typing"
    && (kind !== "text" || (match !== "exactly" && match !== "contains"))
  ) {
    issues.push({
      path,
      code: "invalid-typing-answer",
      message: "Typing answers require text and an explicit match mode.",
    });
  }
  if (
    (kind !== "text" && kind !== "math" && kind !== "image")
    || correct === undefined
    || (match !== null && match !== "exactly" && match !== "contains")
    || (kind === "image" && content !== null)
    || ((kind === "text" || kind === "math") && typeof content !== "string")
  ) {
    return undefined;
  }
  const normalizedContent = kind === "image" ? null : content as string;
  const normalizedMatch = match === "exactly" || match === "contains"
    ? match
    : null;
  return {
    kind,
    content: normalizedContent,
    correct,
    match: normalizedMatch,
  };
}

function positiveInteger(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  if (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
  ) {
    return value;
  }
  issues.push({
    path,
    code: "expected-positive-integer",
    message: "Expected a positive safe integer.",
  });
  return undefined;
}

function booleanValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): boolean | undefined {
  if (typeof value === "boolean") return value;
  issues.push({
    path,
    code: "expected-boolean",
    message: "Expected true or false.",
  });
  return undefined;
}

function stringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      code: "expected-array",
      message: "Expected a string array.",
    });
    return undefined;
  }
  const result: string[] = [];
  for (const [index, candidate] of value.entries()) {
    const item = requiredString(
      candidate,
      path + "[" + String(index) + "]",
      issues,
    );
    if (item !== undefined) result.push(item);
  }
  return result;
}

function decodeLegacyAnswerTypes(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly BlooketAnswerMatch[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    issues.push({
      path,
      code: "expected-answer-types",
      message: "Expected null or an answer-type array.",
    });
    return undefined;
  }
  const result: BlooketAnswerMatch[] = [];
  for (const [index, candidate] of value.entries()) {
    if (candidate !== "exactly" && candidate !== "contains") {
      issues.push({
        path: path + "[" + String(index) + "]",
        code: "invalid-answer-type",
        message: 'Expected "exactly" or "contains".',
      });
      continue;
    }
    result.push(candidate);
  }
  return result;
}

function failure<T>(
  path: string,
  code: string,
  message: string,
): DecodeResult<T> {
  return { ok: false, issues: [{ path, code, message }] };
}
