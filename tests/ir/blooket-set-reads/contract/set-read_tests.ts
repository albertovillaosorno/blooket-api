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
//   - Behavioral tests for minimal Blooket set read contracts.
// - Must-Not:
//   - Assert undocumented remote ID grammar or question payload fields.
// - Allows:
//   - Inputs: Fixed summary/detail runtime candidates.
//   - Outputs: Exact decoding and fail-closed verdicts.
//   - Side effects: None.
// - Split-When:
//   - Question read contracts gain independent fixtures.
// - Merge-When:
//   - Summary and detail read shapes converge.
// - Summary:
//   - Proves remote IDs remain opaque and unknown fields fail.
// - Description:
//   - Mirrors src/ir/blooket-set-reads/contract/set-read.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Version one admits only verified metadata fields.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBlooketSetDetail,
  decodeBlooketSetId,
  decodeBlooketSetList,
} from "../../../../src/ir/blooket-set-reads/contract/set-read.ts";

test("remote set IDs are opaque non-empty strings", () => {
  assert.deepEqual(decodeBlooketSetId("opaque/REMOTE id?"), {
    ok: true,
    value: "opaque/REMOTE id?",
  });
  assert.equal(decodeBlooketSetId("").ok, false);
  assert.equal(decodeBlooketSetId(42).ok, false);
});

test("set lists accept exact versioned ID and title summaries", () => {
  assert.deepEqual(decodeBlooketSetList([
    {
      schemaVersion: 1,
      id: "remote-a",
      title: "Fractions",
    },
    {
      schemaVersion: 1,
      id: "remote-b",
      title: "Vocabulary",
    },
  ]), {
    ok: true,
    value: [
      {
        schemaVersion: 1,
        id: "remote-a",
        title: "Fractions",
      },
      {
        schemaVersion: 1,
        id: "remote-b",
        title: "Vocabulary",
      },
    ],
  });
});

test("set list failures preserve the exact item path", () => {
  const result = decodeBlooketSetList([
    {
      schemaVersion: 1,
      id: "",
      title: "Broken",
    },
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.path, "$[0].id");
  }
});

test("set details accept only verified metadata fields", () => {
  assert.deepEqual(decodeBlooketSetDetail({
    schemaVersion: 1,
    id: "remote-a",
    title: "Fractions",
    description: "Adding unlike denominators.",
    visibility: "private",
  }), {
    ok: true,
    value: {
      schemaVersion: 1,
      id: "remote-a",
      title: "Fractions",
      description: "Adding unlike denominators.",
      visibility: "private",
    },
  });
});

test("set details reject invented fields and visibility values", () => {
  const result = decodeBlooketSetDetail({
    schemaVersion: 1,
    id: "remote-a",
    title: "Fractions",
    description: "Review.",
    visibility: "friends-only",
    questionCount: 10,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some((issue) => issue.code === "unknown-field"),
      true,
    );
    assert.equal(
      result.issues.some((issue) => issue.code === "invalid-visibility"),
      true,
    );
  }
});

test("future set read versions fail closed", () => {
  const result = decodeBlooketSetDetail({
    schemaVersion: 2,
    id: "remote-a",
    title: "Fractions",
    description: "Review.",
    visibility: "public",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.code, "unsupported-version");
  }
});
