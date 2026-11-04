// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: LicenseRef-Proprietary
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  BLOOKET_WRITE_PLAN_VERSION,
  BLOOKET_WRITE_VERIFICATION_BASELINE_VERSION,
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
