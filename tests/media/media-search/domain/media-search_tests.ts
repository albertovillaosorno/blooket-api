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
//   - Behavioral tests for deterministic field-aware media search.
// - Must-Not:
//   - Read JSONL files or invoke external search processes.
// - Allows:
//   - Inputs: Fixed decoded media records and search requests.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Regex and literal modes gain independent fixture suites.
// - Merge-When:
//   - Field-aware media search is removed.
// - Summary:
//   - Verifies default description search and explicit field selection.
// - Description:
//   - Mirrors src/media/media-search/domain/media-search.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Path and ID fields do not match unless explicitly requested.
//
import assert from "node:assert/strict";
import test from "node:test";

import { searchMedia } from
  "../../../../src/media/media-search/domain/media-search.ts";

const records = [
  {
    id: "sun",
    path: "media/sun.avif",
    description: "A bright yellow sun in a clear blue sky.",
    english: true,
  },
  {
    id: "stage-lm",
    path: "media/luis-miguel.gif",
    description: "Luis Miguel singing on a concert stage.",
    english: false,
  },
] as const;

test("search defaults to case-insensitive descriptions", () => {
  const result = searchMedia(records, { query: "YELLOW SUN" });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.map((match) => match.media.id), ["sun"]);
    assert.deepEqual(result.value[0]?.matchedFields, ["description"]);
  }
});

test("description search does not accidentally match file paths", () => {
  const result = searchMedia(records, { query: "luis-miguel" });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 0);
  }
});

test("callers may explicitly search multiple fields", () => {
  const result = searchMedia(records, {
    query: "luis-miguel",
    fields: ["id", "path", "description"],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value[0]?.matchedFields, ["path"]);
  }
});

test("regex mode is explicit and returns invalid patterns safely", () => {
  const valid = searchMedia(records, {
    query: "bright.*sun",
    mode: "regex",
  });
  const invalid = searchMedia(records, { query: "[", mode: "regex" });

  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
});

test("search respects deterministic result limits", () => {
  const result = searchMedia(records, {
    query: "a",
    fields: ["description"],
    limit: 1,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.map((match) => match.media.id), ["sun"]);
  }
});

test("search rejects duplicate field selectors", () => {
  const result = searchMedia(records, {
    query: "sun",
    fields: ["description", "description"],
  });

  assert.equal(result.ok, false);
});
