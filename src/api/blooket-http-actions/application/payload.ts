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
//   - Candidate multipart lowering for observed Blooket dashboard actions.
// - Must-Not:
//   - Execute requests, infer response success, or activate unverified writes.
// - Allows:
//   - Inputs: Bounded provider candidates or validated submissions.
//   - Outputs: Candidate values or explicit failure.
//   - Side effects: None.
// - Split-When:
//   - Provider variants require independent validation contracts.
// - Merge-When:
//   - The provider no longer requires this candidate boundary.
// - Summary:
//   - Candidate multipart lowering for observed Blooket dashboard actions.
// - Description:
//   - Build-scoped candidates remain inactive until the response is verified.
// - Usage:
//   - Lower a validated semantic submission before transport admission.
// - Defaults:
//   - Unsupported media returns no HTTP candidate.
//
import type { BlooketWriteSubmission } from
  "../../../ir/blooket-write-submissions/contract/write-submission.ts";

export const VERIFIED_BLOOKET_BUILD =
  "4e10e84779aaa361fd4310c02366e37ebee7b60d";
export const CREATE_SET_ACTION = "be03b1237d81d5c540cdd65296df47f1f81ee635";
export const ADD_QUESTION_ACTION = "c7bb48d321e713abe99747de0867b432c79bf671";
export const UPDATE_QUESTION_ACTION =
  "ef65a6a8bc45e5d082f1e6334883b7bbd2b028df";
export const UPDATE_SET_ACTION = "8e84d51f7a6c74727758776d1e40038cc07b36db";
export interface ActionPayload {
  readonly actionId: string;
  readonly route: string;
  readonly fields: readonly (readonly [string, string])[];
}
export function lowerHttpAction(
  submission: BlooketWriteSubmission,
): ActionPayload | undefined {
  const fields: [string, string][] = [
    [
      "0",
      JSON.stringify([
        { status: "UNSET", message: "", fieldErrors: {} },
        "$K1",
      ]),
    ],
  ];
  if (submission.kind === "create-set") {
    if (submission.coverImage !== null) return undefined;
    fields.push(
      ["1_title", submission.title],
      ["1_desc", submission.description],
      ["1_coverImage", ""],
    );
    if (!submission.private) fields.push(["1_private", "on"]);
    return { actionId: CREATE_SET_ACTION, route: "/create", fields };
  }
  if (
    submission.image !== null ||
    submission.answers.some((answer) => answer.kind !== "text")
  )
    return undefined;
  const answers = submission.answers.map((answer) => {
    if (answer.kind !== "text") throw new Error("unsupported-http-media");
    return answer.text;
  });
  const question = {
    number: submission.number,
    question: submission.question,
    answers,
    correctAnswers: submission.answers.flatMap((answer) =>
      answer.kind === "text" && answer.correct ? [answer.text] : [],
    ),
    image: "",
    audio: "",
    qType: submission.qType,
    random: submission.random,
    answerTypes: submission.answerTypes,
    timeLimit: submission.timeLimit,
  };
  fields.push(
    ["1_setId", submission.remoteSetId],
    ["1_question", JSON.stringify(question)],
    ["1_coverImage", ""],
  );
  answers.forEach((answer, index) =>
    fields.push([
      submission.qType === "typing"
        ? "1_accepted-answers"
        : "1_answer-" + index,
      answer,
    ]),
  );
  if (submission.qType === "mc")
    for (let index = answers.length; index < 4; index += 1)
      fields.push(["1_answer-" + index, ""]);
  return { actionId: ADD_QUESTION_ACTION, route: "/edit", fields };
}
