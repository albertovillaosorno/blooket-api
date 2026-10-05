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
//   - Behavioral tests for canonical operation identifier validation.
// - Must-Not:
//   - Generate identifiers or test transport-specific correlation behavior.
// - Allows:
//   - Inputs: Fixed valid and invalid identifier candidates.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Identifier generation gains its own contract.
// - Merge-When:
//   - Stable operation identifiers are removed.
// - Summary:
//   - Verifies the operation identifier grammar.
// - Description:
//   - Mirrors src/ir/operation-identifiers/domain/operation-id.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Uppercase and empty identifiers fail.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeOperationId } from
  "../../../../src/ir/operation-identifiers/domain/operation-id.ts";

test("operation IDs accept stable lowercase correlation values", () => {
  const result = decodeOperationId("sets.create:lesson-5");

  assert.equal(result.ok, true);
});

test("operation IDs reject uppercase values", () => {
  const result = decodeOperationId("Sets.Create");

  assert.equal(result.ok, false);
});

test("operation IDs reject empty values", () => {
  const result = decodeOperationId("");

  assert.equal(result.ok, false);
});
