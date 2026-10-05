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
//   - Behavioral tests for canonical result-envelope decoding.
// - Must-Not:
//   - Interpret command-specific values or transport formatting.
// - Allows:
//   - Inputs: Fixed success and failure result fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - A new result-envelope version needs independent fixtures.
// - Merge-When:
//   - Result envelopes are removed from transport boundaries.
// - Summary:
//   - Verifies strict version-one result envelopes.
// - Description:
//   - Mirrors src/ir/wire-envelopes/contract/result-envelope.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Failure envelopes require at least one structured issue.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeResultEnvelope } from
  "../../../../src/ir/wire-envelopes/contract/result-envelope.ts";

test("result envelopes accept exact success values", () => {
  const result = decodeResultEnvelope({
    version: 1,
    operationId: "health.get:1",
    ok: true,
    value: { healthy: true },
  });

  assert.equal(result.ok, true);
});

test("result envelopes accept exact structured failures", () => {
  const result = decodeResultEnvelope({
    version: 1,
    operationId: "sets.create:1",
    ok: false,
    issues: [
      {
        path: "$.payload.title",
        code: "empty-string",
        message: "Expected a non-empty string.",
      },
    ],
  });

  assert.equal(result.ok, true);
});

test("failure envelopes reject empty issue arrays", () => {
  const result = decodeResultEnvelope({
    version: 1,
    operationId: "sets.create:1",
    ok: false,
    issues: [],
  });

  assert.equal(result.ok, false);
});
