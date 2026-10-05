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
  isRecord,
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
