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
//   - Behavioral tests for canonical command-envelope decoding.
// - Must-Not:
//   - Execute commands or validate command-specific payloads.
// - Allows:
//   - Inputs: Fixed command-envelope fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - A new command-envelope version needs independent fixtures.
// - Merge-When:
//   - Command envelopes are removed from transport boundaries.
// - Summary:
//   - Verifies strict version-one command envelopes.
// - Description:
//   - Mirrors src/ir/wire-envelopes/contract/command-envelope.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unknown fields and missing payloads fail.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeCommandEnvelope } from
  "../../../../src/ir/wire-envelopes/contract/command-envelope.ts";

const valid = {
  version: 1,
  operationId: "sets.list:1",
  command: "sets.list",
  payload: {},
};

test("command envelopes accept the exact version-one contract", () => {
  assert.equal(decodeCommandEnvelope(valid).ok, true);
});

test("command envelopes reject unknown fields", () => {
  const result = decodeCommandEnvelope({ ...valid, surprise: true });

  assert.equal(result.ok, false);
});

test("command envelopes reject missing payload fields", () => {
  const { payload: _payload, ...missingPayload } = valid;
  const result = decodeCommandEnvelope(missingPayload);

  assert.equal(result.ok, false);
});

test("command envelopes reject unsupported versions", () => {
  const result = decodeCommandEnvelope({ ...valid, version: 2 });

  assert.equal(result.ok, false);
});
