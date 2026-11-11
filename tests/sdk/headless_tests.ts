// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: MIT
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  BLOOKET_WRITE_PLAN_VERSION,
  BLOOKET_WRITE_VERIFICATION_BASELINE_VERSION,
  analyzeWriteRecoveryProtocol,
  decodeBlooketWriteVerificationBaseline,
} from "@blooket-api/repository/headless";

test("public headless entrypoint loads without a desktop or MCP host", () => {
  assert.equal(BLOOKET_WRITE_PLAN_VERSION, 1);
  assert.equal(BLOOKET_WRITE_VERIFICATION_BASELINE_VERSION, 1);
  const result = decodeBlooketWriteVerificationBaseline({
    schemaVersion: 1,
    kind: "set-list",
    itemCount: 0,
    sha256: "a".repeat(64),
  });
  assert.equal(result.ok, true);
});


test("headless SDK exposes the same finite recovery model as production", () => {
  const plan = {
    schemaVersion: 1 as const,
    planId: "plan:headless-smoke",
    desiredStateSha256: "fixture",
    operations: [{
      kind: "set" as const,
      operationId: "plan:headless-smoke:set",
      title: "Lesson",
      description: "",
      visibility: "private" as const,
      coverMediaId: null,
    }],
  };
  assert.deepEqual(analyzeWriteRecoveryProtocol(plan), {
    ok: true,
    exploredStates: 5,
    exploredTransitions: 5,
    reachedTerminal: true,
    violations: [],
  });
});
