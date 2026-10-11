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
//   - Behavioral tests for exact runtime object validation primitives.
// - Must-Not:
//   - Test command-specific or project-specific contracts.
// - Allows:
//   - Inputs: Fixed primitive and object fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Primitive checks gain independent test fixtures.
// - Merge-When:
//   - Exact runtime object validation is removed.
// - Summary:
//   - Verifies fail-closed object and field validation.
// - Description:
//   - Mirrors src/ir/runtime-decoding/domain/exact-object.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unknown fields remain errors.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  isExactDenseArray,
  isRecord,
  ownDataField,
  requiredString,
  unknownFieldIssues,
} from "../../../../src/ir/runtime-decoding/domain/exact-object.ts";

test("isRecord rejects arrays and null", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
});

test("unknownFieldIssues reports fields in deterministic order", () => {
  const issues = unknownFieldIssues(
    { zed: true, admitted: true, alpha: true },
    new Set(["admitted"]),
    "$",
  );

  assert.deepEqual(
    issues.map((issue) => issue.path),
    ["$.alpha", "$.zed"],
  );
});

test("requiredString does not coerce numbers", () => {
  const issues = [];
  const value = requiredString(42, "$.name", issues);

  assert.equal(value, undefined);
  assert.equal(issues.length, 1);
});


test("unknownFieldIssues rejects nonenumerable and symbol-owned extras",
  () => {
  const value = Object.defineProperty({ ok: true }, "hidden", {
    enumerable: false, value: "untrusted",
  });
  Object.defineProperty(value, Symbol("secret"), {
    enumerable: false, value: "untrusted",
  });
  assert.deepEqual(unknownFieldIssues(value, new Set(["ok"]), "$"), [
    { path: "$.[symbol]", code: "unknown-field",
      message: "Field is not admitted by this contract." },
    { path: "$.hidden", code: "unknown-field",
      message: "Field is not admitted by this contract." },
  ]);
  },
);


test("dense array admission refuses sparse slots and hidden extras",
  () => {
  assert.equal(isExactDenseArray(["a", "b"]), true);
  assert.equal(isExactDenseArray([]), true);
  const sparse = new Array(2);
  sparse[1] = "b";
  assert.equal(isExactDenseArray(sparse), false);
  assert.equal(isExactDenseArray(Object.defineProperty(["a"], "extra", {
    value: 1, enumerable: false,
  })), false);
  assert.equal(isExactDenseArray(["a", Symbol("hidden")]), true);
  assert.equal(isExactDenseArray(Object.defineProperty(["a"],
    Symbol("hidden"), { value: true })), false);
  },
);


test("owned data reads ignore inherited fields without invoking getters",
  () => {
  const parent = { id: "inherited" };
  const fixture = Object.create(parent) as Record<string, unknown>;
  Object.defineProperty(fixture, "hidden", {
    get() { throw new Error("accessor must not run"); },
  });
  Object.defineProperty(fixture, "value", { value: "owned" });
  assert.equal(ownDataField(fixture, "id"), undefined);
  assert.equal(ownDataField(fixture, "hidden"), undefined);
  assert.equal(ownDataField(fixture, "value"), "owned");
  },
);
