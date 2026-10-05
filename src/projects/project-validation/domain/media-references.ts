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
//   - Cross-document validation of project image references against media data.
// - Must-Not:
//   - Read files, select replacement images, or reject unresolved null
//     requests.
// - Allows:
//   - Inputs: Decoded project documents and decoded media records.
//   - Outputs: Structured missing-reference issues and unresolved-image counts.
//   - Side effects: None.
// - Split-When:
//   - Non-image project references gain independent validation semantics.
// - Merge-When:
//   - Projects no longer refer to media through stable IDs.
// - Summary:
//   - Ensures every resolved project media ID exists in media.jsonl.
// - Description:
//   - Traverses cover, question, and multiple-choice answer image requests.
// - Usage:
//   - Run after project.json and media.jsonl have each decoded successfully.
// - Defaults:
//   - Null media IDs are counted as unresolved but are not validation errors.
//
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import type { MediaRecord } from
  "../../../media/media-records/domain/media-record.ts";
import type { ImageRequest } from
  "../../image-requests/domain/image-request.ts";
import type { ProjectDocument } from
  "../../project-documents/domain/project.ts";

export function validateProjectMediaReferences(
  project: ProjectDocument,
  media: readonly MediaRecord[],
): readonly ValidationIssue[] {
  const knownIds = new Set(media.map((record) => record.id));
  const issues: ValidationIssue[] = [];

  validateImage(project.coverImage, "$.coverImage", knownIds, issues);
  for (const [questionIndex, question] of project.questions.entries()) {
    const questionPath = `$.questions[${questionIndex}]`;
    validateImage(question.image, `${questionPath}.image`, knownIds, issues);

    if (question.type !== "multiple-choice") {
      continue;
    }
    for (const [answerIndex, answer] of question.answers.entries()) {
      validateImage(
        answer.image,
        `${questionPath}.answers[${answerIndex}].image`,
        knownIds,
        issues,
      );
    }
  }

  return issues;
}

export function countUnresolvedProjectImages(project: ProjectDocument): number {
  let count = isUnresolved(project.coverImage) ? 1 : 0;
  for (const question of project.questions) {
    if (isUnresolved(question.image)) {
      count += 1;
    }
    if (question.type === "multiple-choice") {
      for (const answer of question.answers) {
        if (isUnresolved(answer.image)) {
          count += 1;
        }
      }
    }
  }
  return count;
}

function validateImage(
  image: ImageRequest | null,
  path: string,
  knownIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (image === null || image.mediaId === null || knownIds.has(image.mediaId)) {
    return;
  }

  issues.push({
    path: `${path}.mediaId`,
    code: "missing-media-reference",
    message: `Media ID ${image.mediaId} is not present in media.jsonl.`,
  });
}

function isUnresolved(image: ImageRequest | null): boolean {
  return image !== null && image.mediaId === null;
}
