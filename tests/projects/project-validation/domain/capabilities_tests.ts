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
//   - Behavioral tests for fail-closed project capability validation.
// - Must-Not:
//   - Probe Blooket or invent account capability facts.
// - Allows:
//   - Inputs: Fixed decoded project and capability fixtures.
//   - Outputs: Deterministic compatibility issues.
//   - Side effects: None.
// - Split-When:
//   - Feature families need separate compatibility suites.
// - Merge-When:
//   - Capability-bound project validation is removed.
// - Summary:
//   - Proves unknown/account-dependent features remain blocked.
// - Description:
//   - Mirrors src/projects/project-validation/domain/capabilities.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Only explicit supported availability admits optional features.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBlooketCapabilitySnapshot,
  type BlooketCapabilitySnapshot,
} from
  "../../../../src/ir/capability-snapshots/contract/blooket-capabilities.ts";
// jig-ignore-next-line: JSON import attributes cannot be line-wrapped.
import officialCapabilities from "../../../ir/capability-snapshots/contract/blooket-official-2026-10-05.json" with { type: "json" };
import { decodeProjectDocument } from
  "../../../../src/projects/project-documents/domain/project.ts";
import { validateProjectCapabilities } from
  "../../../../src/projects/project-validation/domain/capabilities.ts";

const capabilities: BlooketCapabilitySnapshot = {
  schemaVersion: 3,
  verifiedOn: "2026-10-05",
  evidence: [{ kind: "browser-observation", reference: "fixture" }],
  questionTypes: {
    multipleChoice: {
      availability: "supported",
      minAnswers: 2,
      maxAnswers: 4,
      requiresQuestionText: true,
      allowsMultipleCorrect: true,
    },
    typingAnswer: {
      availability: "supported",
      matchModes: ["exact", "contains"],
    },
  },
  features: {
    questionImages: "supported",
    answerImages: "supported",
    audio: "unknown",
  },
  setMetadata: {
    titleRequired: true,
    descriptionRequired: false,
    titleMaxLength: 75,
    descriptionMaxLength: 300,
    coverImageOptional: true,
    visibility: ["public", "private"],
  },
  upload: {
    maxBytes: null,
    canvasWidth: null,
    canvasHeight: null,
    maxPixels: null,
  },
};

function decodedProject() {
  const result = decodeProjectDocument({
    schemaVersion: 1,
    title: "Science",
    description: "Review.",
    quizLanguage: "English",
    visibility: "private",
    mediaIndex: "media.jsonl",
    coverImage: null,
    questions: [{
      id: "q1",
      type: "multiple-choice",
      prompt: "Pick one.",
      timeLimitSeconds: 20,
      randomOrder: false,
      image: { description: "Question.", mediaId: "question-image" },
      answers: [
        {
          text: null,
          correct: true,
          image: { description: "Answer.", mediaId: "answer-image" },
        },
        { text: "B", correct: false, image: null },
      ],
    }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Fixture project failed.");
  }
  return result.value;
}

test("explicit supported capabilities admit the project", () => {
  assert.deepEqual(
    validateProjectCapabilities(decodedProject(), capabilities),
    [],
  );
});

test("dated official evidence blocks account-dependent answer images", () => {
  const decoded = decodeBlooketCapabilitySnapshot(officialCapabilities);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) {
    return;
  }

  const issues = validateProjectCapabilities(
    decodedProject(),
    decoded.value,
  );
  assert.equal(
    issues.some((issue) => issue.code === "capability-not-supported"),
    true,
  );
});

test("dated official evidence admits projects not using answer images", () => {
  const decoded = decodeBlooketCapabilitySnapshot(officialCapabilities);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) {
    return;
  }

  const project = decodedProject();
  const withoutAnswerImages = {
    ...project,
    questions: project.questions.map((question) => {
      if (question.type !== "multiple-choice") {
        return question;
      }
      return {
        ...question,
        answers: question.answers.map((answer) => ({
          ...answer,
          image: null,
        })),
      };
    }),
  };
  assert.deepEqual(
    validateProjectCapabilities(withoutAnswerImages, decoded.value),
    [],
  );
});

test("verified metadata length limits are enforced exactly", () => {
  const base = decodedProject();
  const exact = {
    ...base,
    title: "t".repeat(75),
    description: "d".repeat(300),
  };
  assert.deepEqual(
    validateProjectCapabilities(exact, capabilities),
    [],
  );

  const tooLong = validateProjectCapabilities({
    ...exact,
    title: "t".repeat(76),
    description: "d".repeat(301),
  }, capabilities);
  assert.equal(
    tooLong.some((issue) => issue.code === "title-too-long"),
    true,
  );
  assert.equal(
    tooLong.some((issue) => issue.code === "description-too-long"),
    true,
  );
});

test("unknown metadata length limits fail closed", () => {
  const issues = validateProjectCapabilities(decodedProject(), {
    ...capabilities,
    setMetadata: {
      ...capabilities.setMetadata,
      titleMaxLength: null,
      descriptionMaxLength: null,
    },
  });
  assert.equal(
    issues.some((issue) => issue.code === "unknown-title-max-length"),
    true,
  );
  assert.equal(
    issues.some(
      (issue) => issue.code === "unknown-description-max-length",
    ),
    true,
  );
});

test("empty descriptions require verified optionality", () => {
  const project = { ...decodedProject(), description: "" };
  assert.deepEqual(
    validateProjectCapabilities(project, capabilities),
    [],
  );

  const required = validateProjectCapabilities(project, {
    ...capabilities,
    setMetadata: {
      ...capabilities.setMetadata,
      descriptionRequired: true,
    },
  });
  assert.equal(
    required.some((issue) => issue.code === "description-required"),
    true,
  );

  const unknown = validateProjectCapabilities(project, {
    ...capabilities,
    setMetadata: {
      ...capabilities.setMetadata,
      descriptionRequired: null,
    },
  });
  assert.equal(
    unknown.some(
      (issue) => issue.code === "unknown-description-requirement",
    ),
    true,
  );
});

test("account-dependent answer images fail closed", () => {
  const issues = validateProjectCapabilities(
    decodedProject(),
    {
      ...capabilities,
      features: {
        ...capabilities.features,
        answerImages: "account-dependent",
      },
    },
  );
  assert.equal(
    issues.some((issue) => issue.code === "capability-not-supported"),
    true,
  );
});

test("unknown answer bounds block multiple-choice planning", () => {
  const issues = validateProjectCapabilities(
    decodedProject(),
    {
      ...capabilities,
      questionTypes: {
        ...capabilities.questionTypes,
        multipleChoice: {
          ...capabilities.questionTypes.multipleChoice,
          minAnswers: null,
        },
      },
    },
  );
  assert.equal(
    issues.some((issue) => issue.code === "unknown-answer-bounds"),
    true,
  );
});

test("unverified multiple-correct behavior fails only when used", () => {
  const project = decodedProject();
  const oneCorrect = validateProjectCapabilities(project, {
    ...capabilities,
    questionTypes: {
      ...capabilities.questionTypes,
      multipleChoice: {
        ...capabilities.questionTypes.multipleChoice,
        allowsMultipleCorrect: null,
      },
    },
  });
  assert.equal(
    oneCorrect.some(
      (issue) => issue.code === "multiple-correct-not-verified",
    ),
    false,
  );

  const multi = {
    ...project,
    questions: [{
      ...project.questions[0],
      type: "multiple-choice" as const,
      answers: project.questions[0]?.type === "multiple-choice"
        ? project.questions[0].answers.map((answer) => ({
            ...answer,
            correct: true,
          }))
        : [],
    }],
  };
  const issues = validateProjectCapabilities(multi, {
    ...capabilities,
    questionTypes: {
      ...capabilities.questionTypes,
      multipleChoice: {
        ...capabilities.questionTypes.multipleChoice,
        allowsMultipleCorrect: null,
      },
    },
  });
  assert.equal(
    issues.some(
      (issue) => issue.code === "multiple-correct-not-verified",
    ),
    true,
  );
});

test("unknown cover optionality blocks omission", () => {
  const issues = validateProjectCapabilities(decodedProject(), {
    ...capabilities,
    setMetadata: {
      ...capabilities.setMetadata,
      coverImageOptional: null,
    },
  });
  assert.equal(
    issues.some(
      (issue) => issue.code === "unknown-or-required-cover-image",
    ),
    true,
  );
});
