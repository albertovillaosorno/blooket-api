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
  assert.strictEqual(checkBlooketLibraryObservation(observed, {
    build: BLOOKET_LIBRARY_MODEL_BUILD,
    source: libraryModelFixture({ props: {
      numSets: null, numQuestions: "$undefined",
    } }),
  }), observed);
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


test("captured model envelopes reject hidden and symbol-owned fields",
  () => {
  for (const malformed of [
    Object.defineProperty({ ...captured }, "hidden", {
      enumerable: false, value: "untrusted",
    }),
    { ...captured, [Symbol("hidden")]: "untrusted" },
  ]) assert.deepEqual(checkBlooketLibraryObservation(observed,
    malformed), failed);
  },
);


test("library model correlation ignores accessor-backed captured fields",
  () => {
  for (const key of ["build", "source"] as const) {
    const envelope = { ...captured };
    Object.defineProperty(envelope, key, {
      enumerable: true,
      get() { throw new Error("captured getter must not run"); },
    });
    assert.deepEqual(checkBlooketLibraryObservation(observed, envelope),
      failed);
  }
  const hidden = { ...captured };
  Object.defineProperty(hidden, "source", {
    enumerable: false, value: captured.source,
  });
  assert.deepEqual(checkBlooketLibraryObservation(observed, hidden), failed);
  },
);

test("library model correlation does not execute observed row getters",
  () => {
  const row = Object.defineProperty({ ...observed.value.items[0] }, "id", {
    get() { throw new Error("observed getter must not run"); },
  });
  assert.deepEqual(checkBlooketLibraryObservation({ ...observed,
    value: { ...observed.value, items: [row] },
  }, captured), failed);
  const slots = Object.defineProperty([observed.value.items[0]], "0", {
    enumerable: true,
    get() { throw new Error("slot getter must not run"); },
  });
  assert.deepEqual(checkBlooketLibraryObservation({ ...observed,
    value: { ...observed.value, items: slots },
  }, captured), failed);
  },
);


test("model comparison never invokes a browser array filter override",
  () => {
  let calls = 0;
  const items = [...observed.value.items];
  Object.setPrototypeOf(items, Object.assign(Object.create(Array.prototype), {
    filter() { calls++; throw new Error("inherited filter is untrusted"); },
  }));
  const result = { ...observed, value: { ...observed.value, items } };
  assert.strictEqual(checkBlooketLibraryObservation(result, captured),
    result);
  assert.equal(calls, 0);
  const mismatch = { ...result, value: {
    ...result.value, items: Object.assign(items, { 0: {
      schemaVersion: 1, id: "set-fixture", title: "Altered",
    } }),
  } };
  assert.deepEqual(checkBlooketLibraryObservation(mismatch, captured),
    failed);
  assert.equal(calls, 0);
  },
);


test("Flight comparison snapshots browser rows without proxy index reads",
  () => {
  let indexedReads = 0;
  const rows = new Proxy([...observed.value.items], {
    get(target, key, receiver) {
      if (key === "0" || key === "length") {
        indexedReads++;
        throw new Error("Untrusted browser collection index getter");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const checked = { ...observed, value: { ...observed.value, items: rows } };
  assert.strictEqual(checkBlooketLibraryObservation(checked, captured),
    checked);
  assert.equal(indexedReads, 0);
  const revoked = Proxy.revocable([...observed.value.items], {});
  revoked.revoke();
  assert.deepEqual(checkBlooketLibraryObservation({ ...observed,
    value: { ...observed.value, items: revoked.proxy },
  }, captured), failed);
  },
);

test("Flight comparison never accesses captured proxy values by getter",
  () => {
  let getterReads = 0;
  const wrapped = new Proxy({ ...captured }, {
    get(target, key, receiver) {
      if (key === "build" || key === "source") {
        getterReads++;
        throw new Error("Untrusted Flight payload getter");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  assert.strictEqual(checkBlooketLibraryObservation(observed, wrapped),
    observed);
  assert.equal(getterReads, 0);
  },
);
