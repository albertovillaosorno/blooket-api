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
//   - Version-one local lesson project document structure.
// - Must-Not:
//   - Resolve media files, authenticate users, or perform Blooket writes.
// - Allows:
//   - Inputs: Unknown runtime project-document candidates.
//   - Outputs: Strict local project documents or validation failures.
//   - Side effects: None.
// - Split-When:
//   - A new project schema version requires independent migration behavior.
// - Merge-When:
//   - Lesson projects stop being persisted as versioned local documents.
// - Summary:
//   - Defines the canonical project.json version-one contract.
// - Description:
//   - Binds set metadata, media index, cover image, and validated questions.
// - Usage:
//   - Decode model or disk input before persistence or write-plan creation.
// - Defaults:
//   - Media metadata lives in media.jsonl and question IDs are unique.
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
import {
  decodeQuestionDocument,
  type QuestionDocument,
} from "../../question-documents/domain/question.ts";

export const PROJECT_SCHEMA_VERSION = 1 as const;
export const PROJECT_MEDIA_INDEX = "media.jsonl" as const;

export interface ProjectDocument {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly title: string;
  readonly description: string;
  readonly quizLanguage: string;
  readonly visibility: "public" | "private";
  readonly mediaIndex: typeof PROJECT_MEDIA_INDEX;
  readonly coverImage: ImageRequest | null;
  readonly questions: readonly QuestionDocument[];
}

const PROJECT_KEYS = new Set([
  "schemaVersion",
  "title",
  "description",
  "quizLanguage",
  "visibility",
  "mediaIndex",
  "coverImage",
  "questions",
]);

export function decodeProjectDocument(
  value: unknown,
): DecodeResult<ProjectDocument> {
  if (!isRecord(value)) {
    return decodeFailure("$", "expected-object", "Expected a project object.");
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, PROJECT_KEYS, "$"),
  ];
  const title = requiredString(value["title"], "$.title", issues);
  const description = requiredString(
    value["description"],
    "$.description",
    issues,
  );
  const quizLanguage = requiredString(
    value["quizLanguage"],
    "$.quizLanguage",
    issues,
  );
  const visibility = value["visibility"];
  const coverImage = decodeCoverImage(value["coverImage"], issues);
  const questions = decodeQuestions(value["questions"], issues);

  if (value["schemaVersion"] !== PROJECT_SCHEMA_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected project schema version 1.",
    });
  }

  if (visibility !== "public" && visibility !== "private") {
    issues.push({
      path: "$.visibility",
      code: "invalid-visibility",
      message: 'Expected "public" or "private".',
    });
  }

  if (value["mediaIndex"] !== PROJECT_MEDIA_INDEX) {
    issues.push({
      path: "$.mediaIndex",
      code: "invalid-media-index",
      message: `Expected ${PROJECT_MEDIA_INDEX}.`,
    });
  }

  if (questions !== undefined) {
    const duplicates = duplicateQuestionIds(questions);
    for (const id of duplicates) {
      issues.push({
        path: "$.questions",
        code: "duplicate-question-id",
        message: `Question ID ${id} appears more than once.`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (
    title === undefined
    || description === undefined
    || quizLanguage === undefined
    || (visibility !== "public" && visibility !== "private")
    || coverImage === undefined
    || questions === undefined
  ) {
    return decodeFailure("$", "decoder-invariant", "Decoder invariant failed.");
  }

  return {
    ok: true,
    value: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      title,
      description,
      quizLanguage,
      visibility,
      mediaIndex: PROJECT_MEDIA_INDEX,
      coverImage,
      questions,
    },
  };
}

function decodeCoverImage(
  value: unknown,
  issues: ValidationIssue[],
): ImageRequest | null | undefined {
  if (value === null) {
    return null;
  }

  const decoded = decodeImageRequest(value, "$.coverImage");
  if (!decoded.ok) {
    issues.push(...decoded.issues);
    return undefined;
  }
  return decoded.value;
}

function decodeQuestions(
  value: unknown,
  issues: ValidationIssue[],
): readonly QuestionDocument[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({
      path: "$.questions",
      code: "expected-array",
      message: "Expected a question array.",
    });
    return undefined;
  }

  const questions: QuestionDocument[] = [];
  for (const [index, candidate] of value.entries()) {
    const decoded = decodeQuestionDocument(candidate, `$.questions[${index}]`);
    if (!decoded.ok) {
      issues.push(...decoded.issues);
      continue;
    }
    questions.push(decoded.value);
  }
  return questions;
}

function duplicateQuestionIds(
  questions: readonly QuestionDocument[],
): readonly string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.id)) {
      duplicate.add(question.id);
    }
    seen.add(question.id);
  }
  return [...duplicate].sort();
}
