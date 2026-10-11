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
import type {
  BlooketSetListCompleteness,
  BlooketSetReadPort,
} from "../../blooket-set-reads/contract/set-reads.ts";
import type { BlooketWriteTarget } from "../contract/write-execution.ts";
import type {
  BlooketWriteVerificationPort,
  BlooketWriteVerificationResult,
} from "../contract/write-verification.ts";
import { lowerBlooketWriteSubmission } from "./lower-submission.ts";

import {
  decodePreparedMediaIdentities, type PreparedMediaIdentities,
  type PreparedMediaIdentity,
} from
  "../../../projects/blooket-write-plans/domain/prepared-media-identities.ts";

export function blooketSetReadWriteVerifier(
  reads: BlooketSetReadPort,
  questionReads?: BlooketQuestionReadPort,
  expectedMedia?: PreparedMediaIdentities,
): BlooketWriteVerificationPort {
  // Never fetch current library bytes to decide an old ambiguous attempt.
  // Clone the exact admitted durable identity before any browser awaits.
  const media = expectedMedia === undefined ? undefined
    : decodePreparedMediaIdentities(expectedMedia);
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
      if (listed.completeness !== "complete") {
        return { ok: true, baseline: null };
      }
      return {
        ok: true,
        baseline: setBaselineFor(listed.value),
      };
    },

    verify: async (operation, target, baseline) => {
      if (expectedMedia !== undefined && media === undefined)
        return { ok: true, outcome: "inconclusive" };
      if (operation.kind === "question") {
        return verifyQuestion(
          questionReads,
          operation,
          target,
          baseline,
          media,
        );
      }
      if (baseline === null || baseline.kind !== "set-list") {
        return { ok: true, outcome: "inconclusive" };
      }

      const listed = await safeList(reads);
      if (!listed.ok) return listed;
      if (listed.completeness !== "complete") {
        return { ok: true, outcome: "inconclusive" };
      }
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
  media?: PreparedMediaIdentities,
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
  if (currentBaseline === null) {
    return { ok: true, outcome: "inconclusive" };
  }
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
    || lowered.value.answers.some((answer) => answer.kind !== "text")
  ) {
    return { ok: true, outcome: "inconclusive" };
  }

  const expectedImageId = lowered.value.image?.mediaId;
  const expectedImage = expectedImageId === undefined ? undefined
    : media?.items.find(item => item.mediaId === expectedImageId);
  if (lowered.value.image !== null && expectedImage === undefined)
    return { ok: true, outcome: "inconclusive" };
  const candidates = listed.value
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => questionMatches(
      question,
      lowered.value,
      expectedImage,
    ))
    .filter(({ index }) => sameBlooketWriteVerificationBaseline(
      questionBaselineFor(withoutIndex(listed.value, index)),
      baseline,
    ));
  return candidates.length === 1
    ? { ok: true, outcome: "confirmed", receipt: null }
    : { ok: true, outcome: "inconclusive" };
}

export function questionMatches(
  actual: BlooketQuestionRead,
  expected: Extract<
    ReturnType<typeof lowerBlooketWriteSubmission>,
    { readonly ok: true }
  >["value"],
  expectedImage?: PreparedMediaIdentity,
): boolean {
  if (expected.kind !== "add-question") return false;
  const identity = expectedImage === undefined ? undefined
    : decodePreparedMediaIdentities({ schemaVersion: 1,
      items: [expectedImage] })?.items[0];
  const imageMatches = expected.image === null
    ? !actual.hasImage && expectedImage === undefined
    : identity !== undefined && identity.mediaId === expected.image.mediaId &&
      actual.hasImage && actual.schemaVersion === 4 &&
      actual.imageEvidence !== null &&
      actual.imageEvidence.byteLength === identity.byteLength &&
      actual.imageEvidence.sha256 === identity.sha256;
  const answers = expected.answers.flatMap((answer, index) =>
    answer.kind === "text"
      ? [{
          kind: "text" as const,
          content: answer.text,
          correct: answer.correct,
          match: expected.answerTypes?.[index] ?? null,
        }]
      : []
  );
  if (answers.length !== expected.answers.length) return false;

  return actual.number === expected.number
    && actual.question === expected.question
    && actual.equation === null
    && actual.qType === expected.qType
    && actual.random === expected.random
    && actual.timeLimit === expected.timeLimit
    && equalQuestionAnswers(actual.answers, answers)
    && imageMatches
    && actual.hasAudio === false;
}

async function safeList(
  reads: BlooketSetReadPort,
): Promise<
  | {
      readonly ok: true;
      readonly value: readonly BlooketSetSummary[];
      readonly completeness: BlooketSetListCompleteness;
    }
  | Extract<BlooketWriteVerificationResult, { readonly ok: false }>
> {
  try {
    const probed = await reads.list();
    if (!probed || probed.ok !== true)
      return safeProbeFailure(probed);
    if (!exactProbeKeys(probed, "completeness,ok,value") ||
      probed.completeness !== "complete"
      && probed.completeness !== "unknown"
    ) {
      return browserFailure();
    }
    const decoded = decodeBlooketSetList(probed.value);
    return decoded.ok
      ? {
          ok: true,
          value: decoded.value,
          completeness: probed.completeness,
        }
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
    if (!probed || probed.ok !== true)
      return safeProbeFailure(probed);
    if (!exactProbeKeys(probed, "ok,value")) return browserFailure();
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
    if (!probed || probed.ok !== true)
      return safeProbeFailure(probed);
    if (!exactProbeKeys(probed, "ok,value")) return browserFailure();
    const decoded = decodeBlooketQuestionReadList(probed.value);
    return decoded.ok
      ? { ok: true, value: decoded.value }
      : browserFailure();
  } catch {
    return browserFailure();
  }
}

function exactProbeKeys(value: unknown, keys: string): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Reflect.ownKeys(value).sort().join() === keys;
}

function safeProbeFailure(value: unknown): Extract<
  BlooketWriteVerificationResult, { readonly ok: false }
> {
  if (!exactProbeKeys(value, "code,ok") ||
      !value || typeof value !== "object" ||
      !("ok" in value) || value.ok !== false ||
      !("code" in value) ||
      (value.code !== "blooket-browser-failed" &&
       value.code !== "blooket-browser-unavailable" &&
       value.code !== "blooket-browser-incompatible"))
    return browserFailure();
  return { ok: false, kind: "browser", code: value.code };
}

function setBaselineFor(
  sets: readonly BlooketSetSummary[],
): BlooketWriteVerificationBaseline {
  const items = sets.map((set) => JSON.stringify([set.id, set.title]));
  return baselineFor("set-list", items);
}

function questionBaselineFor(
  questions: readonly BlooketQuestionRead[],
): BlooketWriteVerificationBaseline | null {
  // An image replacement must not pass as an unchanged prior collection.
  // Legacy presence-only reads and unreadable images cannot establish this.
  if (questions.some(question => question.hasAudio ||
      question.answers.some(answer => answer.kind === "image") ||
      (question.hasImage &&
        (question.schemaVersion !== 4 || question.imageEvidence === null))))
    return null;
  const items = questions.map(questionBaselineItem);
  return baselineFor("question-list", items);
}

function questionBaselineItem(question: BlooketQuestionRead): string {
  if (question.hasImage && question.schemaVersion === 4) {
    return JSON.stringify([
      "v4", question.number, question.question, question.equation,
      question.qType, question.random, question.timeLimit, question.answers,
      question.hasImage, question.hasAudio, question.imageEvidence,
    ]);
  }
  if (question.equation !== null) {
    return JSON.stringify([
      "v3",
      question.number,
      question.question,
      question.equation,
      question.qType,
      question.random,
      question.timeLimit,
      question.answers,
      question.hasImage,
      question.hasAudio,
    ]);
  }
  if (question.answers.every((answer) => answer.kind === "text")) {
    const answers = question.answers.map((answer) => answer.content);
    const correctAnswers = question.answers
      .filter((answer) => answer.correct)
      .map((answer) => answer.content);
    const answerTypes = question.qType === "typing"
      ? question.answers.map((answer) => answer.match)
      : null;
    return JSON.stringify([
      question.number,
      question.question,
      question.qType,
      question.random,
      question.timeLimit,
      answers,
      correctAnswers,
      answerTypes,
      question.hasImage,
      question.hasAudio,
    ]);
  }
  return JSON.stringify([
    "v2",
    question.number,
    question.question,
    question.qType,
    question.random,
    question.timeLimit,
    question.answers,
    question.hasImage,
    question.hasAudio,
  ]);
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

function equalQuestionAnswers(
  left: readonly BlooketQuestionRead["answers"][number][],
  right: readonly BlooketQuestionRead["answers"][number][],
): boolean {
  return left.length === right.length
    && left.every((answer, index) => {
      const expected = right[index];
      return expected !== undefined
        && answer.kind === expected.kind
        && answer.content === expected.content
        && answer.correct === expected.correct
        && answer.match === expected.match;
    });
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
