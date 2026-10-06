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
//   - Behavioral tests for the version-one project.json contract.
// - Must-Not:
//   - Persist files or test remote Blooket behavior.
// - Allows:
//   - Inputs: Fixed project document fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Project schema versions need separate migration fixtures.
// - Merge-When:
//   - project.json is removed as a local authority.
// - Summary:
//   - Verifies exact project metadata and nested question validation.
// - Description:
//   - Mirrors src/projects/project-documents/domain/project.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - media.jsonl is the canonical project media metadata index.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeProjectDocument } from
  "../../../../src/projects/project-documents/domain/project.ts";

const question = {
  id: "q1",
  type: "multiple-choice",
  prompt: "Which word means sol?",
  timeLimitSeconds: 20,
  randomOrder: true,
  image: null,
  answers: [
    { text: "Sun", correct: true, image: null },
    { text: "Son", correct: false, image: null },
  ],
};

const project = {
  schemaVersion: 1,
  title: "Spanish Vocabulary",
  description: "Spanish to English vocabulary practice.",
  quizLanguage: "English",
  visibility: "private",
  mediaIndex: "media.jsonl",
  coverImage: null,
  questions: [question],
};

test("project documents accept the exact version-one contract", () => {
  assert.equal(decodeProjectDocument(project).ok, true);
});

test("project descriptions may be empty local metadata", () => {
  const result = decodeProjectDocument({
    ...project,
    description: "",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.description, "");
  }
});

test("project documents may start with no questions", () => {
  assert.equal(
    decodeProjectDocument({ ...project, questions: [] }).ok,
    true,
  );
});

test("project documents reject unknown top-level fields", () => {
  const result = decodeProjectDocument({ ...project, sourceUrl: "nope" });

  assert.equal(result.ok, false);
});

test("project documents reject unsupported schema versions", () => {
  const result = decodeProjectDocument({ ...project, schemaVersion: 2 });

  assert.equal(result.ok, false);
});

test("project documents reject duplicate question IDs", () => {
  const result = decodeProjectDocument({
    ...project,
    questions: [question, { ...question }],
  });

  assert.equal(result.ok, false);
});

test("project documents require the canonical media index", () => {
  const result = decodeProjectDocument({
    ...project,
    mediaIndex: "images.jsonl",
  });

  assert.equal(result.ok, false);
});
