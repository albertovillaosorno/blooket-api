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
//   - Behavioral tests for project JSON syntax parsing.
// - Must-Not:
//   - Test unrelated project schemas or Blooket behavior.
// - Allows:
//   - Inputs: Fixed JSON syntax fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Another parser contract gains independent fixtures.
// - Merge-When:
//   - JSON syntax parsing no longer exists as a separate project boundary.
// - Summary:
//   - Verifies valid parsing and fail-closed malformed JSON behavior.
// - Description:
//   - Mirrors src/projects/parser/domain/json.ts exactly.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Tests never repair invalid JSON.
//
import assert from "node:assert/strict";
import test from "node:test";

import { parseJson } from "../../../../src/projects/parser/domain/json.ts";

test("parseJson preserves valid JSON values", () => {
  const result = parseJson("{\"title\":\"Lesson 5\",\"questions\":[]}");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, { title: "Lesson 5", questions: [] });
  }
});

test("parseJson rejects malformed JSON without repair", () => {
  const result = parseJson("{\"title\":");

  assert.equal(result.ok, false);
});
