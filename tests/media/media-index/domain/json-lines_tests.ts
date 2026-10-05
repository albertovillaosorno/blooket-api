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
//   - Behavioral tests for canonical media JSON Lines persistence.
// - Must-Not:
//   - Read files or test media search semantics.
// - Allows:
//   - Inputs: Fixed JSONL text and validated media records.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Streaming JSONL behavior gains independent fixtures.
// - Merge-When:
//   - media.jsonl persistence is removed.
// - Summary:
//   - Verifies line-local failures, uniqueness, and stable serialization.
// - Description:
//   - Mirrors src/media/media-index/domain/json-lines.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Empty indexes serialize to an empty file.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeMediaJsonLines,
  serializeMediaJsonLines,
} from "../../../../src/media/media-index/domain/json-lines.ts";

const sun = {
  id: "sun",
  path: "media/sun.avif",
  description: "A bright yellow sun in a clear blue sky.",
  english: true,
};
const horse = {
  id: "horse",
  path: "media/horse.webp",
  description: "A brown horse standing in a grassy field.",
  english: false,
};

test("empty media indexes are valid", () => {
  assert.deepEqual(decodeMediaJsonLines(""), { ok: true, value: [] });
  assert.equal(serializeMediaJsonLines([]), "");
});

test("JSONL decoding validates every media record", () => {
  const source = `${JSON.stringify(sun)}\n${JSON.stringify(horse)}\n`;
  const result = decodeMediaJsonLines(source);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, [sun, horse]);
  }
});

test("syntax failures identify the exact JSONL line", () => {
  const result = decodeMediaJsonLines(`${JSON.stringify(sun)}\n{"id":\n`);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.path, "$.lines[2]");
  }
});

test("semantic failures are rebased to the exact JSONL line", () => {
  const invalid = { ...horse, english: "yes" };
  const result = decodeMediaJsonLines(
    `${JSON.stringify(sun)}\n${JSON.stringify(invalid)}\n`,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.path, "$.lines[2].english");
  }
});

test("JSONL decoding rejects duplicate IDs and paths", () => {
  const duplicate = { ...horse, id: sun.id, path: sun.path };
  const result = decodeMediaJsonLines(
    `${JSON.stringify(sun)}\n${JSON.stringify(duplicate)}\n`,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(
      result.issues.map((issue) => issue.code),
      ["duplicate-media-id", "duplicate-media-path"],
    );
  }
});

test("JSONL decoding rejects internal blank lines", () => {
  const result = decodeMediaJsonLines(
    `${JSON.stringify(sun)}\n\n${JSON.stringify(horse)}\n`,
  );

  assert.equal(result.ok, false);
});

test("serialization emits stable field order and one final newline", () => {
  const serialized = serializeMediaJsonLines([sun]);

  assert.equal(
    serialized,
    '{"id":"sun","path":"media/sun.avif",'
      + '"description":"A bright yellow sun in a clear blue sky.",'
      + '"english":true}\n',
  );
});
