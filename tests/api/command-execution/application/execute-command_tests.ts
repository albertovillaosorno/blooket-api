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
//   - Behavioral tests for canonical API command dispatch.
// - Must-Not:
//   - Parse CLI arguments or perform filesystem I/O.
// - Allows:
//   - Inputs: Fixed canonical command envelopes.
//   - Outputs: Deterministic result envelope verdicts.
//   - Side effects: None.
// - Split-When:
//   - Command families require independent dispatcher fixture suites.
// - Merge-When:
//   - Canonical command dispatch is removed.
// - Summary:
//   - Verifies media search, project validation, and unknown commands.
// - Description:
//   - Mirrors src/api/command-execution/application/execute-command.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unknown commands fail in the canonical result envelope.
//
import assert from "node:assert/strict";
import test from "node:test";

import { executeCommand } from
  "../../../../src/api/command-execution/application/execute-command.ts";

const mediaJsonl = [
  {
    id: "sun",
    path: "media/sun.avif",
    description: "A bright yellow sun in a clear blue sky.",
    english: true,
  },
  {
    id: "horse",
    path: "media/horse.webp",
    description: "A brown horse standing in a grassy field.",
    english: true,
  },
].map((record) => JSON.stringify(record)).join("\n") + "\n";

const projectJson = JSON.stringify({
  schemaVersion: 1,
  title: "Vocabulary",
  description: "Vocabulary review.",
  quizLanguage: "English",
  visibility: "private",
  mediaIndex: "media.jsonl",
  coverImage: { description: "A sun.", mediaId: "sun" },
  questions: [],
});

test("media.search returns deterministic matches", async () => {
  const result = await executeCommand({
    version: 1,
    operationId: "test:media-search",
    command: "media.search",
    payload: { mediaJsonl, query: "yellow sun" },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    const value = result.value as { matches: readonly unknown[] };
    assert.equal(value.matches.length, 1);
  }
});

test("project.validate composes all local project validators", async () => {
  const result = await executeCommand({
    version: 1,
    operationId: "test:project-validate",
    command: "project.validate",
    payload: { projectJson, mediaJsonl },
  });

  assert.deepEqual(result, {
    version: 1,
    operationId: "test:project-validate",
    ok: true,
    value: {
      title: "Vocabulary",
      visibility: "private",
      questionCount: 0,
      mediaCount: 2,
      unresolvedImageCount: 0,
    },
  });
});

test("unknown commands fail closed", async () => {
  const result = await executeCommand({
    version: 1,
    operationId: "test:unknown",
    command: "unknown.command",
    payload: {},
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.code, "unknown-command");
  }
});
