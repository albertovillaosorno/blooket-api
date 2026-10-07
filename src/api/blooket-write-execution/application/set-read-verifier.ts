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
//   - Differential set and question verification from validated read surfaces.
// - Must-Not:
//   - Mutate remotely, retry, or confirm media identity from presence alone.
// - Allows:
//   - Inputs: Read ports plus exact operation, target, and prior baseline.
//   - Outputs: Collection baselines and exact reconciliation evidence.
//   - Side effects: Read-only set/detail/question browser observations.
// - Split-When:
//   - Set and question verification need incompatible reconciliation policies.
// - Merge-When:
//   - Browser writes expose transactionally queryable operation receipts.
// - Summary:
//   - Confirms writes only by reproducing the exact pre-write collection.
// - Description:
//   - One exact candidate is removed before comparing the prior baseline.
// - Usage:
//   - Use after authenticated adapters normalize and validate provider reads.
// - Defaults:
//   - Media writes and concurrent or ambiguous changes remain inconclusive.
//
import { createHash } from "node:crypto";

import {
  decodeBlooketQuestionReadList,
  type BlooketQuestionRead,
} from "../../../ir/blooket-question-reads/contract/question-read.ts";
import {
  decodeBlooketSetDetail,
  decodeBlooketSetList,
  type BlooketSetDetail,
  type BlooketSetSummary,
} from "../../../ir/blooket-set-reads/contract/set-read.ts";
import {
  frameBlooketWriteVerificationCollection,
  sameBlooketWriteVerificationBaseline,
  type BlooketWriteVerificationBaseline,
} from
  "../../../projects/blooket-write-plans/domain/verification-baseline.ts";
import type {
  BlooketQuestionOperation,
} from "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type { BlooketQuestionReadPort } from
  "../../blooket-set-reads/contract/question-reads.ts";
import type { BlooketSetReadPort } from
  "../../blooket-set-reads/contract/set-reads.ts";
import type { BlooketWriteTarget } from "../contract/write-execution.ts";
import type {
  BlooketWriteVerificationPort,
  BlooketWriteVerificationResult,
} from "../contract/write-verification.ts";
import { lowerBlooketWriteSubmission } from "./lower-submission.ts";

export function blooketSetReadWriteVerifier(
  reads: BlooketSetReadPort,
  questionReads?: BlooketQuestionReadPort,
): BlooketWriteVerificationPort {
  return {
    captureBaseline: async (operation, target) => {
      if (operation.kind === "question") {
        if (questionReads === undefined || target.remoteSetId === null) {
          return { ok: true, baseline: null };
        }
        const listed = await safeQuestions(
          questionReads,
          target.remoteSetId,
        );
        if (!listed.ok) return listed;
        return {
          ok: true,
          baseline: questionBaselineFor(listed.value),
        };
      }

      const listed = await safeList(reads);
      if (!listed.ok) return listed;
      return {
        ok: true,
        baseline: setBaselineFor(listed.value),
      };
    },

    verify: async (operation, target, baseline) => {
      if (operation.kind === "question") {
        return verifyQuestion(
          questionReads,
          operation,
          target,
          baseline,
        );
      }
      if (baseline === null || baseline.kind !== "set-list") {
        return { ok: true, outcome: "inconclusive" };
      }

      const listed = await safeList(reads);
      if (!listed.ok) return listed;
      const currentBaseline = setBaselineFor(listed.value);
      if (sameBlooketWriteVerificationBaseline(currentBaseline, baseline)) {
        return { ok: true, outcome: "not-confirmed" };
      }
      if (listed.value.length !== baseline.itemCount + 1) {
        return { ok: true, outcome: "inconclusive" };
      }
      if (operation.coverMediaId !== null) {
        return { ok: true, outcome: "inconclusive" };
      }

      const candidates = listed.value
        .map((set, index) => ({ set, index }))
        .filter(({ set }) => set.title === operation.title)
        .filter(({ index }) => sameBlooketWriteVerificationBaseline(
          setBaselineFor(withoutIndex(listed.value, index)),
          baseline,
        ));
      if (candidates.length !== 1) {
        return { ok: true, outcome: "inconclusive" };
      }

      const candidate = candidates[0]?.set;
      if (candidate === undefined) {
        return { ok: true, outcome: "inconclusive" };
      }
      const detailed = await safeGet(reads, candidate.id);
      if (!detailed.ok) return detailed;
      if (
        detailed.value.id !== candidate.id
        || detailed.value.title !== operation.title
        || detailed.value.description !== operation.description
        || detailed.value.visibility !== operation.visibility
      ) {
        return { ok: true, outcome: "inconclusive" };
      }
      return {
        ok: true,
        outcome: "confirmed",
        receipt: {
          kind: "set-created",
          remoteSetId: candidate.id,
        },
      };
    },
  };
}

async function verifyQuestion(
  reads: BlooketQuestionReadPort | undefined,
  operation: BlooketQuestionOperation,
  target: BlooketWriteTarget,
  baseline: BlooketWriteVerificationBaseline | null,
): Promise<BlooketWriteVerificationResult> {
  if (
    reads === undefined
    || target.remoteSetId === null
    || baseline === null
    || baseline.kind !== "question-list"
  ) {
    return { ok: true, outcome: "inconclusive" };
  }

  const listed = await safeQuestions(reads, target.remoteSetId);
  if (!listed.ok) return listed;
  const currentBaseline = questionBaselineFor(listed.value);
  if (sameBlooketWriteVerificationBaseline(currentBaseline, baseline)) {
    return { ok: true, outcome: "not-confirmed" };
  }
  if (listed.value.length !== baseline.itemCount + 1) {
    return { ok: true, outcome: "inconclusive" };
  }

  const lowered = lowerBlooketWriteSubmission(operation, target);
  if (
    !lowered.ok
    || lowered.value.kind !== "add-question"
    || lowered.value.image !== null
    || lowered.value.answers.some((answer) => answer.kind !== "text")
  ) {
    return { ok: true, outcome: "inconclusive" };
  }

  const candidates = listed.value
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => questionMatches(
      question,
      lowered.value,
    ))
    .filter(({ index }) => sameBlooketWriteVerificationBaseline(
      questionBaselineFor(withoutIndex(listed.value, index)),
      baseline,
    ));
  return candidates.length === 1
    ? { ok: true, outcome: "confirmed", receipt: null }
    : { ok: true, outcome: "inconclusive" };
}

function questionMatches(
  actual: BlooketQuestionRead,
  expected: Extract<
    ReturnType<typeof lowerBlooketWriteSubmission>,
    { readonly ok: true }
  >["value"],
): boolean {
  if (expected.kind !== "add-question") return false;
  const answers = expected.answers.flatMap((answer) =>
    answer.kind === "text" ? [answer.text] : []
  );
  if (answers.length !== expected.answers.length) return false;
  const correctAnswers = expected.answers.flatMap((answer) =>
    answer.kind === "text" && answer.correct ? [answer.text] : []
  );

  return actual.number === expected.number
    && actual.question === expected.question
    && actual.qType === expected.qType
    && actual.random === expected.random
    && actual.timeLimit === expected.timeLimit
    && equalArray(actual.answers, answers)
    && equalArray(actual.correctAnswers, correctAnswers)
    && equalArray(actual.answerTypes, expected.answerTypes)
    && actual.hasImage === false
    && actual.hasAudio === false;
}

async function safeList(
  reads: BlooketSetReadPort,
): Promise<
  | { readonly ok: true; readonly value: readonly BlooketSetSummary[] }
  | Extract<BlooketWriteVerificationResult, { readonly ok: false }>
> {
  try {
    const probed = await reads.list();
    if (!probed.ok) {
      return { ok: false, kind: "browser", code: probed.code };
    }
    const decoded = decodeBlooketSetList(probed.value);
    return decoded.ok
      ? { ok: true, value: decoded.value }
      : browserFailure();
  } catch {
    return browserFailure();
  }
}

async function safeGet(
  reads: BlooketSetReadPort,
  setId: string,
): Promise<
  | {
      readonly ok: true;
      readonly value: BlooketSetDetail;
    }
  | Extract<BlooketWriteVerificationResult, { readonly ok: false }>
> {
  try {
    const probed = await reads.get(setId);
    if (!probed.ok) {
      return { ok: false, kind: "browser", code: probed.code };
    }
    const decoded = decodeBlooketSetDetail(probed.value);
    return decoded.ok
      ? { ok: true, value: decoded.value }
      : browserFailure();
  } catch {
    return browserFailure();
  }
}

async function safeQuestions(
  reads: BlooketQuestionReadPort,
  setId: string,
): Promise<
  | { readonly ok: true; readonly value: readonly BlooketQuestionRead[] }
  | Extract<BlooketWriteVerificationResult, { readonly ok: false }>
> {
  try {
    const probed = await reads.list(setId);
    if (!probed.ok) {
      return { ok: false, kind: "browser", code: probed.code };
    }
    const decoded = decodeBlooketQuestionReadList(probed.value);
    return decoded.ok
      ? { ok: true, value: decoded.value }
      : browserFailure();
  } catch {
    return browserFailure();
  }
}

function setBaselineFor(
  sets: readonly BlooketSetSummary[],
): BlooketWriteVerificationBaseline {
  const items = sets.map((set) => JSON.stringify([set.id, set.title]));
  return baselineFor("set-list", items);
}

function questionBaselineFor(
  questions: readonly BlooketQuestionRead[],
): BlooketWriteVerificationBaseline {
  const items = questions.map((question) => JSON.stringify([
    question.number,
    question.question,
    question.qType,
    question.random,
    question.timeLimit,
    question.answers,
    question.correctAnswers,
    question.answerTypes,
    question.hasImage,
    question.hasAudio,
  ]));
  return baselineFor("question-list", items);
}

function baselineFor(
  kind: "set-list" | "question-list",
  items: readonly string[],
): BlooketWriteVerificationBaseline {
  const framed = frameBlooketWriteVerificationCollection(items);
  return {
    schemaVersion: 1,
    kind,
    itemCount: items.length,
    sha256: createHash("sha256").update(framed, "utf8").digest("hex"),
  };
}

function withoutIndex<T>(
  items: readonly T[],
  index: number,
): readonly T[] {
  return [
    ...items.slice(0, index),
    ...items.slice(index + 1),
  ];
}

function equalArray<T>(
  left: readonly T[] | null,
  right: readonly T[] | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function browserFailure(): Extract<
  BlooketWriteVerificationResult,
  { readonly ok: false }
> {
  return {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  };
}
