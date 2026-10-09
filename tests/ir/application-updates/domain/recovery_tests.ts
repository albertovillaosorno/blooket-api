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
//   - Exact local installation facts and admitted journal transitions.
// - Must-Not:
//   - Grant publisher trust, inspect files, launch apps, or install bundles.
// - Allows:
//   - Inputs: Unknown journal records and caller-selected next phases.
//   - Outputs: Exact decoded facts or bounded validation failures.
//   - Side effects: None.
// - Split-When:
//   - Another installation target needs a distinct persistence contract.
// - Merge-When:
//   - Installation facts no longer need durable recovery.
// - Summary:
//   - Records intent and observation without inferring installed health.
// - Description:
//   - Paths and signed envelopes cannot grant filesystem or trust authority.
// - Usage:
//   - Reassess local publisher trust, ownership, and health before any action.
// - Defaults:
//   - Invalid or contradictory records cannot authorize recovery.
//
import assert from "node:assert/strict";
import test from "node:test";
import { assessInstallationRecovery } from
  "../../../../src/ir/application-updates/domain/recovery.ts";
import type { InstallationPhase, ExchangeOrientation } from
  "../../../../src/ir/application-updates/contract/installation.ts";
import { journalFixture } from "../contract/fixtures.ts";

test("interrupted intent requires fresh health instead of another exchange",
  () => {
    const record = { ...journalFixture(), phase: "exchange-intent" };
    assert.equal(assessInstallationRecovery(record, "original", true),
      "check-old-health");
    assert.equal(assessInstallationRecovery(record, "exchanged", true),
      "check-new-health");
    assert.equal(assessInstallationRecovery(record, "exchanged", false),
      "wait-for-writer");
  });

test("health records never substitute for fresh process health", () => {
  const original = journalFixture();
  for (const phase of ["new-observed", "new-healthy"])
    assert.equal(assessInstallationRecovery({ ...original, phase },
      "exchanged", true), "check-new-health");
  for (const phase of ["old-observed", "old-healthy"])
    assert.equal(assessInstallationRecovery({ ...original, phase },
      "original", true), "check-old-health");
  assert.equal(assessInstallationRecovery({ ...original,
    phase: "rollback-intent" }, "original", true), "check-old-health");
  assert.equal(assessInstallationRecovery({ ...original,
    phase: "rollback-intent" }, "exchanged", true), "rollback-required");
});

test("unknown ownership and live writers stop every recovery phase", () => {
  const original = journalFixture();
  for (const phase of ["prepared", "exchange-intent", "new-observed",
    "new-healthy", "rollback-intent", "old-observed", "old-healthy"] as
    readonly InstallationPhase[]) {
    const record = { ...original, phase };
    assert.equal(assessInstallationRecovery(record, "unknown", true),
      "manual-recovery");
    for (const orientation of ["unknown", "original", "exchanged"] as const)
      assert.equal(assessInstallationRecovery(record, orientation, false),
        "wait-for-writer");
  }
  assert.equal(assessInstallationRecovery(null, "original", true),
    "invalid-journal");
  assert.equal(assessInstallationRecovery(original, "original", true),
    "assess-candidate");
  assert.equal(assessInstallationRecovery(original,
    "unrecognized" as ExchangeOrientation, true), "manual-recovery");
  assert.equal(assessInstallationRecovery(original, "exchanged", true),
    "manual-recovery");
});
