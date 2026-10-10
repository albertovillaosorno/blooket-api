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
//   - Synthetic regressions for bounded server-rendered library candidates.
// - Must-Not:
//   - Contact Blooket or treat allSets as collection completeness proof.
// - Allows:
//   - Inputs: Fictional Flight records and provider module identities.
//   - Outputs: Normalized identities or fail-closed assertions.
//   - Side effects: None.
// - Split-When:
//   - Another build needs independently evidenced model fixtures.
// - Merge-When:
//   - The provider no longer requires model decoding.
// - Summary:
//   - Rejects unsupported builds, components, filters, and references.
// - Description:
//   - Uses fictional values rather than authenticated page captures.
// - Usage:
//   - Run through the repository Node test suite.
// - Defaults:
//   - Unsupported provider variants remain unverified.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  BLOOKET_LIBRARY_MODEL_BUILD, decodeBlooketLibraryModel,
} from "../../../../src/ir/blooket-flight-records/contract/library-model.ts";
import { decodeFlightPageRows, decodeFlightRows } from
  "../../../../src/ir/blooket-flight-records/contract/flight.ts";
import { libraryModelFixture } from "./library-model-fixture.ts";

const decode = (source: string) =>
  decodeBlooketLibraryModel(source, BLOOKET_LIBRARY_MODEL_BUILD);

test("the library model returns only normalized identity candidates", () => {
  assert.deepEqual(decode(libraryModelFixture()), {
    allSets: [{ id: "set-fixture", title: "Synthetic" }],
    displayedSets: [{ id: "set-fixture", title: "Synthetic" }],
  });
  assert.deepEqual(decode(libraryModelFixture({ props: {
    allSets: [], sets: [],
  } })), { allSets: [], displayedSets: [] });
});

test("page metadata never weakens action response framing", () => {
  const source = libraryModelFixture();
  assert.throws(() => decodeFlightRows(source), /unsupported-flight-tag/u);
  const page = decodeFlightPageRows(source);
  assert.equal(page.modules.size, 1);
  assert.equal(page.models.get("1"), undefined);
  assert.equal(page.models.has("2"), false);
  // Resource hints are ID-less on real server-rendered Flight pages.
  const prefixed = decodeFlightPageRows(':HL["/font.woff2","font"]\n' + source);
  assert.equal(prefixed.models.size, page.models.size);
  assert.equal(prefixed.modules.size, page.modules.size);
  assert.throws(() => decodeFlightRows(":HL[]\n0:{}\n"));
  for (const malformed of [
    "0:IBAD\n", "0:I{}\n", "0:HX[]\n", "0:HL{}\n",
    "0:I[]\n0:{}\n", "0:HL[]\n0:{}\n", "0:Q[]\n",
    ":HL{}\n0:{}\n", ":HX[]\n0:{}\n", ":HLnot-json\n",
    ":HL[]", ":H{}\n", ":HL[]\n:HL{}\n",
  ]) assert.throws(() => decodeFlightPageRows(malformed));
  assert.throws(() => decodeFlightPageRows(
    ":HL[]\n".repeat(20_001) + "0:{}\n",
  ), /flight-row-limit/u);
});

test("changed or ambiguous provider component identities are refused", () => {
  assert.equal(decodeBlooketLibraryModel(libraryModelFixture(), "unknown"),
    undefined);
  for (const module of [
    [52645, ["1958", "static/chunks/1958-3beff819112074ac.js"], "default"],
    [52644, ["1958", "static/chunks/changed.js"], "default"],
    [52644, ["1958", "static/chunks/1958-3beff819112074ac.js"], "other"],
    [52644, [1958, "static/chunks/1958-3beff819112074ac.js"], "default"],
    [52644, ["1958"], "default"],
  ]) assert.equal(decode(libraryModelFixture({ module })), undefined);
  const source = libraryModelFixture();
  const tuple = source.slice(2, source.indexOf("\n"));
  assert.equal(decode(source + "b:" + tuple + "\n"), undefined);
  assert.equal(decode(source.replace("1:I", "1:")), undefined);
});

test("only the exact unfiltered library prop shape is admitted", () => {
  for (const props of [
    { type: "FAVORITES" }, { isMerging: true }, { hasFolderOrSearch: true },
    { query: "sun" }, { query: null }, { query: "$$undefined" },
    { filter: "recent" }, { setsFolder: {} }, { folders: [{}] },
    { hasPlus: "false" }, { isStudent: null }, { numSets: 1 },
    { numQuestions: 1 }, { extra: true }, { allSets: null },
  ]) assert.equal(decode(libraryModelFixture({ props })), undefined);
});

test("identity references preserve literals and exact UTF-8 text", () => {
  const title = "sol ☀️";
  const length = Buffer.byteLength(title).toString(16);
  assert.deepEqual(decode(libraryModelFixture({
    set: { _id: "$$opaque", title: "$b" }, extra: "b:T" + length + "," + title,
  })), {
    allSets: [{ id: "$opaque", title }],
    displayedSets: [{ id: "$opaque", title }],
  });
  for (const title of ["$b", "$L1", "$undefined", "", " ", 1]) {
    assert.equal(decode(libraryModelFixture({ set: { title } })), undefined);
  }
  assert.equal(decode(libraryModelFixture({
    set: { title: "$b" }, extra: 'b:"$c"\nc:"$b"\n',
  })), undefined);
});

test("duplicate sets and excessive model graphs fail closed", () => {
  assert.equal(decode(libraryModelFixture({ props: {
    allSets: ["$a", "$a"],
  } })), undefined);
  assert.equal(decode(libraryModelFixture({ props: {
    allSets: Array.from({ length: 201 }, () => "$a"),
  } })), undefined);
  assert.equal(decode(libraryModelFixture({ set: { unexpected: true } })),
    undefined);
  const nested = "[".repeat(102) + "null" + "]".repeat(102);
  assert.equal(decode(libraryModelFixture({ extra: "b:" + nested + "\n" })),
    undefined);
  assert.equal(decode("x".repeat(5_000_001)), undefined);
});
