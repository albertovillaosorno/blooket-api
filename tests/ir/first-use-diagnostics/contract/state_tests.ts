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
//   - Verification of persisted first-use diagnostic integrity.
// - Must-Not:
//   - Execute checks, consume credentials, or prove native host acceptance.
// - Allows:
//   - Inputs: Untrusted diagnostic records.
//   - Outputs: Validated state or bounded decoding failures.
//   - Side effects: None.
// - Split-When:
//   - Native diagnostic results need a different schema or trust authority.
// - Merge-When:
//   - Diagnostic persistence no longer exists.
// - Summary:
//   - Prevents malformed cached diagnostics becoming trusted startup status.
// - Description:
//   - Rejects unknown fields, duplicate checks, and contradictory outcomes.
// - Usage:
//   - Decode before returning persisted state or publishing a fresh result.
// - Defaults:
//   - Unknown schemas and malformed records fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFirstUseDiagnostic,
  type FirstUseDiagnostic,
} from "../../../../src/ir/first-use-diagnostics/contract/state.ts";

function fixture(): FirstUseDiagnostic {
  return {
    schemaVersion: 1,
    checkVersion: 1,
    at: "2026-10-07T00:00:00.000Z",
    outcome: "passed",
    log: "logs/first-use.json",
    checks: [
      { name: "runtime", status: "passed", code: "node-24-required" },
      { name: "macos", status: "unverified", code: "development-host" },
      { name: "storage", status: "passed", code: "storage-writable" },
      { name: "native-image", status: "passed", code: "native-image-ready" },
      {
        name: "secret-store-client", status: "unconfigured",
        code: "secret-client-unavailable",
      },
    ],
  };
}

test("diagnostics preserve unverified status and clone cached data", () => {
  const original = fixture();
  const decoded = decodeFirstUseDiagnostic(original);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value, original);
  assert.notEqual(decoded.value.checks, original.checks);
  assert.notEqual(decoded.value.checks[0], original.checks[0]);
});

test("diagnostics reject invented success, missing or duplicate checks", () => {
  const good = fixture();
  const failed = { name: "storage", status: "failed", code: "io-failed" };
  for (const candidate of [
    { ...good, checks: [] },
    { ...good, checks: good.checks.slice(1) },
    { ...good, checks: [...good.checks, good.checks[0]] },
    {
      ...good,
      checks: good.checks.map(c => c.name === "storage" ? failed : c),
    },
    { ...good, outcome: "failed" },
  ]) assert.equal(decodeFirstUseDiagnostic(candidate).ok, false);
  assert.equal(decodeFirstUseDiagnostic({
    ...good,
    outcome: "failed",
    checks: good.checks.map(c => c.name === "storage" ? failed : c),
  }).ok, true);
});

test("diagnostics reject extensions, unsafe paths and malformed fields", () => {
  const good = fixture();
  for (const candidate of [
    null, [], "passed",
    { ...good, schemaVersion: 2 },
    { ...good, checkVersion: 2 },
    { ...good, at: "2026-10-07" },
    { ...good, at: "2026-02-30T00:00:00.000Z" },
    { ...good, log: "../arbitrary.json" },
    { ...good, password: "synthetic-extra-field" },
    { ...good, checks: [...good.checks, { name: "extra", status: "passed" }] },
    {
      ...good, checks: good.checks.map(c => ({ ...c, detail: "untrusted" })),
    },
    {
      ...good, checks: good.checks.map(c => ({ ...c, code: "unsafe/path" })),
    },
    {
      ...good, checks: good.checks.map(c => ({ ...c, status: "success" })),
    },
  ]) assert.equal(decodeFirstUseDiagnostic(candidate).ok, false);
});
