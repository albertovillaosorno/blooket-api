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
//   - Deterministic lowering from canonical writes to Blooket form semantics.
// - Must-Not:
//   - Inspect DOM, resolve media, submit forms, or guess provider identifiers.
// - Allows:
//   - Inputs: One planned operation and its durable remote target.
//   - Outputs: Provider submission semantics or a stable target invariant
//     failure.
//   - Side effects: None.
// - Split-When:
//   - Set/question lowering require independently versioned provider profiles.
// - Merge-When:
//   - Write plans directly encode the browser submission contract.
// - Summary:
//   - Converts remote-neutral plan values into observed Blooket form semantics.
// - Description:
//   - Typing answers map exact to exactly; fresh typing keeps random true.
// - Usage:
//   - Run immediately before concrete browser media/form preparation.
// - Defaults:
//   - Missing or premature remote set bindings fail closed.
//
import {
  BLOOKET_WRITE_SUBMISSION_VERSION,
  type BlooketAddQuestionSubmission,
  type BlooketCreateSetSubmission,
  type BlooketQuestionAnswerSubmission,
  type BlooketSubmissionMedia,
  type BlooketWriteSubmission,
} from
  "../../../ir/blooket-write-submissions/contract/write-submission.ts";
import type {
  BlooketQuestionOperation,
  BlooketSetOperation,
} from "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type {
  BlooketWriteOperation,
} from "../../../projects/blooket-write-plans/domain/write-plan.ts";
import { decodeBlooketSetId } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";
import type { BlooketWriteTarget } from "../contract/write-execution.ts";

export type LowerBlooketWriteSubmissionResult =
  | {
      readonly ok: true;
      readonly value: BlooketWriteSubmission;
    }
  | {
      readonly ok: false;
      readonly code:
        | "unexpected-remote-set-binding"
        | "missing-remote-set-binding"
        | "invalid-remote-set-binding"
        | "invalid-set-content"
        | "invalid-question-number"
        | "invalid-question-content"
        | "invalid-answer-content"
        | "ambiguous-provider-text";
    };

export function lowerBlooketWriteSubmission(
  operation: BlooketWriteOperation,
  target: BlooketWriteTarget,
): LowerBlooketWriteSubmissionResult {
  if (operation.kind === "set") {
    if (target.remoteSetId !== null) {
      return { ok: false, code: "unexpected-remote-set-binding" };
    }
    if (!operation.title.trim() || operation.title.length > 1_000 ||
        /[\r\n]/u.test(operation.title) ||
        operation.title.includes("\0") ||
        operation.description.length > 10_000 ||
        operation.description.includes("\0"))
      return { ok: false, code: "invalid-set-content" };
    return {
      ok: true,
      value: lowerSet(operation),
    };
  }

  if (target.remoteSetId === null) {
    return { ok: false, code: "missing-remote-set-binding" };
  }
  if (!decodeBlooketSetId(target.remoteSetId).ok)
    return { ok: false, code: "invalid-remote-set-binding" };
  if (
    !Number.isSafeInteger(operation.questionNumber)
    || operation.questionNumber < 1
    || operation.questionNumber > 10_000
  ) {
    return { ok: false, code: "invalid-question-number" };
  }
  return lowerQuestion(operation, target.remoteSetId);
}

function lowerSet(
  operation: BlooketSetOperation,
): BlooketCreateSetSubmission {
  return {
    schemaVersion: BLOOKET_WRITE_SUBMISSION_VERSION,
    kind: "create-set",
    title: operation.title,
    description: operation.description,
    private: operation.visibility === "private",
    coverImage: mediaSlot(operation.coverMediaId),
  };
}

function lowerQuestion(
  operation: BlooketQuestionOperation,
  remoteSetId: string,
): LowerBlooketWriteSubmissionResult {
  const question = operation.question;
  // Match the native editor's rejection of incomplete equation markers.
  // Canonical publication preflights this lowering before journaling.
  const mathMarker = "`*";
  const imageMarker = "`~`";
  if (!question.prompt.trim() || question.prompt.length > 20_000 ||
      question.prompt.includes("\0") ||
      !Number.isSafeInteger(question.timeLimitSeconds) ||
      question.timeLimitSeconds < 1 || question.timeLimitSeconds > 86_400)
    return { ok: false, code: "invalid-question-content" };
  if (question.prompt.includes(mathMarker) ||
      question.prompt.includes(imageMarker))
    return { ok: false, code: "ambiguous-provider-text" };
  if (question.type === "typing-answer") {
    if (invalidNativeAnswer(question.answer) ||
        /[\r\n]/u.test(question.answer))
      return { ok: false, code: "invalid-answer-content" };
    if (
      question.answer.includes(mathMarker) ||
      question.answer.includes(imageMarker)
    )
      return { ok: false, code: "ambiguous-provider-text" };
    return {
      ok: true,
      value: {
        schemaVersion: BLOOKET_WRITE_SUBMISSION_VERSION,
        kind: "add-question",
        remoteSetId,
        number: operation.questionNumber,
        question: question.prompt,
        answers: [{
          kind: "text",
          text: question.answer,
          correct: true,
        }],
        image: mediaSlot(question.imageMediaId),
        audio: "",
        qType: "typing",
        random: true,
        answerTypes: [
          question.matchMode === "exact" ? "exactly" : "contains",
        ],
        timeLimit: question.timeLimitSeconds,
      },
    };
  }

  // The native MC editor has two to four distinct text slots and at
  // least one correct answer. Do not defer impossible forms to the browser.
  const texts = question.answers.flatMap(answer =>
    answer.text === null ? [] : [answer.text]);
  if (question.answers.length < 2 || question.answers.length > 4 ||
      !question.answers.some(answer => answer.correct) ||
      new Set(texts).size !== texts.length)
    return { ok: false, code: "invalid-answer-content" };
  const answers: BlooketQuestionAnswerSubmission[] = [];
  for (const answer of question.answers) {
    if (answer.text !== null && answer.imageMediaId === null) {
      if (invalidNativeAnswer(answer.text))
        return { ok: false, code: "invalid-answer-content" };
      if (answer.text.includes(mathMarker) || answer.text.includes(imageMarker))
        return { ok: false, code: "ambiguous-provider-text" };
      answers.push({
        kind: "text",
        text: answer.text,
        correct: answer.correct,
      });
      continue;
    }
    if (answer.text === null && answer.imageMediaId !== null) {
      answers.push({
        kind: "image",
        image: { mediaId: answer.imageMediaId },
        correct: answer.correct,
      });
      continue;
    }
    return { ok: false, code: "invalid-answer-content" };
  }

  const value: BlooketAddQuestionSubmission = {
    schemaVersion: BLOOKET_WRITE_SUBMISSION_VERSION,
    kind: "add-question",
    remoteSetId,
    number: operation.questionNumber,
    question: question.prompt,
    answers,
    image: mediaSlot(question.imageMediaId),
    audio: "",
    qType: "mc",
    random: question.randomOrder,
    answerTypes: null,
    timeLimit: question.timeLimitSeconds,
  };
  return { ok: true, value };
}

// Mirror the native editor's exact answer size and NUL guard before any
// durable attempt is opened. The local project decoder stays provider-neutral.
function invalidNativeAnswer(text: string): boolean {
  return !text.trim() || text.length > 10_000 || text.includes("\0");
}

function mediaSlot(mediaId: string | null): BlooketSubmissionMedia | null {
  return mediaId === null ? null : { mediaId };
}
