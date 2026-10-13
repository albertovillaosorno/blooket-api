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
  exactOwnData,
  isExactDenseArray,
  isRecord,
  ownDataField,
  snapshotExactDenseArray,
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


test("dense arrays reject own index getters and hidden numeric slots",
  () => {
  const getter = Object.defineProperty(["a"], "0", {
    enumerable: true,
    get() { throw new Error("index getter must never execute"); },
  });
  assert.equal(isExactDenseArray(getter), false);
  const hidden = Object.defineProperty(["a"], "0", {
    enumerable: false, value: "a",
  });
  assert.equal(isExactDenseArray(hidden), false);
  },
);


test("declared fields require enumerable owned data descriptors", () => {
  let accessorReads = 0;
  const value = { ordinary: "ok" } as Record<string, unknown>;
  Object.defineProperty(value, "hidden", {
    value: "not-admitted", enumerable: false,
  });
  Object.defineProperty(value, "accessor", {
    enumerable: true,
    get() { accessorReads++; return "not-admitted"; },
  });
  const result = unknownFieldIssues(
    value, new Set(["ordinary", "hidden", "accessor"]), "$",
  );
  assert.deepEqual(result.map(issue => issue.path), [
    "$.accessor", "$.hidden",
  ]);
  assert.equal(accessorReads, 0);
});


test("exact own data copies values without invoking accessors", () => {
  let called = 0;
  const object = { name: "safe" };
  assert.deepEqual(exactOwnData(object, ["name"]), object);
  for (const value of [
    Object.defineProperty({ name: "safe" }, "unexpected", {
      enumerable: false, value: true,
    }),
    Object.defineProperty({ name: "safe" }, Symbol("hidden"), {
      value: true,
    }),
    Object.defineProperty({}, "name", { enumerable: true,
      get() { called++; throw Error("not called"); } }),
    new Proxy({ name: "safe" }, {
      ownKeys() { throw Error("untrusted proxy"); },
    }),
  ]) assert.equal(exactOwnData(value, ["name"]), undefined);
  assert.equal(called, 0);
  const revoked = Proxy.revocable({ name: "safe" }, {});
  revoked.revoke();
  assert.equal(exactOwnData(revoked.proxy, ["name"]), undefined);
  const revokedArray = Proxy.revocable(["safe"], {});
  revokedArray.revoke();
  assert.equal(isExactDenseArray(revokedArray.proxy), false);
});


test("revoked records and throwing descriptors fail without an exception",
  () => {
  const revoked = Proxy.revocable({ name: "safe" }, {});
  revoked.revoke();
  assert.equal(isRecord(revoked.proxy), false);
  const unstable = new Proxy({ name: "safe" }, {
    ownKeys() { throw Error("untrusted ownKeys trap"); },
    getOwnPropertyDescriptor() { throw Error("untrusted field trap"); },
  });
  assert.equal(ownDataField(unstable, "name"), undefined);
  assert.deepEqual(unknownFieldIssues(unstable, new Set(["name"]), "$"), [
    { path: "$", code: "unknown-field",
      message: "Object descriptors could not be inspected." },
  ]);
  },
);


test("bounded array snapshots read descriptors instead of proxy indices",
  () => {
  const input = ["trusted"];
  let indexedReads = 0;
  const watched = new Proxy(input, {
    get(_target, key, receiver) {
      if (key === "0" || key === "length") {
        indexedReads++;
        throw new Error("Untrusted array indexed getter");
      }
      return Reflect.get(input, key, receiver);
    },
  });
  assert.deepEqual(snapshotExactDenseArray(watched, 2), ["trusted"]);
  assert.equal(indexedReads, 0);
  assert.equal(snapshotExactDenseArray(watched, 0), undefined);
  const revoked = Proxy.revocable(["trusted"], {});
  revoked.revoke();
  assert.equal(snapshotExactDenseArray(revoked.proxy, 2), undefined);
  assert.equal(snapshotExactDenseArray(Object.defineProperty(["trusted"],
    "extra", { value: true }), 2), undefined);
  },
);
