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
//   - Minimal versioned runtime contracts for observed Blooket questions.
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
//   - Media are represented by presence only; provider strings stay untrusted.
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

export const BLOOKET_QUESTION_READ_VERSION = 1 as const;

export interface BlooketQuestionRead {
  readonly schemaVersion: typeof BLOOKET_QUESTION_READ_VERSION;
  readonly number: number;
  readonly question: string;
  readonly qType: "mc" | "typing";
  readonly random: boolean;
  readonly timeLimit: number;
  readonly answers: readonly string[];
  readonly correctAnswers: readonly string[];
  readonly answerTypes: readonly ("exactly" | "contains")[] | null;
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
  "correctAnswers",
  "answerTypes",
  "hasImage",
  "hasAudio",
]);

export function decodeBlooketQuestionRead(
  value: unknown,
  path = "$",
): DecodeResult<BlooketQuestionRead> {
  if (!isRecord(value)) {
    return failure(path, "expected-object", "Expected a Blooket question.");
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, QUESTION_KEYS, path),
  ];
  if (value["schemaVersion"] !== BLOOKET_QUESTION_READ_VERSION) {
    issues.push({
      path: path + ".schemaVersion",
      code: "unsupported-version",
      message: "Expected Blooket question read version 1.",
    });
  }
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
  const answers = stringArray(value["answers"], path + ".answers", issues);
  const correctAnswers = stringArray(
    value["correctAnswers"],
    path + ".correctAnswers",
    issues,
  );
  const answerTypes = decodeAnswerTypes(
    value["answerTypes"],
    path + ".answerTypes",
    issues,
  );
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

  if (answers !== undefined && correctAnswers !== undefined) {
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
  }
  if (
    answers !== undefined
    && answerTypes !== undefined
    && answerTypes !== null
    && answerTypes.length !== answers.length
  ) {
    issues.push({
      path: path + ".answerTypes",
      code: "answer-type-count-mismatch",
      message: "Answer types must align with the answer array.",
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  if (
    number === undefined
    || question === undefined
    || (qType !== "mc" && qType !== "typing")
    || random === undefined
    || timeLimit === undefined
    || answers === undefined
    || correctAnswers === undefined
    || answerTypes === undefined
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
      correctAnswers,
      answerTypes,
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

function decodeAnswerTypes(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly ("exactly" | "contains")[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    issues.push({
      path,
      code: "expected-answer-types",
      message: "Expected null or an answer-type array.",
    });
    return undefined;
  }
  const result: ("exactly" | "contains")[] = [];
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
