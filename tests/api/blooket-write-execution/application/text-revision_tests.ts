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
import { mkdtemp, readFile, readdir, rm, writeFile } from
  "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeTextRevision,
  reconcileUnchangedMetadataTextRevision } from
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

test("local metadata reconciliation uses two fresh reads without any Save",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "text-title-reconcile-"));
    let saves = 0, reads = 0;
    const host = { root, pacer: { acquire: async () => ({ ok: true,
      lease: { startedAtMs: 0, release() {} } }) },
      textRevision: { revise: async () => {
        saves++;
        return { outcome: "uncertain" };
      } } } as BlooketPublicationDependencies;
    const reconcile = { ...command,
      command: "blooket.publication.reconcile-text" };
    const fresh = async () => ({
      operationId: `cli:00000000-0000-4000-8000-00000000000${++reads}`,
      metadata: payload.expectedSet,
    });
    try {
      assert.equal((await executeTextRevision(command, host)).ok, false);
      const result = await reconcileUnchangedMetadataTextRevision(
        reconcile, root, fresh);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.issues[0]?.code,
        "text-revision-reconciled-unchanged");
      assert.equal(reads, 2);
      assert.equal(saves, 1);
      const blocked = await reconcileUnchangedMetadataTextRevision(
        reconcile, root, fresh);
      assert.equal(blocked.ok, false);
      assert.equal(reads, 2, "Reconciled journal cannot be rearmed again");
      assert.equal((await executeTextRevision(command, host)).ok, false);
      assert.equal(saves, 2, "Only a separate paced call may Save again");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("metadata reconciliation refuses conflicting provider observations",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "text-title-conflict-"));
    const host = { root, pacer: { acquire: async () => ({ ok: true,
      lease: { startedAtMs: 0, release() {} } }) },
      textRevision: { revise: async () => ({ outcome: "uncertain" }) },
    } as BlooketPublicationDependencies;
    const reconcile = { ...command,
      command: "blooket.publication.reconcile-text" };
    let reads = 0;
    const fresh = async () => ({
      operationId: `cli:00000000-0000-4000-8000-00000000000${++reads}`,
      metadata: reads === 2 ? { ...payload.expectedSet,
        description: "Someone else changed this" } : payload.expectedSet,
    });
    try {
      assert.equal((await executeTextRevision(command, host)).ok, false);
      assert.equal((await reconcileUnchangedMetadataTextRevision(
        reconcile, root, fresh)).ok, false);
      assert.equal(reads, 2);
      const later = await executeTextRevision({ ...command,
        payload: { ...payload,
          change: { kind: "set-title", title: "Conflicting change" } } }, host);
      assert.equal(later.ok, false,
        "An unchanged-looking first read cannot clear another attempt");
    } finally { await rm(root, { recursive: true, force: true }); }
  });


test("metadata reconciliation rejects a repeated fresh-read identity",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "text-title-reused-read-"));
    let reads = 0, saves = 0;
    const host = { root, pacer: { acquire: async () => ({ ok: true,
      lease: { startedAtMs: 0, release() {} } }) },
      textRevision: { revise: async () => {
        saves++;
        return { outcome: "uncertain" };
      } } } as BlooketPublicationDependencies;
    const reconcile = { ...command,
      command: "blooket.publication.reconcile-text" };
    const fresh = async () => {
      reads++;
      return { operationId: "cli:00000000-0000-4000-8000-000000000001",
        metadata: payload.expectedSet };
    };
    try {
      assert.equal((await executeTextRevision(command, host)).ok, false);
      const result = await reconcileUnchangedMetadataTextRevision(
        reconcile, root, fresh);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.issues[0]?.code,
        "text-revision-reconciliation-required");
      assert.equal(reads, 2);
      const changed = { ...command, payload: { ...payload,
        change: { kind: "set-title", title: "Another title" } } };
      assert.equal((await executeTextRevision(changed, host)).ok, false);
      assert.equal(saves, 1,
        "A repeated read identity must never re-arm the uncertain Save");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("metadata reconciliation preserves a journal changed between reads",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "text-title-journal-race-"));
    let reads = 0, saves = 0;
    const host = { root, pacer: { acquire: async () => ({ ok: true,
      lease: { startedAtMs: 0, release() {} } }) },
      textRevision: { revise: async () => {
        saves++;
        return { outcome: "uncertain" };
      } } } as BlooketPublicationDependencies;
    const reconcile = { ...command,
      command: "blooket.publication.reconcile-text" };
    try {
      assert.equal((await executeTextRevision(command, host)).ok, false);
      const directory = join(root, "text-revisions");
      const [setKey] = await readdir(directory);
      assert.ok(setKey);
      const [filename] = await readdir(join(directory, setKey));
      assert.ok(filename);
      const path = join(directory, setKey, filename);
      const first = await readFile(path, "utf8");
      const fresh = async () => {
        reads++;
        if (reads === 2) {
          const saved = JSON.parse(first);
          saved.history = [{ outcome: "unchanged",
            at: "2026-10-29T19:00:00.000Z" }];
          await writeFile(path, JSON.stringify(saved) + "\n");
        }
        return {
          operationId: `cli:00000000-0000-4000-8000-00000000000${reads}`,
          metadata: payload.expectedSet,
        };
      };
      const result = await reconcileUnchangedMetadataTextRevision(
        reconcile, root, fresh);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.issues[0]?.code,
        "text-revision-reconciliation-required");
      assert.equal(reads, 2);
      assert.equal(JSON.parse(await readFile(path, "utf8")).phase,
        "attempting", "A changed journal cannot be promoted to ready");
      const changed = { ...command, payload: { ...payload,
        change: { kind: "set-title", title: "Another title" } } };
      assert.equal((await executeTextRevision(changed, host)).ok, false);
      assert.equal(saves, 1, "No Save follows a changed attempt journal");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
