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
//   - Deterministic remote-neutral write plans from validated project bundles.
// - Must-Not:
//   - Call Blooket, choose remote IDs, inspect selectors, or resolve media.
// - Allows:
//   - Inputs: Untrusted project JSON and media JSON Lines text.
//   - Outputs: Immutable ordered plans or explicit validation/readiness
//     failures.
//   - Side effects: None.
// - Split-When:
//   - Set and question planning require independent schema lifecycles.
// - Merge-When:
//   - Blooket execution stops using explicit desired-state plans.
// - Summary:
//   - Lowers validated lesson state into deterministic idempotent operations.
// - Description:
//   - Hashes canonical input and strips descriptive media metadata from writes.
// - Usage:
//   - Build before remote execution and persist progress against the plan ID.
// - Defaults:
//   - Unresolved image requests fail before any plan can be executed.
//
import { createHash } from "node:crypto";

import {
  decodeBlooketCapabilitySnapshot,
} from "../../../ir/capability-snapshots/contract/blooket-capabilities.ts";
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  decodeProjectBundle,
} from "../../project-bundles/domain/project-bundle.ts";
import { validateProjectCapabilities } from
  "../../project-validation/domain/capabilities.ts";
import { countUnresolvedProjectImages } from
  "../../project-validation/domain/media-references.ts";
import { decodeProjectDocument, type ProjectDocument } from
  "../../project-documents/domain/project.ts";
import { decodePreparedMediaIdentities, type PreparedMediaIdentities } from
  "./prepared-media-identities.ts";
import type {
  MultipleChoiceQuestion,
  QuestionDocument,
  TypingAnswerQuestion,
} from "../../question-documents/domain/question.ts";

export const BLOOKET_WRITE_PLAN_VERSION = 1 as const;

export interface BlooketWritePlan {
  readonly schemaVersion: typeof BLOOKET_WRITE_PLAN_VERSION;
  readonly planId: string;
  readonly desiredStateSha256: string;
  readonly operations: readonly BlooketWriteOperation[];
}

export type BlooketWriteOperation =
  | BlooketSetOperation
  | BlooketQuestionOperation;

export interface BlooketSetOperation {
  readonly operationId: string;
  readonly kind: "set";
  readonly title: string;
  readonly description: string;
  readonly visibility: "public" | "private";
  readonly coverMediaId: string | null;
}

// The set-creation browser payload exposes these exact metadata fields.
// Covers are not a reliable identity signal from partial My Sets reads.
export function sameRemoteCreateSetMetadata(
  a: BlooketSetOperation,
  b: BlooketSetOperation,
): boolean {
  return a.title === b.title && a.description === b.description &&
    a.visibility === b.visibility;
}

export interface BlooketQuestionOperation {
  readonly operationId: string;
  readonly kind: "question";
  readonly localQuestionId: string;
  readonly questionNumber: number;
  readonly question: PlannedBlooketQuestion;
}

export type PlannedBlooketQuestion =
  | PlannedMultipleChoiceQuestion
  | PlannedTypingAnswerQuestion;

export interface PlannedMultipleChoiceQuestion {
  readonly type: "multiple-choice";
  readonly prompt: string;
  readonly timeLimitSeconds: number;
  readonly randomOrder: boolean;
  readonly imageMediaId: string | null;
  readonly answers: readonly PlannedMultipleChoiceAnswer[];
}

export interface PlannedMultipleChoiceAnswer {
  readonly text: string | null;
  readonly correct: boolean;
  readonly imageMediaId: string | null;
}

export interface PlannedTypingAnswerQuestion {
  readonly type: "typing-answer";
  readonly prompt: string;
  readonly timeLimitSeconds: number;
  readonly imageMediaId: string | null;
  readonly matchMode: "exact" | "contains";
  readonly answer: string;
}

export type BuildBlooketWritePlanResult =
  | {
      readonly ok: true;
      readonly value: BlooketWritePlan;
    }
  | {
      readonly ok: false;
      readonly kind: "invalid-project";
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly kind: "invalid-capabilities";
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly kind: "incompatible-capabilities";
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly kind: "unresolved-media";
      readonly count: number;
    };

export function buildBlooketWritePlan(
  projectJson: string,
  mediaJsonl: string,
  capabilities: unknown,
): BuildBlooketWritePlanResult {
  const decoded = decodeProjectBundle(projectJson, mediaJsonl);
  if (!decoded.ok) {
    return {
      ok: false,
      kind: "invalid-project",
      issues: decoded.issues,
    };
  }

  const decodedCapabilities = decodeBlooketCapabilitySnapshot(capabilities);
  if (!decodedCapabilities.ok) {
    return {
      ok: false,
      kind: "invalid-capabilities",
      issues: decodedCapabilities.issues,
    };
  }

  const capabilityIssues = validateProjectCapabilities(
    decoded.value.project,
    decodedCapabilities.value,
  );
  if (capabilityIssues.length > 0) {
    return {
      ok: false,
      kind: "incompatible-capabilities",
      issues: capabilityIssues,
    };
  }

  const unresolved = countUnresolvedProjectImages(
    decoded.value.project,
  );
  if (unresolved > 0) {
    return {
      ok: false,
      kind: "unresolved-media",
      count: unresolved,
    };
  }

  return {
    ok: true,
    value: lowerProject(decoded.value.project),
  };
}

// Durable publication needs stable IDs and admitted byte identities rather
// than descriptive JSONL records or fabricated filesystem locations.
export function buildPreparedBlooketWritePlan(
  project: unknown,
  expectedMedia: unknown,
  capabilities: unknown,
): BuildBlooketWritePlanResult {
  const decoded = decodeProjectDocument(project);
  if (!decoded.ok)
    return { ok: false, kind: "invalid-project", issues: decoded.issues };
  const media = decodePreparedMediaIdentities(expectedMedia);
  const references = [decoded.value.coverImage,
    ...decoded.value.questions.flatMap(question => [question.image,
      ...(question.type === "multiple-choice"
        ? question.answers.map(answer => answer.image) : []),
    ]),
  ].filter(image => image !== null);
  const unresolved = references.filter(image => image.mediaId === null).length;
  if (unresolved > 0)
    return { ok: false, kind: "unresolved-media", count: unresolved };
  const ids = new Set(references.map(image => image.mediaId!));
  if (!media || media.items.length !== ids.size ||
      media.items.some(item => !ids.has(item.mediaId)))
    return { ok: false, kind: "invalid-project", issues: [{
      path: "$.media", code: "prepared-media-identity-mismatch",
      message: "Expected exactly one prepared identity per referenced " +
        "media ID.",
    }] };
  const limits = decodeBlooketCapabilitySnapshot(capabilities);
  if (!limits.ok)
    return { ok: false, kind: "invalid-capabilities", issues: limits.issues };
  const issues = validateProjectCapabilities(decoded.value, limits.value);
  if (issues.length > 0)
    return { ok: false, kind: "incompatible-capabilities", issues };
  return { ok: true, value: lowerProject(decoded.value, media) };
}

function lowerProject(
  project: ProjectDocument,
  expectedMedia?: PreparedMediaIdentities,
): BlooketWritePlan {
  const desiredOperations = [
    {
      kind: "set" as const,
      title: project.title,
      description: project.description,
      visibility: project.visibility,
      coverMediaId: resolvedMediaId(project.coverImage),
    },
    ...project.questions.map((question, index) => ({
      kind: "question" as const,
      localQuestionId: question.id,
      questionNumber: index + 1,
      question: lowerQuestion(question),
    })),
  ];
  // Empty contexts preserve legacy text plan and operation identities.
  const identityState = expectedMedia && expectedMedia.items.length > 0
    ? ["prepared-media:v1", desiredOperations,
        [...expectedMedia.items].sort((a, b) =>
          a.mediaId < b.mediaId ? -1 : a.mediaId > b.mediaId ? 1 : 0)]
    : desiredOperations;
  const desiredStateSha256 = createHash("sha256")
    .update(JSON.stringify(identityState), "utf8")
    .digest("hex");
  const planId = "plan:" + desiredStateSha256;
  const operations: BlooketWriteOperation[] = desiredOperations.map(
    (operation, index) => {
      if (operation.kind === "set") {
        return {
          ...operation,
          operationId: planId + ":set",
        };
      }
      return {
        ...operation,
        operationId: planId + ":q:" + String(index - 1),
      };
    },
  );

  return {
    schemaVersion: BLOOKET_WRITE_PLAN_VERSION,
    planId,
    desiredStateSha256,
    operations,
  };
}

function lowerQuestion(
  question: QuestionDocument,
): PlannedBlooketQuestion {
  return question.type === "multiple-choice"
    ? lowerMultipleChoice(question)
    : lowerTypingAnswer(question);
}

function lowerMultipleChoice(
  question: MultipleChoiceQuestion,
): PlannedMultipleChoiceQuestion {
  return {
    type: "multiple-choice",
    prompt: question.prompt,
    timeLimitSeconds: question.timeLimitSeconds,
    randomOrder: question.randomOrder,
    imageMediaId: resolvedMediaId(question.image),
    answers: question.answers.map((answer) => ({
      text: answer.text,
      correct: answer.correct,
      imageMediaId: resolvedMediaId(answer.image),
    })),
  };
}

function lowerTypingAnswer(
  question: TypingAnswerQuestion,
): PlannedTypingAnswerQuestion {
  return {
    type: "typing-answer",
    prompt: question.prompt,
    timeLimitSeconds: question.timeLimitSeconds,
    imageMediaId: resolvedMediaId(question.image),
    matchMode: question.matchMode,
    answer: question.answer,
  };
}

function resolvedMediaId(
  image: { readonly mediaId: string | null } | null,
): string | null {
  if (image === null) {
    return null;
  }
  if (image.mediaId === null) {
    throw new Error("Write-plan invariant: unresolved media.");
  }
  return image.mediaId;
}
