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
//   - Exact private launcher/supervisor and managed drainage notices.
// - Must-Not:
//   - Grant installation authority or authenticate an arbitrary process.
// - Allows:
//   - Inputs: Unknown private IPC envelopes.
//   - Outputs: Captured primitives and still-untrusted runtime payloads.
//   - Side effects: None.
// - Split-When:
//   - Supervision requires another protocol version.
// - Merge-When:
//   - All private lifecycle envelopes share identical contracts.
// - Summary:
//   - Keeps private lifecycle notices separate from installation evidence.
// - Description:
//   - The receiver verifies its actual child and separately decodes runtime.
// - Usage:
//   - Use only on the process's existing owned child IPC connection.
// - Defaults:
//   - Unknown, inherited, accessor and extra fields are refused.
//
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { decodeServiceSupervisorReady, decodeServiceDrainNotice } from
  "../../../../src/ir/application-updates/contract/supervision.ts";

test("supervisor envelopes capture private facts without granting authority",
  () => {
    const ready = { kind: "service-supervisor-ready", version: 1, pid: 42,
      runtime: { still: "untrusted" } };
    assert.deepEqual(decodeServiceSupervisorReady(ready), { pid: 42,
      runtime: ready.runtime });
    const notice = { kind: "service-drain-complete", version: 1, pid: 43,
      instance: randomUUID(), status: "drained" };
    assert.deepEqual(decodeServiceDrainNotice(notice), { pid: 43,
      instance: notice.instance, status: "drained" });
    for (const value of [null, [], {}, Object.create(ready),
      { ...ready, version: 2 }, { ...ready, extra: true },
      { ...ready, pid: 0 }, { ...ready, pid: "42" }])
      assert.equal(decodeServiceSupervisorReady(value), undefined);
    for (const value of [null, [], {}, Object.create(notice),
      { ...notice, status: "healthy" }, { ...notice, extra: true },
      { ...notice, instance: "foreign" }, { ...notice, pid: 0 }])
      assert.equal(decodeServiceDrainNotice(value), undefined);
    let reads = 0;
    const accessor = { ...ready };
    Object.defineProperty(accessor, "runtime", { enumerable: true,
      get() { reads++; throw Error("untrusted-getter"); } });
    assert.equal(decodeServiceSupervisorReady(accessor), undefined);
    assert.equal(reads, 0);
  });
