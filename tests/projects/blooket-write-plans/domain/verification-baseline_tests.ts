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
//   - Unit tests for non-sensitive Blooket write verification baselines.
// - Must-Not:
//   - Observe Blooket, persist files, or test provider canonicalization.
// - Allows:
//   - Inputs: Deterministic baseline candidates.
//   - Outputs: Exact decode and operation-kind compatibility verdicts.
//   - Side effects: None.
// - Split-When:
//   - Baseline families gain independent schemas.
// - Merge-When:
//   - Durable verification baselines are removed.
// - Summary:
//   - Proves only bounded-shape count/digest evidence crosses the domain.
// - Description:
//   - Provider-specific collection content never enters these fixtures.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unknown fields and malformed digests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBlooketWriteVerificationBaseline,
  frameBlooketWriteVerificationCollection,
  verificationBaselineKindForOperation,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/projects/blooket-write-plans/domain/verification-baseline.ts";

const DIGEST = "a".repeat(64);

test(
  "set and question baselines decode exact count and digest evidence",
  () => {
  assert.deepEqual(
    decodeBlooketWriteVerificationBaseline({
      schemaVersion: 1,
      kind: "set-list",
      itemCount: 3,
      sha256: DIGEST,
    }, "set-list"),
    {
      ok: true,
      value: {
        schemaVersion: 1,
        kind: "set-list",
        itemCount: 3,
        sha256: DIGEST,
      },
    },
  );
  assert.equal(
    decodeBlooketWriteVerificationBaseline({
      schemaVersion: 1,
      kind: "question-list",
      itemCount: 0,
      sha256: "0".repeat(64),
    }, "question-list").ok,
    true,
  );
  },
);

test("baseline kinds derive only from canonical operation kinds", () => {
  assert.equal(verificationBaselineKindForOperation("set"), "set-list");
  assert.equal(
    verificationBaselineKindForOperation("question"),
    "question-list",
  );
});

test(
  "baseline decoding rejects wrong kinds malformed digests and extras",
  () => {
  for (const candidate of [
    {
      schemaVersion: 1,
      kind: "question-list",
      itemCount: 1,
      sha256: DIGEST,
    },
    {
      schemaVersion: 1,
      kind: "set-list",
      itemCount: -1,
      sha256: DIGEST,
    },
    {
      schemaVersion: 1,
      kind: "set-list",
      itemCount: 1.5,
      sha256: DIGEST,
    },
    {
      schemaVersion: 1,
      kind: "set-list",
      itemCount: 1,
      sha256: "A".repeat(64),
    },
    {
      schemaVersion: 1,
      kind: "set-list",
      itemCount: 1,
      sha256: DIGEST,
      rawProviderState: "must-not-cross",
    },
  ]) {
    assert.equal(
      decodeBlooketWriteVerificationBaseline(
        candidate,
        "set-list",
      ).ok,
      false,
    );
  }
  },
);

test("collection framing is versioned ordered and unambiguous", () => {
  assert.equal(
    frameBlooketWriteVerificationCollection(["alpha", "beta"]),
    '[1,"alpha","beta"]',
  );
  assert.notEqual(
    frameBlooketWriteVerificationCollection(["ab", "c"]),
    frameBlooketWriteVerificationCollection(["a", "bc"]),
  );
  assert.notEqual(
    frameBlooketWriteVerificationCollection(["same", "same"]),
    frameBlooketWriteVerificationCollection(["same"]),
  );
  assert.notEqual(
    frameBlooketWriteVerificationCollection(["first", "second"]),
    frameBlooketWriteVerificationCollection(["second", "first"]),
  );
});

test(
  "collection framing escapes delimiters and Unicode deterministically",
  () => {
  assert.equal(
    frameBlooketWriteVerificationCollection([
      "comma,value",
      "line\nbreak",
      "emoji-🧪",
    ]),
    '[1,"comma,value","line\\nbreak","emoji-🧪"]',
  );
  },
);
