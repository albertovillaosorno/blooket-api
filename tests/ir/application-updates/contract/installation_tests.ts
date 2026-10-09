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
import { decodeUpdateInstallationJournal, advanceUpdateInstallationJournal,
  type InstallationPhase } from
  "../../../../src/ir/application-updates/contract/installation.ts";
import { journalFixture } from "./fixtures.ts";

test("installation facts round-trip without sharing mutable inputs", () => {
  const original = journalFixture();
  const decoded = decodeUpdateInstallationJournal(original);
  assert.ok(decoded.ok);
  assert.deepEqual(decoded.value, original);
  assert.notEqual(decoded.value.document, original.document);
  assert.notEqual(decoded.value.installedIdentity, original.installedIdentity);
});

test("contradictory identity, versions, paths, or envelopes are refused",
  () => {
  const item = journalFixture();
  for (const value of [null, {}, { ...item, unknown: true },
    { ...item, schemaVersion: 2 }, { ...item, phase: "installed" },
    { ...item, installedVersion: "26.4.1" },
    { ...item, installedVersion: "26.4.2" },
    { ...item, installationId: item.installationId.toUpperCase() },
    { ...item, installedPath: "/Applications/../Blooket API.app" },
    { ...item, candidatePath: item.installedPath },
    { ...item, candidatePath: item.candidatePath.replace("aaaa", "bbbb") },
    { ...item, installedIdentity: { device: "01", inode: "2" } },
    { ...item, candidateIdentity: { device: "2", inode: "3" } },
    { ...item, candidateIdentity: item.installedIdentity },
    { ...item, candidateIdentity: { device: "1", inode: "0" } },
    { ...item, candidateIdentity: { device: "1", inode: "3", unknown: 1 } },
    { ...item, document: { ...item.document, signature: "unknown" } },
    { ...item, document: { ...item.document, unknown: true } }])
    assert.equal(decodeUpdateInstallationJournal(value).ok, false);
});

test("health and rollback require durable intent and ownership observations",
  () => {
    for (const path of [
      ["exchange-intent", "new-observed", "new-healthy"],
      ["exchange-intent", "new-observed", "rollback-intent",
        "old-observed", "old-healthy"],
      ["exchange-intent", "old-observed", "old-healthy"],
    ] as const) {
      let record = journalFixture();
      for (const phase of path) {
        const next = advanceUpdateInstallationJournal(record, phase);
        assert.ok(next.ok);
        assert.equal(next.value.phase, phase);
        assert.equal(record.phase === phase, false);
        record = next.value;
      }
    }
    const record = journalFixture();
    for (const phase of ["new-healthy", "new-observed", "old-healthy",
      "rollback-intent", "prepared", "unrecognized"])
      assert.equal(advanceUpdateInstallationJournal(record,
        phase as InstallationPhase).ok, false);
    assert.equal(advanceUpdateInstallationJournal(null, "prepared").ok, false);
  });
