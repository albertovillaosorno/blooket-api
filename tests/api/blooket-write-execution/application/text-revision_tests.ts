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
//   - Paced and journaled correction of one existing quiz text field.
// - Must-Not:
//   - Blindly replay uncertain Saves, alter media, or invent persistence.
// - Allows:
//   - Inputs: One exact revision and service-owned browser execution ports.
//   - Outputs: Verified completion or a recoverable stop with journal ID.
//   - Side effects: Durable history and at most one Save per admission.
// - Split-When:
//   - Multi-operation revisions require an independent state machine.
// - Merge-When:
//   - All existing-set editing shares a canonical journal implementation.
// - Summary:
//   - Reconciliation does not Save; exact unchanged rows may re-arm.
// - Description:
//   - Exact input hashes bind recovery to original and desired text.
// - Usage:
//   - Execute behind the canonical local command boundary.
// - Defaults:
//   - Unknown storage, pending edits and missing browser support stop.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeTextRevision } from
  "../../../../src/api/blooket-write-execution/application/text-revision.ts";
import type { BlooketPublicationDependencies } from
  "../../../../src/api/blooket-write-execution/application/command.ts";
import type { BlooketTextRevision } from
  "../../../../src/ir/blooket-publication-commands/contract/text-revision.ts";

const payload: BlooketTextRevision = { schemaVersion: 1,
  expectedSet: { schemaVersion: 1, id: "fixture", title: "Old title",
    description: "Retain", visibility: "private" },
  change: { kind: "set-title", title: "B.1.01 - Lesson 1 Vocabulary" } };
const command = { version: 1 as const, operationId: "test:text-revision",
  command: "blooket.publication.revise-text", payload };

test("a lost revision reply reconciles the same request without another Save",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "text-revision-journal-"));
    const calls: boolean[] = [];
    let release = 0;
    const host = { root, pacer: { acquire: async () => ({ ok: true,
      lease: { startedAtMs: 0, release: () => { release++; } } }) },
      textRevision: { revise: async (_request: BlooketTextRevision,
        verifyOnly: boolean) => {
        calls.push(verifyOnly);
        return { outcome: verifyOnly ? "verified" : "uncertain" };
      } } } as BlooketPublicationDependencies;
    try {
      assert.equal((await executeTextRevision(command, host)).ok, false);
      const other = { ...command, payload: { ...payload,
        change: { kind: "set-title", title: "Another title" } } };
      const blocked = await executeTextRevision(other, host);
      assert.equal(blocked.ok, false);
      assert.deepEqual(calls, [false]);
      const recovered = await executeTextRevision(command, host);
      assert.equal(recovered.ok, true);
      assert.deepEqual(calls, [false, true]);
      assert.equal(release, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("an explicitly refused Save keeps a safe retry checkpoint",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "text-revision-refused-"));
    let calls = 0;
    const host = { root, pacer: { acquire: async () => ({ ok: true,
      lease: { startedAtMs: 0, release() {} } }) },
      textRevision: { revise: async (_request: BlooketTextRevision,
        verifyOnly: boolean) => {
        assert.equal(verifyOnly, false);
        return { outcome: ++calls === 1 ? "not-submitted" : "verified" };
      } } } as BlooketPublicationDependencies;
    try {
      assert.equal((await executeTextRevision(command, host)).ok, false);
      assert.equal((await executeTextRevision(command, host)).ok, true);
      assert.equal(calls, 2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("confirmed unchanged recovery stops before a separate paced admission",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "text-revision-unchanged-"));
    const calls: boolean[] = [];
    const correction = { ...command, payload: { ...payload, change: {
      kind: "question-text", previous: { schemaVersion: 4, number: 1,
        question: "Before", equation: null, qType: "mc", random: true,
        timeLimit: 20, hasImage: false, imageEvidence: null, hasAudio: false,
        answers: [{ kind: "text", content: "Yes", correct: true, match: null },
          { kind: "text", content: "No", correct: false, match: null }] },
      question: "After?", answers: ["Yes", "No"],
    } } };
    const host = { root, pacer: { acquire: async () => ({ ok: true,
      lease: { startedAtMs: 0, release() {} } }) },
      textRevision: { revise: async (_input: unknown, verifyOnly: boolean) => {
        calls.push(verifyOnly);
        return { outcome: calls.length === 1 ? "uncertain" :
          verifyOnly ? "unchanged" : "verified" };
      } } } as BlooketPublicationDependencies;
    try {
      assert.equal((await executeTextRevision(correction, host)).ok, false);
      const reconciled = await executeTextRevision(correction, host);
      assert.equal(reconciled.ok, false);
      if (!reconciled.ok) assert.equal(reconciled.issues[0]?.code,
        "text-revision-reconciled-unchanged");
      assert.deepEqual(calls, [false, true]);
      assert.equal((await executeTextRevision(correction, host)).ok, true);
      assert.deepEqual(calls, [false, true, false]);
      // A later original-looking row cannot invalidate a verified receipt
      // and silently re-arm an already completed correction.
      assert.equal((await executeTextRevision(correction, host)).ok, false);
      assert.equal((await executeTextRevision(correction, host)).ok, false);
      assert.deepEqual(calls, [false, true, false, true, true]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
