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
//   - Behavioral tests for cross-file project bundle validation.
// - Must-Not:
//   - Read directories or test filesystem replacement behavior.
// - Allows:
//   - Inputs: Fixed project JSON and media JSON Lines fixtures.
//   - Outputs: Deterministic bundle and canonical serialization verdicts.
//   - Side effects: None.
// - Split-When:
//   - Bundle schema migrations need independent fixture suites.
// - Merge-When:
//   - Project bundles cease to span two persisted documents.
// - Summary:
//   - Verifies validation paths, media references, and stable serialization.
// - Description:
//   - Mirrors src/projects/project-bundles/domain/project-bundle.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Serialized project JSON ends in one newline.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeProjectBundle,
  serializeProjectBundle,
} from "../../../../src/projects/project-bundles/domain/project-bundle.ts";

const project = {
  schemaVersion: 1,
  title: "Vocabulary",
  description: "Vocabulary review.",
  quizLanguage: "English",
  visibility: "private",
  mediaIndex: "media.jsonl",
  coverImage: { description: "A sun.", mediaId: "sun" },
  questions: [],
};
const media = {
  id: "sun",
  path: "media/sun.avif",
  description: "A bright yellow sun.",
  english: true,
};
const projectJson = JSON.stringify(project);
const mediaJsonl = `${JSON.stringify(media)}\n`;

test("project bundles validate both persisted documents together", () => {
  const result = decodeProjectBundle(projectJson, mediaJsonl);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.project.title, "Vocabulary");
    assert.deepEqual(result.value.media, [media]);
  }
});

test("project bundle failures distinguish project and media paths", () => {
  const invalidProject = decodeProjectBundle("{", mediaJsonl);
  const invalidMedia = decodeProjectBundle(projectJson, "{\"id\":\n");

  assert.equal(invalidProject.ok, false);
  assert.equal(invalidMedia.ok, false);
  if (!invalidProject.ok && !invalidMedia.ok) {
    assert.equal(invalidProject.issues[0]?.path, "$.project");
    assert.equal(invalidMedia.issues[0]?.path, "$.media.lines[1]");
  }
});

test("missing media references are rebased beneath project", () => {
  const result = decodeProjectBundle(projectJson, "");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.path, "$.project.coverImage.mediaId");
    assert.equal(result.issues[0]?.code, "missing-media-reference");
  }
});

test("canonical bundle serialization round trips", () => {
  const decoded = decodeProjectBundle(projectJson, mediaJsonl);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) {
    return;
  }

  const serialized = serializeProjectBundle(decoded.value);
  assert.equal(serialized.projectJson.endsWith("\n"), true);
  assert.equal(serialized.mediaJsonl.endsWith("\n"), true);
  assert.equal(
    decodeProjectBundle(serialized.projectJson, serialized.mediaJsonl).ok,
    true,
  );
});
