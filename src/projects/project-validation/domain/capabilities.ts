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
//   - Fail-closed project compatibility with verified Blooket capabilities.
// - Must-Not:
//   - Probe accounts, guess unknown facts, or perform remote writes.
// - Allows:
//   - Inputs: Decoded project documents and capability snapshots.
//   - Outputs: Structured compatibility issues.
//   - Side effects: None.
// - Split-When:
//   - Account and platform capability lifecycles become independent.
// - Merge-When:
//   - Projects stop targeting capability-dependent Blooket features.
// - Summary:
//   - Blocks project features not explicitly admitted by verified evidence.
// - Description:
//   - Checks question types, images, answer bounds, matching, and visibility.
// - Usage:
//   - Run after project decoding and before write-plan construction.
// - Defaults:
//   - Unknown and account-dependent facts do not count as supported.
//
import type {
  BlooketCapabilitySnapshot,
  CapabilityAvailability,
} from "../../../ir/capability-snapshots/contract/blooket-capabilities.ts";
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import type { ProjectDocument } from
  "../../project-documents/domain/project.ts";

export function validateProjectCapabilities(
  project: ProjectDocument,
  capabilities: BlooketCapabilitySnapshot,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!capabilities.setMetadata.visibility.includes(project.visibility)) {
    issues.push({
      path: "$.visibility",
      code: "unsupported-visibility",
      message: "Project visibility is not admitted by verified capabilities.",
    });
  }
  validateMetadataLength(
    project.title,
    capabilities.setMetadata.titleMaxLength,
    "$.title",
    "title",
    issues,
  );
  validateMetadataLength(
    project.description,
    capabilities.setMetadata.descriptionMaxLength,
    "$.description",
    "description",
    issues,
  );
  if (project.description.length === 0) {
    if (capabilities.setMetadata.descriptionRequired === true) {
      issues.push({
        path: "$.description",
        code: "description-required",
        message: "Verified capabilities require a set description.",
      });
    } else if (capabilities.setMetadata.descriptionRequired === null) {
      issues.push({
        path: "$.description",
        code: "unknown-description-requirement",
        message: "Description optionality must be verified when omitted.",
      });
    }
  }
  if (
    project.coverImage === null
    && capabilities.setMetadata.coverImageOptional !== true
  ) {
    issues.push({
      path: "$.coverImage",
      code: "unknown-or-required-cover-image",
      message: "Verified capabilities do not establish that cover image "
        + "is optional.",
    });
  }

  for (const [index, question] of project.questions.entries()) {
    const path = "$.questions[" + String(index) + "]";
    if (question.type === "multiple-choice") {
      const limits = capabilities.questionTypes.multipleChoice;
      requireSupported(limits.availability, path + ".type", issues);
      if (limits.minAnswers === null || limits.maxAnswers === null) {
        issues.push({
          path: path + ".answers",
          code: "unknown-answer-bounds",
          message: "Verified answer-count bounds are required.",
        });
      } else if (
        question.answers.length < limits.minAnswers
        || question.answers.length > limits.maxAnswers
      ) {
        issues.push({
          path: path + ".answers",
          code: "unsupported-answer-count",
          message: "Answer count is outside verified Blooket bounds.",
        });
      }

      const correctCount = question.answers.filter(
        (answer) => answer.correct,
      ).length;
      if (
        correctCount > 1
        && limits.allowsMultipleCorrect !== true
      ) {
        issues.push({
          path: path + ".answers",
          code: "multiple-correct-not-verified",
          message: "Multiple correct answers are not explicitly supported.",
        });
      }
      if (question.image !== null) {
        requireSupported(
          capabilities.features.questionImages,
          path + ".image",
          issues,
        );
      }
      for (const [answerIndex, answer] of question.answers.entries()) {
        if (answer.image !== null) {
          requireSupported(
            capabilities.features.answerImages,
            path + ".answers[" + String(answerIndex) + "].image",
            issues,
          );
        }
      }
      continue;
    }

    const typing = capabilities.questionTypes.typingAnswer;
    requireSupported(typing.availability, path + ".type", issues);
    if (!typing.matchModes.includes(question.matchMode)) {
      issues.push({
        path: path + ".matchMode",
        code: "unsupported-match-mode",
        message: "Typing match mode is not admitted by verified capabilities.",
      });
    }
    if (question.image !== null) {
      requireSupported(
        capabilities.features.questionImages,
        path + ".image",
        issues,
      );
    }
  }

  return issues;
}

function validateMetadataLength(
  value: string,
  maxLength: number | null,
  path: string,
  field: "title" | "description",
  issues: ValidationIssue[],
): void {
  if (maxLength === null) {
    issues.push({
      path,
      code: "unknown-" + field + "-max-length",
      message: "Verified metadata length limit is required.",
    });
    return;
  }
  if (value.length > maxLength) {
    issues.push({
      path,
      code: field + "-too-long",
      message: "Metadata exceeds the verified Blooket length limit.",
    });
  }
}

function requireSupported(
  availability: CapabilityAvailability,
  path: string,
  issues: ValidationIssue[],
): void {
  if (availability === "supported") {
    return;
  }
  issues.push({
    path,
    code: "capability-not-supported",
    message: "Feature is not explicitly supported by verified capabilities.",
  });
}
