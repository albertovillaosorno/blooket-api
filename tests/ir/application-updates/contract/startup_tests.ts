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
//   - Exact private installer-to-child startup admission messages.
// - Must-Not:
//   - Grant authority from a PID, token, environment value, or public request.
// - Allows:
//   - Inputs: Unknown private IPC messages.
//   - Outputs: Owned validated fields or refusal.
//   - Side effects: None.
// - Split-When:
//   - Startup requires another protocol version.
// - Merge-When:
//   - Private lifecycle protocols share identical contracts.
// - Summary:
//   - Captures fields without exposing live installation ownership.
// - Description:
//   - Decoding alone never authenticates the parent or held data boundary.
// - Usage:
//   - Verify against actual child/parent IPC and the private installation file.
// - Defaults:
//   - Unknown, inherited, accessor and extra fields are refused.
//
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { decodeUpdateStartupRequest, decodeUpdateStartupReady } from
  "../../../../src/ir/application-updates/contract/startup.ts";

test("private startup captures exact fields and refuses public authority",
  () => {
    const request = { kind: "update-startup-request", version: 1,
      ownerPid: 42, childPid: 43, token: randomUUID() };
    const admitted = decodeUpdateStartupRequest(request);
    assert.deepEqual(admitted, request);
    assert.equal(Object.isFrozen(admitted), true);
    request.childPid = 44;
    assert.equal(admitted?.childPid, 43);
    for (const value of [null, [], {}, Object.create(request),
      { ...request, extra: true }, { ...request, version: 2 },
      { ...request, token: "arbitrary" }, { ...request, ownerPid: 0 },
      { ...request, childPid: request.ownerPid },
      { ...request, childPid: 1.5 }, { ...request, ownerPid: "42" },
      { ...request, kind: "update-health-request" }])
      assert.equal(decodeUpdateStartupRequest(value), undefined);
    let reads = 0;
    const accessor = { ...request };
    Object.defineProperty(accessor, "token", { enumerable: true,
      get() { reads++; throw Error("untrusted-accessor"); } });
    assert.equal(decodeUpdateStartupRequest(accessor), undefined);
    assert.equal(reads, 0);
    const proxy = Proxy.revocable(request, {});
    proxy.revoke();
    assert.equal(decodeUpdateStartupRequest(proxy.proxy), undefined);
  });

test("private startup readiness is exact and grants no health claim", () => {
  const ready = { kind: "update-startup-ready", version: 1, pid: 42 };
  assert.equal(decodeUpdateStartupReady(ready), 42);
  for (const value of [null, [], {}, Object.create(ready),
    { ...ready, version: 2 }, { ...ready, status: "healthy" },
    { ...ready, pid: "42" }, { ...ready, pid: -1 }])
    assert.equal(decodeUpdateStartupReady(value), undefined);
});
