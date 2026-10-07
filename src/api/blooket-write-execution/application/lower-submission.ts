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
        | "invalid-question-number"
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
    return {
      ok: true,
      value: lowerSet(operation),
    };
  }

  if (target.remoteSetId === null) {
    return { ok: false, code: "missing-remote-set-binding" };
  }
  if (
    !Number.isSafeInteger(operation.questionNumber)
    || operation.questionNumber < 1
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
  const mathMarker = "`*`";
  const imageMarker = "`~`";
  if (question.prompt.includes(mathMarker))
    return { ok: false, code: "ambiguous-provider-text" };
  if (question.type === "typing-answer") {
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

  const answers: BlooketQuestionAnswerSubmission[] = [];
  for (const answer of question.answers) {
    if (answer.text !== null && answer.imageMediaId === null) {
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

function mediaSlot(mediaId: string | null): BlooketSubmissionMedia | null {
  return mediaId === null ? null : { mediaId };
}
