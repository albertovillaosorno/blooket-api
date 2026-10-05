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
//   - Inputs: Fixed legacy/current JSONL text and validated media records.
//   - Outputs: Deterministic migration, uniqueness, and serialization verdicts.
//   - Side effects: None.
// - Split-When:
//   - Streaming JSONL behavior gains independent fixtures.
// - Merge-When:
//   - media.jsonl persistence is removed.
// - Summary:
//   - Verifies line-local failures and canonical version-two serialization.
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

test("JSONL decoding migrates legacy records to display names", () => {
  const source = JSON.stringify(sun)
    + "\n"
    + JSON.stringify(horse)
    + "\n";
  const result = decodeMediaJsonLines(source);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, [
      { ...sun, name: "sun" },
      { ...horse, name: "horse" },
    ]);
  }
});

test("JSONL decoding accepts version-two display names", () => {
  const current = {
    schemaVersion: 2,
    ...sun,
    name: "Bright Sun",
  };
  assert.deepEqual(
    decodeMediaJsonLines(JSON.stringify(current) + "\n"),
    {
      ok: true,
      value: [{
        ...sun,
        name: "Bright Sun",
      }],
    },
  );
});

test("syntax failures identify the exact JSONL line", () => {
  const result = decodeMediaJsonLines(
    JSON.stringify(sun) + "\n" + "{\"id\":" + "\n",
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.path, "$.lines[2]");
  }
});

test("semantic failures are rebased to the exact JSONL line", () => {
  const invalid = { ...horse, english: "yes" };
  const result = decodeMediaJsonLines(
    JSON.stringify(sun)
      + "\n"
      + JSON.stringify(invalid)
      + "\n",
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.path, "$.lines[2].english");
  }
});

test("future record versions fail at their exact JSONL line", () => {
  const future = {
    schemaVersion: 3,
    ...sun,
    name: "Sun",
  };
  const result = decodeMediaJsonLines(JSON.stringify(future) + "\n");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.path, "$.lines[1].schemaVersion");
  }
});

test("JSONL decoding rejects duplicate IDs and paths", () => {
  const duplicate = { ...horse, id: sun.id, path: sun.path };
  const result = decodeMediaJsonLines(
    JSON.stringify(sun)
      + "\n"
      + JSON.stringify(duplicate)
      + "\n",
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
    JSON.stringify(sun)
      + "\n\n"
      + JSON.stringify(horse)
      + "\n",
  );

  assert.equal(result.ok, false);
});

test("serialization emits canonical version-two records", () => {
  const serialized = serializeMediaJsonLines([{
    ...sun,
    name: "Bright Sun",
  }]);

  assert.equal(
    serialized,
    '{"schemaVersion":2,"id":"sun","path":"media/sun.avif",'
      + '"name":"Bright Sun",'
      + '"description":"A bright yellow sun in a clear blue sky.",'
      + '"english":true}\n',
  );
});
