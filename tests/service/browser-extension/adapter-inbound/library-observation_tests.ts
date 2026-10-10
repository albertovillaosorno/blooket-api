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
//   - Synthetic visible/model consistency and private-envelope containment.
// - Must-Not:
//   - Contact an account or upgrade collection completeness.
// - Allows:
//   - Inputs: Fictional DOM envelopes and library model records.
//   - Outputs: Exact identity consistency and containment assertions.
//   - Side effects: None.
// - Split-When:
//   - A browser host needs different observation consistency evidence.
// - Merge-When:
//   - A stable provider read contract replaces model comparison.
// - Summary:
//   - Rejects omitted or changed cards without exposing initial model text.
// - Description:
//   - The allSets label never turns a matched subset into complete evidence.
// - Usage:
//   - Run through the repository Node test suite.
// - Defaults:
//   - Unknown builds keep existing observational read semantics.
//
import assert from "node:assert/strict";
import test from "node:test";
import { checkBlooketLibraryObservation } from
  // jig-ignore-next-line: Mirrored source path is required for these tests.
  "../../../../src/service/browser-extension/adapter-inbound/library-observation.ts";
import { BLOOKET_LIBRARY_MODEL_BUILD } from
  "../../../../src/ir/blooket-flight-records/contract/library-model.ts";
import { libraryModelFixture } from
  "../../../ir/blooket-flight-records/contract/library-model-fixture.ts";

const observed = { ok: true, value: {
  items: [{ schemaVersion: 1, id: "set-fixture", title: "Synthetic" }],
  completeness: "unknown",
} };
const captured = { build: BLOOKET_LIBRARY_MODEL_BUILD,
  source: libraryModelFixture() };
const failed = { ok: false, code: "blooket-browser-failed" };

test("matched model evidence preserves unknown completeness and containment",
  () => {
  assert.strictEqual(checkBlooketLibraryObservation(observed, captured),
    observed);
  const result = JSON.stringify(
    checkBlooketLibraryObservation(observed, captured),
  );
  assert.equal(result.includes("fictional-author"), false);
  assert.equal(result.includes("source"), false);
  assert.equal(result.includes("allSets"), false);
  },
);

test("server-rendered identities reject missing or changed visible cards",
  () => {
  for (const items of [[], [
    { schemaVersion: 1, id: "set-fixture", title: "Changed" },
  ], [
    { schemaVersion: 1, id: "wrong-set", title: "Synthetic" },
  ], [...observed.value.items, ...observed.value.items]]) {
    assert.deepEqual(checkBlooketLibraryObservation({ ok: true, value: {
      items, completeness: items.length === 0 ? "complete" : "unknown",
    } }, captured), failed);
  }
  assert.deepEqual(checkBlooketLibraryObservation(observed, {
    ...captured, source: libraryModelFixture({ props: { allSets: [] } }),
  }), failed);
  },
);

test("unavailable models and unknown builds preserve visible read semantics",
  () => {
  assert.strictEqual(checkBlooketLibraryObservation(observed, null), observed);
  assert.strictEqual(checkBlooketLibraryObservation(observed, {
    build: "unknown", source: "not-a-flight-model",
  }), observed);
  assert.strictEqual(checkBlooketLibraryObservation(failed, captured), failed);
  for (const value of [undefined, {}, { ...captured, extra: true },
    { ...captured, source: "invalid" }]) {
    assert.deepEqual(checkBlooketLibraryObservation(observed, value), failed);
  }
  },
);
