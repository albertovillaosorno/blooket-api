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
//   - Exact release distribution-identity decoding regressions.
// - Must-Not:
//   - Infer CI, publisher or native Apple trust from metadata declarations.
// - Allows:
//   - Inputs: Fictional metadata and hostile descriptor fixtures.
//   - Outputs: Owned identity and refusal assertions.
//   - Side effects: None.
// - Split-When:
//   - Another versioned distribution schema is admitted.
// - Merge-When:
//   - Release signing no longer uses embedded package identity.
// - Summary:
//   - Rejects dirty, foreign and executable metadata candidates.
// - Description:
//   - A declared signing flag never confers Apple assessment authority.
// - Usage:
//   - Run through the ordinary repository test runner.
// - Defaults:
//   - Unknown fields and unsupported schema variants fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { decodeReleasePackageIdentity } from
  "../../../../src/ir/update-manifests/contract/package-identity.ts";

const metadata = { version: 1, productVersion: "26.4.1", target: "darwin-arm64",
  sourceRevision: "a".repeat(40), minimumMacOS: "13.5", signed: false,
  sourceDirty: false, artifacts: [{ name: "node", version: "24.21.0",
    sha256: "b".repeat(64), integrityScope: "archive" }],
};
test("clean ARM64 metadata yields only its owned release identity", () => {
  const result = decodeReleasePackageIdentity(metadata);
  assert.deepEqual(result, { ok: true, value: { version: "26.4.1",
    sourceCommit: "a".repeat(40), minimumMacos: "13.5" } });
  assert.deepEqual(decodeReleasePackageIdentity({ ...metadata, signed: true }),
    result);
});
test("dirty, foreign, incomplete and malformed metadata is refused", () => {
  for (const changed of [{ version: 2 }, { sourceDirty: true },
    { sourceDirty: undefined }, { signed: "true" }, { target: "linux-x64" },
    { productVersion: "v26.4.1" }, { minimumMacOS: "13.4" },
    { sourceRevision: "A".repeat(40) }, { artifacts: [] },
    { artifacts: Array(1) },
    { artifacts: Array(129).fill(metadata.artifacts[0]) },
    { extra: true }, { artifacts: [{ ...metadata.artifacts[0], extra: true }] },
    { artifacts: [{ ...metadata.artifacts[0], integrityScope: "file" }] }]) {
    assert.equal(decodeReleasePackageIdentity({ ...metadata, ...changed }).ok,
      false);
  }
});
test("metadata and dependency getters cannot execute during admission", () => {
  let calls = 0;
  const candidate = { ...metadata };
  Object.defineProperty(candidate, "sourceDirty", { enumerable: true,
    get: () => { calls++; return false; } });
  assert.equal(decodeReleasePackageIdentity(candidate).ok, false);
  const artifact = { ...metadata.artifacts[0] };
  Object.defineProperty(artifact, "name", { enumerable: true,
    get: () => { calls++; return "node"; } });
  assert.equal(decodeReleasePackageIdentity({ ...metadata,
    artifacts: [artifact] }).ok, false);
  assert.equal(calls, 0);
});
