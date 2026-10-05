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
//   - Behavioral tests for project-to-media reference validation.
// - Must-Not:
//   - Read project files or search for replacement media.
// - Allows:
//   - Inputs: Fixed decoded project and media fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Reference validation variants need separate fixtures.
// - Merge-When:
//   - Project media references are removed.
// - Summary:
//   - Verifies missing references and unresolved image counting.
// - Description:
//   - Mirrors src/projects/project-validation/domain/media-references.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unresolved image requests are valid local draft state.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  countUnresolvedProjectImages,
  validateProjectMediaReferences,
} from
  "../../../../src/projects/project-validation/domain/media-references.ts";
import type { ProjectDocument } from
  "../../../../src/projects/project-documents/domain/project.ts";

const project: ProjectDocument = {
  schemaVersion: 1,
  title: "Vocabulary",
  description: "Vocabulary review.",
  quizLanguage: "English",
  visibility: "private",
  mediaIndex: "media.jsonl",
  coverImage: {
    description: "A bright yellow sun.",
    mediaId: "sun",
  },
  questions: [
    {
      id: "q1",
      type: "multiple-choice",
      prompt: "Which image shows a horse?",
      timeLimitSeconds: 20,
      randomOrder: true,
      image: {
        description: "A field with a horse.",
        mediaId: null,
      },
      answers: [
        {
          text: "Horse",
          correct: true,
          image: {
            description: "A brown horse.",
            mediaId: "horse",
          },
        },
        { text: "Sun", correct: false, image: null },
      ],
    },
  ],
};

const media = [
  {
    id: "sun",
    path: "media/sun.avif",
    description: "A bright yellow sun.",
    english: true,
  },
  {
    id: "horse",
    path: "media/horse.webp",
    description: "A brown horse.",
    english: true,
  },
] as const;

test("resolved project media IDs must exist in the index", () => {
  assert.deepEqual(validateProjectMediaReferences(project, media), []);
});

test("missing media IDs report their exact project path", () => {
  const withoutHorse = media.filter((record) => record.id !== "horse");
  const issues = validateProjectMediaReferences(project, withoutHorse);

  assert.deepEqual(issues, [
    {
      path: "$.questions[0].answers[0].image.mediaId",
      code: "missing-media-reference",
      message: "Media ID horse is not present in media.jsonl.",
    },
  ]);
});

test("unresolved image requests remain valid and are countable", () => {
  assert.equal(validateProjectMediaReferences(project, media).length, 0);
  assert.equal(countUnresolvedProjectImages(project), 1);
});
