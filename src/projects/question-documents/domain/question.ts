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
//   - Version-one local question structures that can target Blooket.
// - Must-Not:
//   - Assume account capabilities or perform remote Blooket writes.
// - Allows:
//   - Inputs: Unknown runtime question candidates.
//   - Outputs: Strict question documents or structured validation failures.
//   - Side effects: None.
// - Split-When:
//   - A question type requires an independently versioned document contract.
// - Merge-When:
//   - Projects stop persisting questions as local structured documents.
// - Summary:
//   - Validates multiple-choice and typing-answer question documents.
// - Description:
//   - Enforces confirmed Blooket structure without guessing capability limits.
// - Usage:
//   - Decode model output before project persistence or write-plan creation.
// - Defaults:
//   - Timers are positive integers and media references are explicit.
//
import {
  decodeFailure,
  type DecodeResult,
  type ValidationIssue,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";
import {
  decodeImageRequest,
  type ImageRequest,
} from "../../image-requests/domain/image-request.ts";

export type QuestionDocument =
  | MultipleChoiceQuestion
  | TypingAnswerQuestion;

export interface MultipleChoiceQuestion {
  readonly id: string;
  readonly type: "multiple-choice";
  readonly prompt: string;
  readonly timeLimitSeconds: number;
  readonly randomOrder: boolean;
  readonly image: ImageRequest | null;
  readonly answers: readonly MultipleChoiceAnswer[];
}

export interface MultipleChoiceAnswer {
  readonly text: string | null;
  readonly correct: boolean;
  readonly image: ImageRequest | null;
}

export interface TypingAnswerQuestion {
  readonly id: string;
  readonly type: "typing-answer";
  readonly prompt: string;
  readonly timeLimitSeconds: number;
  readonly image: ImageRequest | null;
  readonly matchMode: "exact" | "contains";
  readonly answer: string;
}

const QUESTION_ID = /^[a-z0-9](?:[a-z0-9._-]{0,127})$/u;
const MULTIPLE_CHOICE_KEYS = new Set([
  "id",
  "type",
  "prompt",
  "timeLimitSeconds",
  "randomOrder",
  "image",
  "answers",
]);
const TYPING_ANSWER_KEYS = new Set([
  "id",
  "type",
  "prompt",
  "timeLimitSeconds",
  "image",
  "matchMode",
  "answer",
]);
const ANSWER_KEYS = new Set(["text", "correct", "image"]);

export function decodeQuestionDocument(
  value: unknown,
  path = "$",
): DecodeResult<QuestionDocument> {
  if (!isRecord(value)) {
    return decodeFailure(
      path,
      "expected-object",
      "Expected a question object.",
    );
  }

  if (value["type"] === "multiple-choice") {
    return decodeMultipleChoice(value, path);
  }

  if (value["type"] === "typing-answer") {
    return decodeTypingAnswer(value, path);
  }

  return decodeFailure(
    `${path}.type`,
    "unsupported-question-type",
    'Expected "multiple-choice" or "typing-answer".',
  );
}

function decodeMultipleChoice(
  value: Readonly<Record<string, unknown>>,
  path: string,
): DecodeResult<MultipleChoiceQuestion> {
  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, MULTIPLE_CHOICE_KEYS, path),
  ];
  const id = decodeQuestionId(value["id"], `${path}.id`, issues);
  const prompt = requiredString(value["prompt"], `${path}.prompt`, issues);
  const timeLimitSeconds = decodeTimeLimit(
    value["timeLimitSeconds"],
    `${path}.timeLimitSeconds`,
    issues,
  );
  const randomOrder = value["randomOrder"];
  const image = decodeNullableImage(
    value["image"],
    `${path}.image`,
    issues,
  );
  const answers = decodeAnswers(value["answers"], `${path}.answers`, issues);

  if (typeof randomOrder !== "boolean") {
    issues.push({
      path: `${path}.randomOrder`,
      code: "expected-boolean",
      message: "Expected true or false.",
    });
  }

  if (
    answers !== undefined
    && !answers.some((answer) => answer.correct)
  ) {
    issues.push({
      path: `${path}.answers`,
      code: "missing-correct-answer",
      message: "Expected at least one correct answer.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (
    id === undefined
    || prompt === undefined
    || timeLimitSeconds === undefined
    || typeof randomOrder !== "boolean"
    || image === undefined
    || answers === undefined
  ) {
    return decodeFailure(
      path,
      "decoder-invariant",
      "Decoder invariant failed.",
    );
  }

  return {
    ok: true,
    value: {
      id,
      type: "multiple-choice",
      prompt,
      timeLimitSeconds,
      randomOrder,
      image,
      answers,
    },
  };
}

function decodeTypingAnswer(
  value: Readonly<Record<string, unknown>>,
  path: string,
): DecodeResult<TypingAnswerQuestion> {
  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, TYPING_ANSWER_KEYS, path),
  ];
  const id = decodeQuestionId(value["id"], `${path}.id`, issues);
  const prompt = requiredString(value["prompt"], `${path}.prompt`, issues);
  const timeLimitSeconds = decodeTimeLimit(
    value["timeLimitSeconds"],
    `${path}.timeLimitSeconds`,
    issues,
  );
  const image = decodeNullableImage(
    value["image"],
    `${path}.image`,
    issues,
  );
  const matchMode = value["matchMode"];
  const answer = requiredString(value["answer"], `${path}.answer`, issues);

  if (matchMode !== "exact" && matchMode !== "contains") {
    issues.push({
      path: `${path}.matchMode`,
      code: "invalid-match-mode",
      message: 'Expected "exact" or "contains".',
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (
    id === undefined
    || prompt === undefined
    || timeLimitSeconds === undefined
    || image === undefined
    || (matchMode !== "exact" && matchMode !== "contains")
    || answer === undefined
  ) {
    return decodeFailure(
      path,
      "decoder-invariant",
      "Decoder invariant failed.",
    );
  }

  return {
    ok: true,
    value: {
      id,
      type: "typing-answer",
      prompt,
      timeLimitSeconds,
      image,
      matchMode,
      answer,
    },
  };
}

function decodeAnswers(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly MultipleChoiceAnswer[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      code: "expected-array",
      message: "Expected an answer array.",
    });
    return undefined;
  }

  if (value.length < 2 || value.length > 4) {
    issues.push({
      path,
      code: "invalid-answer-count",
      message: "Expected between 2 and 4 answers.",
    });
  }

  const answers: MultipleChoiceAnswer[] = [];
  for (const [index, candidate] of value.entries()) {
    const decoded = decodeAnswer(candidate, `${path}[${index}]`);
    if (!decoded.ok) {
      issues.push(...decoded.issues);
      continue;
    }
    answers.push(decoded.value);
  }

  return answers;
}

function decodeAnswer(
  value: unknown,
  path: string,
): DecodeResult<MultipleChoiceAnswer> {
  if (!isRecord(value)) {
    return decodeFailure(path, "expected-object", "Expected an answer object.");
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, ANSWER_KEYS, path),
  ];
  const textValue = value["text"];
  const text = textValue === null
    ? null
    : requiredString(textValue, `${path}.text`, issues);
  const correct = value["correct"];
  const image = decodeNullableImage(
    value["image"],
    `${path}.image`,
    issues,
  );

  if (typeof correct !== "boolean") {
    issues.push({
      path: `${path}.correct`,
      code: "expected-boolean",
      message: "Expected true or false.",
    });
  }

  if (text === null && image === null) {
    issues.push({
      path,
      code: "empty-answer",
      message: "Expected answer text or an image.",
    });
  }
  if (text !== null && text !== undefined && image !== null) {
    issues.push({
      path,
      code: "ambiguous-answer-content",
      message: "Expected answer text or an image, but not both.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (
    text === undefined
    || typeof correct !== "boolean"
    || image === undefined
  ) {
    return decodeFailure(
      path,
      "decoder-invariant",
      "Decoder invariant failed.",
    );
  }

  return { ok: true, value: { text, correct, image } };
}

function decodeNullableImage(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): ImageRequest | null | undefined {
  if (value === null) {
    return null;
  }

  const decoded = decodeImageRequest(value, path);
  if (!decoded.ok) {
    issues.push(...decoded.issues);
    return undefined;
  }
  return decoded.value;
}

function decodeQuestionId(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  const id = requiredString(value, path, issues);
  if (id !== undefined && !QUESTION_ID.test(id)) {
    issues.push({
      path,
      code: "invalid-question-id",
      message: "Expected a lowercase stable question identifier.",
    });
    return undefined;
  }
  return id;
}

function decodeTimeLimit(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    issues.push({
      path,
      code: "invalid-time-limit",
      message: "Expected a positive safe integer number of seconds.",
    });
    return undefined;
  }
  return value;
}
