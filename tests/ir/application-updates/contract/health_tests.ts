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
//   - Exact private updater health protocol regression coverage.
// - Must-Not:
//   - Expose secrets or trust unvalidated host configuration.
// - Allows:
//   - Inputs: Explicit host configuration and bounded lifecycle inputs.
//   - Outputs: Validated local status, artifacts, or stable failure codes.
//   - Side effects: Owned filesystem, process, or browser operations.
// - Split-When:
//   - Host admission needs an independent platform boundary.
// - Merge-When:
//   - This host capability no longer needs a separate boundary.
// - Summary:
//   - Keeps explicit host operations outside product semantics.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { decodeUpdateHealthRequest, decodeUpdateHealthResponse } from
  "../../../../src/ir/application-updates/contract/health.ts";

const nonce = randomUUID(), instance = randomUUID();
const request = { kind: "update-health-request", nonce };
const reply = { kind: "update-health-response", nonce, instance,
  pid: 42, version: "26.4.0", status: "healthy" };
test("private health messages require exact fresh-challenge fields", () => {
  assert.equal(decodeUpdateHealthRequest(request), nonce);
  assert.deepEqual(decodeUpdateHealthResponse(reply), reply);
  assert.deepEqual(decodeUpdateHealthResponse({ ...reply,
    status: "unavailable" }), { ...reply, status: "unavailable" });
  for (const invalid of [null, [], {}, { ...request, extra: true },
    { ...request, nonce: 1 }, { ...request, nonce: "stale-runtime" },
    { ...request, kind: "other" }])
    assert.equal(decodeUpdateHealthRequest(invalid), undefined);
  for (const invalid of [null, [], {}, { ...reply, extra: true },
    { ...reply, nonce: "stale-runtime" }, { ...reply, pid: "42" },
    { ...reply, pid: 0 }, { ...reply, status: "running" },
    { ...reply, version: "latest" }, { ...reply, instance: "other" },
    { ...reply, kind: "other" }])
    assert.equal(decodeUpdateHealthResponse(invalid), undefined);
});
