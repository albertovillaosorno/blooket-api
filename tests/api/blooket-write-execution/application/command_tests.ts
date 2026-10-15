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
//   - Journaled draft publication, recovery, and final verification coverage.
// - Must-Not:
//   - Expose configuration through the online MCP gateway.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Journaled draft publication, recovery, and final verification coverage.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, mkdir, writeFile } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { executeBlooketPublicationCommand,
  type BlooketPublicationDependencies } from
  "../../../../src/api/blooket-write-execution/application/command.ts";
import { executeLibraryCommand } from
  "../../../../src/api/teacher-library/application/library.ts";
import { createBlooketMutationPacer } from
  "../../../../src/api/blooket-write-execution/application/mutation-pacing.ts";
import { lowerBlooketWriteSubmission } from
  "../../../../src/api/blooket-write-execution/application/lower-submission.ts";
import { blooketBrowserWriteExecutionPort } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/browser-write-adapter.ts";
import { buildBlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";
import type { BlooketQuestionRead } from
  "../../../../src/ir/blooket-question-reads/contract/question-read.ts";
import type { BlooketSetDetail } from
  "../../../../src/ir/blooket-set-reads/contract/set-read.ts";
import { reserveMutationBudgetStart, loadMutationBudgetFile } from
  "../../../../src/platforms/mutation-budget-files/adapter-outbound/file.ts";
import { publicationFiles, createPublicationSnapshot } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/write-checkpoint-files/adapter-outbound/publication.ts";
import { beginWriteAttempt, confirmWriteAttempt } from
  "../../../../src/platforms/write-attempt-files/adapter-outbound/file.ts";

import { identifyPreparedMedia } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/projects/blooket-write-plans/domain/prepared-media-identities.ts";
import { decodeBlooketPublicationSnapshot } from
  "../../../../src/projects/blooket-write-plans/domain/publication-snapshot.ts";
import { executePersistedBlooketWrite } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/execute-persisted.ts";
import { blooketSetReadWriteVerifier } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/set-read-verifier.ts";
import { acquireUpdatePublicationBoundary } from
  "../../../../src/api/application-updates/application/publication-boundary.ts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const capabilities = JSON.parse(await readFile(new URL(
  "../../../ir/capability-snapshots/contract/" +
    "blooket-official-2026-10-05.json", import.meta.url,
), "utf8"));
const document = {
  schemaVersion: 1, title: "Synthetic publication", description: "Fixture",
  quizLanguage: "English", visibility: "private", mediaIndex: "media.jsonl",
  coverImage: null,
  questions: [{
    id: "q1", type: "typing-answer", prompt: "Type sun.",
    timeLimitSeconds: 10, image: null, matchMode: "contains", answer: "sun",
  }],
};
const command = (action: string, expectedRevision?: string) => ({
  version: 1 as const, operationId: "cli:publication-fixture",
  command: "blooket.publication." + action,
  payload: { draftId: "fixture", ...(expectedRevision
    ? { expectedRevision } : {}) },
});
async function fixture(work: (state: Awaited<ReturnType<typeof state>>) =>
  Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "publication-command-"));
  try { await work(await state(root)); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function state(root: string) {
  let remote: BlooketSetDetail | undefined;
  const questions: BlooketQuestionRead[] = [];
  let writes = 0, capabilityReads = 0, sessionState = "my-sets";
  const capabilityPurposes: ("text-publication" | undefined)[] = [];
  let ambiguous = false;
  let clock = 0;
  const secret = async (): Promise<never> => {
    throw new Error("No credential access in this fixture.");
  };
  const host: BlooketPublicationDependencies = {
    root,
    pacer: createBlooketMutationPacer(undefined, {
      now: () => clock, sleep: async ms => { clock += ms; },
    }),
    blooket: {
      secrets: { read: secret, write: secret, delete: secret },
      session: {
        observe: async () => ({ ok: true,
          state: sessionState as "my-sets" | "security-challenge" }),
        authenticate: secret,
      },
      capabilities: { inspect: async purpose => {
        capabilityReads++;
        capabilityPurposes.push(purpose);
        return { ok: true, value: capabilities };
      } },
      sets: {
        list: async () => ({ ok: true,
          completeness: remote ? "unknown" : "complete",
          value: remote ? [{ schemaVersion: 1, id: remote.id,
            title: remote.title }] : [],
        }),
        get: async () => ({ ok: true, value: remote }),
      },
      questions: { list: async () => ({ ok: true,
        value: structuredClone(questions) }) },
    },
    writes: { execute: async (operation, target, context) => {
      writes++;
      if (ambiguous) return { ok: false,
        kind: "browser", code: "blooket-browser-failed" };
      if (operation.kind === "set") {
        remote = { schemaVersion: 1, id: "synthetic-remote",
          title: operation.title, description: operation.description,
          visibility: operation.visibility };
        return { ok: true, receipt: { kind: "set-created",
          remoteSetId: remote.id } };
      }
      const lowered = lowerBlooketWriteSubmission(operation, target);
      assert.ok(lowered.ok && lowered.value.kind === "add-question");
      if (!lowered.ok || lowered.value.kind !== "add-question")
        throw new Error("fixture lowering failed");
      const expected = lowered.value;
      const preparedImage = context.preparedMedia[0];
      const image = preparedImage && identifyPreparedMedia(preparedImage);
      questions.push({ ...(image ? { schemaVersion: 4 as const,
          imageEvidence: { byteLength: image.byteLength,
            sha256: image.sha256 } } : { schemaVersion: 3 as const }),
        number: expected.number,
        question: expected.question, equation: null, qType: expected.qType,
        random: expected.random, timeLimit: expected.timeLimit,
        answers: expected.answers.map((answer, index) => {
          assert.equal(answer.kind, "text");
          return { kind: "text", content: answer.kind === "text"
            ? answer.text : null, correct: answer.correct,
            match: expected.answerTypes?.[index] ?? null };
        }),
        hasImage: image !== undefined, hasAudio: false,
      });
      return { ok: true, receipt: null };
    } },
  };
  const saved = await executeLibraryCommand({
    version: 1, operationId: "cli:fixture-draft", command: "drafts.put",
    payload: { id: "fixture", document, expectedRevision: null },
  }, root);
  assert.ok(saved.ok);
  const revision = (saved.value as { revision: string }).revision;
  return { root, host, revision, questions,
    writes: () => writes, capabilities: () => capabilityReads,
    capabilityPurposes: () => capabilityPurposes,
    ambiguous: (value: boolean) => { ambiguous = value; },
    session: (value: string) => { sessionState = value; },
  };
}
function value(result: Awaited<ReturnType<
  typeof executeBlooketPublicationCommand>>) {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value as Record<string, unknown>;
}

function browserHost(fixtureState: Awaited<ReturnType<typeof state>>,
  loseCreationReceipt = false,
  confirmationSupported = true): BlooketPublicationDependencies {
  const built = buildBlooketWritePlan(JSON.stringify(document), "",
    capabilities);
  assert.ok(built.ok);
  const host = fixtureState.host;
  return { ...host, blooket: { ...host.blooket, sets: {
    ...host.blooket.sets,
    list: async () => {
      const listed = await host.blooket.sets.list();
      assert.ok(listed.ok && Array.isArray(listed.value));
      return { ok: true, completeness: "unknown", value: [
        { schemaVersion: 1, id: "other-owned-set", title: "Other lesson" },
        ...listed.value,
      ] };
    },
  } }, writes: blooketBrowserWriteExecutionPort({
    inspectCreateSetConfirmation: async () => confirmationSupported,
    createSet: async (submission, media) => {
      const operation = built.value.operations[0]!;
      assert.equal(operation.kind, "set");
      const lowered = lowerBlooketWriteSubmission(operation,
        { remoteSetId: null });
      assert.ok(lowered.ok);
      assert.deepEqual(submission, lowered.value);
      const result = await host.writes.execute(operation, { remoteSetId: null },
        { preparedMedia: media });
      if (!result.ok) return result;
      assert.ok(result.receipt?.kind === "set-created");
      return loseCreationReceipt ? { ok: false, kind: "browser",
        code: "blooket-browser-failed" } : { ok: true,
        remoteSetId: result.receipt.remoteSetId };
    },
    addQuestion: async (submission, media) => {
      const operation = built.value.operations[1]!;
      const target = { remoteSetId: submission.remoteSetId };
      const lowered = lowerBlooketWriteSubmission(operation, target);
      assert.ok(lowered.ok);
      assert.deepEqual(submission, lowered.value);
      const result = await host.writes.execute(operation, target,
        { preparedMedia: media });
      return result.ok ? { ok: true } : result;
    },
  }) };
}

test("missing text-capability worker cannot begin publication",
  async () => { await fixture(async state => {
    const host = { ...state.host, blooket: { ...state.host.blooket,
      capabilities: { inspect: async purpose => {
        assert.equal(purpose, "text-publication");
        return { ok: false as const,
          code: "blooket-browser-failed" as const };
      } },
    } };
    const result = await executeBlooketPublicationCommand(
      command("step", state.revision), host);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issues[0]?.code,
      "blooket-browser-failed");
    assert.equal(state.writes(), 0);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.snapshot));
    await assert.rejects(readFile(files.attempt));
    await assert.rejects(readFile(files.budget));
  }); });

test("old browser confirmation stops before a new attempt or budget",
  async () => { await fixture(async state => {
    const host = browserHost(state, false, false);
    const result = await executeBlooketPublicationCommand(
      command("step", state.revision), host);
    assert.ok(!result.ok);
    assert.equal(result.issues[0]?.code,
      "blooket-browser-companion-update-required");
    assert.equal(state.writes(), 0);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.attempt));
    await assert.rejects(readFile(files.budget));
  }); });

test("confirmed browser creation uses an explicitly partial observation",
  async () => { await fixture(async state => {
    const host = browserHost(state);
    const first = value(await executeBlooketPublicationCommand(
      command("step", state.revision), host));
    assert.equal(first["completedOperations"], 1);
    assert.equal(first["remoteSetId"], "synthetic-remote");
    assert.equal(state.writes(), 1);
    const second = value(await executeBlooketPublicationCommand(
      command("step", state.revision), host));
    assert.equal(second["completedOperations"], 2);
    const verified = value(await executeBlooketPublicationCommand(
      command("verify"), host));
    assert.equal(verified["published"], true);
    await executeBlooketPublicationCommand(command("step", state.revision),
      host);
    assert.equal(state.writes(), 2);
    const listed = await host.blooket.sets.list();
    assert.ok(listed.ok);
    assert.equal(listed.completeness, "unknown");
  }); });

test("lost browser creation receipt stays ambiguous despite a visible new set",
  async () => { await fixture(async state => {
    const host = browserHost(state, true);
    const first = value(await executeBlooketPublicationCommand(
      command("step", state.revision), host));
    assert.equal(first["phase"], "reconciliation-required");
    assert.equal(first["completedOperations"], 0);
    assert.equal(state.writes(), 1);
    const files = await publicationFiles(state.root, "fixture");
    const original = await readFile(files.attempt, "utf8");
    const record = JSON.parse(original);
    assert.equal(record.baseline.kind, "set-observation");
    assert.equal(record.baseline.itemCount, 1);
    const reconciled = value(await executeBlooketPublicationCommand(
      command("reconcile"), host));
    assert.equal(reconciled["phase"], "reconciliation-required");
    assert.equal(reconciled["reason"], "verification-inconclusive");
    await executeBlooketPublicationCommand(command("step", state.revision),
      host);
    assert.equal(state.writes(), 1);
    assert.equal(await readFile(files.attempt, "utf8"), original);
  }); });

test("browser creation rechecks observed changes after pacing before mutation",
  async () => { await fixture(async state => {
    const host = browserHost(state);
    const list = host.blooket.sets.list;
    let changed = false;
    const guarded = { ...host, blooket: { ...host.blooket,
      sets: { ...host.blooket.sets, list: async () => {
        const result = await list();
        assert.ok(result.ok && Array.isArray(result.value));
        return { ...result, value: changed ? [...result.value,
          { schemaVersion: 1, id: "new-other", title: "Another lesson" }]
          : result.value };
      } },
    }, pacer: { acquire: async () => {
      changed = true;
      return { ok: true as const, lease: { startedAtMs: 0,
        release: () => undefined } };
    } } };
    const result = await executeBlooketPublicationCommand(
      command("step", state.revision), guarded);
    assert.ok(!result.ok);
    assert.equal(result.issues[0]?.code, "blooket-remote-state-changed");
    assert.equal(state.writes(), 0);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.attempt));
    await assert.rejects(readFile(files.budget));
  }); });

test("each draft step writes once and requires separate fresh verification",
  async () => { await fixture(async state => {
    const initial = value(await executeBlooketPublicationCommand(
      command("status"), state.host,
    ));
    assert.equal(initial["phase"], "not-started");
    assert.equal(state.capabilities(), 0);
    const first = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(first["completedOperations"], 1);
    assert.equal(first["published"], false);
    assert.equal(state.writes(), 1);
    const second = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(second["completedOperations"], 2);
    assert.equal(second["published"], false);
    assert.equal(state.writes(), 2);
    assert.deepEqual(state.capabilityPurposes(), [
      "text-publication", "text-publication",
    ]);
    const status = value(await executeBlooketPublicationCommand(
      command("status"), state.host,
    ));
    assert.equal(status["phase"], "writes-complete");
    const verified = value(await executeBlooketPublicationCommand(
      command("verify"), state.host,
    ));
    assert.equal(verified["published"], true);
    assert.equal(verified["phase"], "verified");
    await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    );
    assert.equal(state.writes(), 2);
    state.questions[0] = { ...state.questions[0]!, timeLimit: 11 };
    const changed = await executeBlooketPublicationCommand(
      command("verify"), state.host,
    );
    assert.ok(!changed.ok);
    assert.equal(changed.issues[0]?.code,
      "blooket-publication-remote-conflict");
  }); });

test("injected malformed publication policy cannot start a remote write",
  async () => { await fixture(async state => {
  const base = { minimumStartIntervalMs: 2_000,
    maximumStartsPerMinute: 20, maximumTaskStarts: 2,
    maximumTaskDurationMs: 60_000 };
  for (const policy of [
    { ...base, maximumTaskStarts: 0 },
    { ...base, maximumTaskDurationMs: 30_000 },
    { ...base, unexpected: true },
  ]) {
    const attempt = await executeBlooketPublicationCommand(
      command("step", state.revision), {
        ...state.host,
        publicationPolicy: policy,
      });
    assert.equal(attempt.ok, false);
    if (attempt.ok) continue;
    assert.equal(attempt.issues[0]?.code, "invalid-publication-policy");
    assert.equal(state.writes(), 0);
  }
  let getters = 0;
  const accessors = { ...base };
  Object.defineProperty(accessors, "maximumTaskStarts", {
    enumerable: true,
    get() { getters++; throw Error("private synthetic state"); },
  });
  const stopped = await executeBlooketPublicationCommand(
    command("step", state.revision), {
      ...state.host, publicationPolicy: accessors,
    });
  assert.equal(stopped.ok, false);
  assert.equal(getters, 0);
  const files = await publicationFiles(state.root, "fixture");
  await assert.rejects(readFile(files.snapshot));
  await assert.rejects(readFile(files.attempt));
  await assert.rejects(readFile(files.budget));
  }); },
);

test("configured task start limit stops before a second journal or write",
  async () => { await fixture(async state => {
    const configured: BlooketPublicationDependencies = {
      ...state.host,
      publicationPolicy: {
        minimumStartIntervalMs: 2_000,
        maximumStartsPerMinute: 20,
        maximumTaskStarts: 1,
        maximumTaskDurationMs: 86_400_000,
      },
    };
    const initial = await executeBlooketPublicationCommand(
      command("step", state.revision), configured);
    assert.equal(initial.ok, true);
    assert.equal(state.writes(), 1);
    const second = await executeBlooketPublicationCommand(
      command("step", state.revision), configured);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.issues[0]?.code,
      "mutation-task-start-budget-exhausted");
    assert.equal(state.writes(), 1);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.attempt));
    // Simulate an explicitly restarted service with a higher admitted task
    // limit. The original plan/checkpoint/budget must resume without another
    // Create Set; the failed second step left no uncertain journal.
    const resumed: BlooketPublicationDependencies = {
      ...configured,
      publicationPolicy: { ...configured.publicationPolicy!,
        maximumTaskStarts: 2 },
    };
    const advanced = value(await executeBlooketPublicationCommand(
      command("step", state.revision), resumed));
    assert.equal(advanced["completedOperations"], 2);
    assert.equal(state.writes(), 2);
    assert.equal(value(await executeBlooketPublicationCommand(
      command("verify"), resumed))["published"], true);
    await assert.rejects(readFile(files.attempt));
  }); },
);

test("configured task duration stops before journal after elapsed budget",
  async () => { await fixture(async state => {
  const configured: BlooketPublicationDependencies = {
    ...state.host,
    publicationPolicy: {
      minimumStartIntervalMs: 2_000,
      maximumStartsPerMinute: 20,
      maximumTaskStarts: 10,
      maximumTaskDurationMs: 60_000,
    },
  };
  const built = buildBlooketWritePlan(JSON.stringify(document), "",
    capabilities);
  assert.ok(built.ok);
  if (!built.ok) return;
  const files = await publicationFiles(state.root, "fixture");
  const previous = await reserveMutationBudgetStart(files.budget,
    built.value.planId, {
      maximumStarts: 10, maximumDurationMs: 86_400_000,
    }, Date.now() - 120_000);
  assert.equal(previous.ok, true);
  const expired = await executeBlooketPublicationCommand(
    command("step", state.revision), configured);
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.equal(expired.issues[0]?.code,
    "mutation-task-duration-exhausted");
  assert.equal(state.writes(), 0);
  assert.deepEqual(await loadMutationBudgetFile(files.budget,
    built.value.planId), previous);
  await assert.rejects(readFile(files.attempt));
  }); },
);

test("uncertain writes stay journaled even after an empty read-back",
  async () => { await fixture(async state => {
    state.ambiguous(true);
    const first = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(first["phase"], "reconciliation-required");
    assert.equal(first["reason"], "write-not-confirmed");
    const files = await publicationFiles(state.root, "fixture");
    const journal = await readFile(files.attempt, "utf8");
    await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    );
    assert.equal(state.writes(), 1);
    assert.equal(await readFile(files.attempt, "utf8"), journal);
    const reconciled = value(await executeBlooketPublicationCommand(
      command("reconcile"), state.host,
    ));
    assert.equal(reconciled["completedOperations"], 0);
    assert.equal(reconciled["phase"], "reconciliation-required");
    assert.equal(reconciled["reason"], "verification-inconclusive");
    assert.equal(state.writes(), 1);
    state.ambiguous(false);
    const next = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(next["phase"], "reconciliation-required");
    assert.equal(state.writes(), 1);
    assert.equal(await readFile(files.attempt, "utf8"), journal);
  }); });

test("a rate-limited attempted write reports the stop without replay",
  async () => { await fixture(async state => {
    const created = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(created["completedOperations"], 1);
    let attempted = 0;
    const host = { ...state.host, writes: { execute: async () => {
      attempted++;
      return { ok: false as const, kind: "navigation" as const,
        state: "rate-limited" as const };
    } } };
    const stopped = value(await executeBlooketPublicationCommand(
      command("step", state.revision), host,
    ));
    assert.equal(stopped["phase"], "reconciliation-required");
    assert.equal(stopped["state"], "rate-limited");
    assert.equal(stopped["completedOperations"], 1);
    assert.equal(stopped["published"], false);
    const files = await publicationFiles(state.root, "fixture");
    const journal = await readFile(files.attempt, "utf8");
    const again = value(await executeBlooketPublicationCommand(
      command("step", state.revision), host,
    ));
    assert.equal(again["phase"], "reconciliation-required");
    assert.equal(attempted, 1);
    assert.equal(await readFile(files.attempt, "utf8"), journal);
  }); });

test("unknown collection stops new publication and preserves legacy recovery",
  async () => { await fixture(async state => {
    let mutations = 0;
    const host = { ...state.host, blooket: { ...state.host.blooket,
      sets: { ...state.host.blooket.sets,
        list: async () => ({ ok: true as const,
          completeness: "unknown" as const, value: [] }),
      },
    }, writes: { execute: async (...args:
      Parameters<typeof state.host.writes.execute>) => {
      mutations++;
      await state.host.writes.execute(...args);
      return { ok: false as const, kind: "browser" as const,
        code: "blooket-browser-failed" as const };
    } } };
    const attempted = await executeBlooketPublicationCommand(
      command("step", state.revision), host,
    );
    assert.ok(!attempted.ok);
    assert.equal(attempted.issues[0]?.code,
      "blooket-write-baseline-not-captured");
    assert.match(attempted.issues[0]?.message ?? "",
      /before sending a new write/u);
    assert.equal(mutations, 0);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.attempt));
    await assert.rejects(readFile(files.budget));
    await assert.rejects(readFile(files.checkpoint));
    // An older version could have dispatched without a baseline. Such
    // evidence still needs reconciliation; upgrading never authorizes replay.
    const source = JSON.parse(await readFile(files.snapshot, "utf8"));
    const decoded = decodeBlooketPublicationSnapshot(source, "fixture");
    assert.ok(decoded);
    const begun = await beginWriteAttempt(files.attempt, decoded.plan, 0);
    assert.ok(begun.ok);
    const original = await readFile(files.attempt, "utf8");
    const pending = value(await executeBlooketPublicationCommand(
      command("status"), host,
    ));
    assert.equal(pending["reason"], "baseline-unavailable");
    assert.equal(mutations, 0);
    const result = value(await executeBlooketPublicationCommand(
      command("reconcile"), host,
    ));
    assert.equal(result["phase"], "reconciliation-required");
    assert.equal(result["reason"], "verification-inconclusive");
    assert.equal(result["completedOperations"], 0);
    assert.equal(mutations, 0);
    assert.equal(await readFile(files.attempt, "utf8"), original);
  }); },
);

test("a visible preexisting identical set blocks duplicate creation",
  async () => { await fixture(async state => {
    const host = { ...state.host, blooket: {
      ...state.host.blooket, sets: {
        ...state.host.blooket.sets,
        list: async () => ({ ok: true as const,
          completeness: "unknown" as const,
          value: [{ schemaVersion: 1 as const, id: "other-owned-set",
            title: document.title }] }),
        get: async () => ({ ok: true as const, value: {
          schemaVersion: 1 as const, id: "other-owned-set",
          title: document.title, description: document.description,
          visibility: "private" as const,
        } }),
      },
    } };
    const conflict = await executeBlooketPublicationCommand(
      command("step", state.revision), host,
    );
    assert.ok(!conflict.ok);
    assert.equal(conflict.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.equal(state.writes(), 0);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.attempt));
  }); },
);

test("a different set with the same title does not impersonate a match",
  async () => { await fixture(async state => {
    const host = { ...state.host, blooket: {
      ...state.host.blooket, sets: {
        ...state.host.blooket.sets,
        list: async () => ({ ok: true as const,
          completeness: "complete" as const,
          value: [{ schemaVersion: 1 as const, id: "unrelated-set",
            title: document.title }] }),
        get: async () => ({ ok: true as const, value: {
          schemaVersion: 1 as const, id: "unrelated-set",
          title: document.title,
          description: "A different teacher-authored lesson",
          visibility: "public" as const,
        } }),
      },
    } };
    const result = value(await executeBlooketPublicationCommand(
      command("step", state.revision), host,
    ));
    assert.equal(result["completedOperations"], 1);
    assert.equal(state.writes(), 1);
  }); },
);

test("question writes refuse a private quiz changed to public",
  async () => { await fixture(async state => {
    const initial = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(initial["completedOperations"], 1);
    const publiclyChanged = { ...state.host, blooket: {
      ...state.host.blooket, sets: { ...state.host.blooket.sets,
        get: async () => ({ ok: true as const, value: {
          schemaVersion: 1 as const, id: "synthetic-remote",
          title: document.title, description: document.description,
          visibility: "public" as const,
        } }),
      },
    } };
    const stop = await executeBlooketPublicationCommand(
      command("step", state.revision), publiclyChanged,
    );
    assert.ok(!stop.ok);
    assert.equal(stop.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.equal(state.writes(), 1);
    const paths = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(paths.attempt));
  }); },
);

test("question writes refuse a changed or unrelated remote set",
  async () => { await fixture(async state => {
    const first = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(first["completedOperations"], 1);
    assert.equal(state.writes(), 1);
    const changed = { ...state.host, blooket: {
      ...state.host.blooket, sets: { ...state.host.blooket.sets,
        get: async () => ({ ok: true as const, value: {
          schemaVersion: 1 as const, id: "synthetic-remote",
          title: "An unrelated teacher set", description: "Fixture",
          visibility: "private" as const,
        } }),
      },
    } };
    const stopped = await executeBlooketPublicationCommand(
      command("step", state.revision), changed,
    );
    assert.ok(!stopped.ok);
    assert.equal(stopped.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.equal(state.writes(), 1);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.attempt));
    const resumed = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(resumed["completedOperations"], 2);
    assert.equal(state.writes(), 2);
  }); },
);

test("the first question is not appended to human-authored content",
  async () => { await fixture(async state => {
    const first = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(first["completedOperations"], 1);
    state.questions.push({
      schemaVersion: 3, number: 1,
      question: "Existing teacher-authored question", equation: null,
      qType: "typing", random: true, timeLimit: 10,
      answers: [{ kind: "text", content: "teacher", correct: true,
        match: "contains" }], hasImage: false, hasAudio: false,
    });
    const stopped = await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    );
    assert.ok(!stopped.ok);
    assert.equal(stopped.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.equal(state.writes(), 1);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.attempt));
  }); },
);

test("resumed multi-question writes verify prior saved question content",
  async () => { await fixture(async state => {
    const twoQuestions = { ...document, questions: [
      ...document.questions, {
        id: "q2", type: "typing-answer", prompt: "Type moon.",
        timeLimitSeconds: 10, image: null, matchMode: "contains",
        answer: "moon",
      },
    ] };
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:two-question-draft",
      command: "drafts.put", payload: { id: "fixture",
        document: twoQuestions, expectedRevision: state.revision },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    assert.equal(value(await executeBlooketPublicationCommand(
      command("step", revision), state.host,
    ))["completedOperations"], 1);
    assert.equal(value(await executeBlooketPublicationCommand(
      command("step", revision), state.host,
    ))["completedOperations"], 2);
    assert.equal(state.writes(), 2);
    const original = state.questions[0]!;
    state.questions[0] = { ...original, question: "Teacher changed this." };
    const changed = await executeBlooketPublicationCommand(
      command("step", revision), state.host,
    );
    assert.ok(!changed.ok);
    assert.equal(changed.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.equal(state.writes(), 2);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.attempt));
    state.questions[0] = original;
    const resumed = value(await executeBlooketPublicationCommand(
      command("step", revision), state.host,
    ));
    assert.equal(resumed["completedOperations"], 3);
    assert.equal(state.writes(), 3);
    const verified = value(await executeBlooketPublicationCommand(
      command("verify"), state.host,
    ));
    assert.equal(verified["published"], true);
  }); },
);

test("a changed draft revision cannot replace a started publication",
  async () => { await fixture(async state => {
    await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    );
    const conflict = await executeBlooketPublicationCommand(
      command("step", "b".repeat(64)), state.host,
    );
    assert.ok(!conflict.ok);
    assert.equal(conflict.issues[0]?.code,
      "blooket-publication-draft-conflict");
    assert.equal(state.writes(), 1);
  }); });

test("human stops and cancellation prevent publication writes",
  async () => { await fixture(async state => {
    state.session("security-challenge");
    const stopped = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(stopped["phase"], "human-action-required");
    assert.equal(stopped["state"], "security-challenge");
    assert.equal(state.capabilities(), 0);
    const cancelled = await executeBlooketPublicationCommand(
      command("step", state.revision), {
        ...state.host, signal: AbortSignal.abort(),
      },
    );
    assert.ok(!cancelled.ok);
    assert.equal(state.writes(), 0);
  }); });

test("publication storage rejects symlink aliases without provider work",
  async () => { await fixture(async state => {
    const outside = join(state.root, "fixture-target");
    await mkdir(outside);
    await symlink(outside, join(state.root, "publications"));
    const refused = await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    );
    assert.ok(!refused.ok);
    assert.equal(refused.issues[0]?.code, "publication-storage-unavailable");
    assert.equal(state.capabilities(), 0);
    assert.equal(state.writes(), 0);
  }); });


test("media requests stop before any snapshot or provider inspection",
  async () => { await fixture(async state => {
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:fixture-media", command: "drafts.put",
      payload: { id: "fixture", expectedRevision: state.revision,
        document: { ...document, coverImage: {
          description: "Fixture image", mediaId: null } } },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const stopped = await executeBlooketPublicationCommand(
      command("step", revision), state.host,
    );
    assert.ok(!stopped.ok);
    assert.equal(stopped.issues[0]?.code,
      "blooket-publication-media-unsupported");
    assert.equal(state.capabilities(), 0);
    assert.equal(state.writes(), 0);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.snapshot));
  }); });

test("malformed frozen snapshots cannot resume browser writes",
  async () => { await fixture(async state => {
    await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    );
    const files = await publicationFiles(state.root, "fixture");
    const snapshot = JSON.parse(await readFile(files.snapshot, "utf8"));
    await writeFile(files.snapshot, JSON.stringify({ ...snapshot,
      unexpected: true }));
    const stopped = await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    );
    assert.ok(!stopped.ok);
    assert.equal(stopped.issues[0]?.code, "publication-snapshot-invalid");
    assert.equal(state.writes(), 1);
  }); });

test("final verification rejects media and changing remote observations",
  async () => { await fixture(async state => {
    for (let index = 0; index < 2; index++)
      await executeBlooketPublicationCommand(
        command("step", state.revision), state.host,
      );
    state.questions[0] = { ...state.questions[0]!, hasImage: true };
    let stopped = await executeBlooketPublicationCommand(
      command("verify"), state.host,
    );
    assert.ok(!stopped.ok);
    state.questions[0] = { ...state.questions[0]!, hasImage: false };
    let reads = 0;
    stopped = await executeBlooketPublicationCommand(command("verify"), {
      ...state.host, blooket: { ...state.host.blooket,
        questions: { list: async () => ({ ok: true,
          value: [{ ...state.questions[0]!,
            timeLimit: ++reads === 1 ? 10 : 11 }] }) },
      },
    });
    assert.ok(!stopped.ok);
    assert.equal(stopped.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.equal(state.writes(), 2);
  }); });

test("concurrent publication steps cannot submit the same operation twice",
  async () => { await fixture(async state => {
    let entered!: () => void, release!: () => void;
    const enteredWrite = new Promise<void>(resolve => { entered = resolve; });
    const blockedWrite = new Promise<void>(resolve => { release = resolve; });
    const first = executeBlooketPublicationCommand(
      command("step", state.revision), { ...state.host,
        writes: { execute: async (...args) => {
          entered();
          await blockedWrite;
          return state.host.writes.execute(...args);
        } },
      },
    );
    await enteredWrite;
    try {
      const second = await executeBlooketPublicationCommand(
        command("step", state.revision), state.host,
      );
      assert.ok(!second.ok);
      assert.equal(second.issues[0]?.code, "blooket-publication-busy");
    } finally { release(); await first; }
    assert.equal(state.writes(), 1);
  }); });


test("held update ownership blocks publication until explicitly released",
  async () => { await fixture(async state => {
    const boundary = await acquireUpdatePublicationBoundary(state.root);
    assert.ok(boundary.ok);
    try {
      const stopped = await executeBlooketPublicationCommand(
        command("step", state.revision), state.host,
      );
      assert.ok(!stopped.ok);
      assert.equal(stopped.issues[0]?.code, "blooket-publication-busy");
      assert.equal(state.capabilities(), 0);
      assert.equal(state.writes(), 0);
      const files = await publicationFiles(state.root, "fixture");
      await assert.rejects(readFile(files.snapshot));
    } finally { await boundary.release(); }
    value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(state.writes(), 1);
  }); });

test("active remote publication prevents update ownership",
  async () => { await fixture(async state => {
    let notify!: () => void, resume!: () => void;
    const started = new Promise<void>(resolve => { notify = resolve; });
    const finished = new Promise<void>(resolve => { resume = resolve; });
    const original = state.host.writes.execute;
    const host = { ...state.host, writes: { execute: async (...args:
      Parameters<typeof original>) => {
      notify();
      await finished;
      return original(...args);
    } } };
    const pending = executeBlooketPublicationCommand(
      command("step", state.revision), host,
    );
    try {
      await started;
      assert.deepEqual(await acquireUpdatePublicationBoundary(state.root), {
        ok: false, reason: "publication-busy",
      });
    } finally { resume(); }
    value(await pending);
    const boundary = await acquireUpdatePublicationBoundary(state.root);
    assert.ok(boundary.ok);
    await boundary.release();
  }); });

test("uncertain attempts block updates after inconclusive reconciliation",
  async () => { await fixture(async state => {
    state.ambiguous(true);
    value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    const files = await publicationFiles(state.root, "fixture");
    const journal = await readFile(files.attempt, "utf8");
    assert.deepEqual(await acquireUpdatePublicationBoundary(state.root), {
      ok: false, reason: "publication-recovery-required",
    });
    assert.equal(await readFile(files.attempt, "utf8"), journal);
    assert.equal(state.writes(), 1);
    const reconciled = value(await executeBlooketPublicationCommand(
      command("reconcile"), state.host));
    assert.equal(reconciled["reason"], "verification-inconclusive");
    assert.deepEqual(await acquireUpdatePublicationBoundary(state.root), {
      ok: false, reason: "publication-recovery-required",
    });
    assert.equal(await readFile(files.attempt, "utf8"), journal);
    assert.equal(state.writes(), 1);
  }); });

async function mediaRecoveryFixture(state: Awaited<ReturnType<typeof state>>) {
  const preparedMedia = { mediaId: "icon", revision: 1,
    format: "png" as const, bytes: new Uint8Array(PNG_SIGNATURE) };
  const identity = identifyPreparedMedia(preparedMedia)!;
  const snapshot = { schemaVersion: 2, draftId: "fixture",
    revision: state.revision, capabilities,
    document: { ...document, questions: [{ ...document.questions[0],
      image: { description: "Synthetic icon", mediaId: "icon" },
    }] }, expectedMedia: { schemaVersion: 1, items: [identity] },
  };
  const files = await publicationFiles(state.root, "fixture");
  await createPublicationSnapshot(files.snapshot, snapshot);
  const decoded = decodeBlooketPublicationSnapshot(snapshot, "fixture")!;
  const verifier = blooketSetReadWriteVerifier(state.host.blooket.sets,
    state.host.blooket.questions, decoded.expectedMedia);
  const media = { read: async () => ({ ok: true as const,
    value: preparedMedia }) };
  const options = { pacer: state.host.pacer, media,
    expectedMedia: decoded.expectedMedia };
  const set = await executePersistedBlooketWrite(files, decoded.plan,
    state.host.blooket.session, state.host.blooket.secrets,
    state.host.writes, verifier, options);
  assert.ok(set.ok);
  return { files, decoded, verifier, options, preparedMedia };
}

test("canonical verification uses the durable image rather than current media",
  async () => { await fixture(async state => {
    const saved = await mediaRecoveryFixture(state);
    assert.ok((await executePersistedBlooketWrite(saved.files,
      saved.decoded.plan, state.host.blooket.session,
      state.host.blooket.secrets, state.host.writes, saved.verifier,
      saved.options)).ok);
    saved.preparedMedia.bytes.fill(0);
    const host = { ...state.host, preparedMedia: { read: async () => {
      throw new Error("Verification must not resolve current media.");
    } } };
    assert.equal(value(await executeBlooketPublicationCommand(
      command("verify"), host))["published"], true);
    const question = state.questions[0]!;
    assert.equal(question.schemaVersion, 4);
    if (question.schemaVersion === 4) state.questions[0] = { ...question,
      imageEvidence: { ...question.imageEvidence!, sha256: "f".repeat(64) },
    };
    const changed = await executeBlooketPublicationCommand(
      command("verify"), host);
    assert.ok(!changed.ok);
    assert.equal(changed.issues[0]?.code,
      "blooket-publication-remote-conflict");
  }); });

test("image reconciliation retains frozen identity after interruption",
  async () => { await fixture(async state => {
    const saved = await mediaRecoveryFixture(state);
    const uncertain = { execute: async (...args:
      Parameters<typeof state.host.writes.execute>) => {
      await state.host.writes.execute(...args);
      return { ok: false as const, kind: "browser" as const,
        code: "blooket-browser-failed" as const };
    } };
    const attempt = await executePersistedBlooketWrite(saved.files,
      saved.decoded.plan, state.host.blooket.session,
      state.host.blooket.secrets, uncertain, saved.verifier, saved.options);
    assert.ok(attempt.ok && attempt.kind === "reconciliation-required");
    saved.preparedMedia.bytes.fill(0);
    const reconciled = value(await executeBlooketPublicationCommand(
      command("reconcile"), { ...state.host, preparedMedia: {
        read: async () => { throw new Error("No current library reads."); },
      } }));
    assert.equal(reconciled["completedOperations"], 2);
    assert.equal(state.writes(), 2);
    assert.equal(value(await executeBlooketPublicationCommand(
      command("verify"), state.host))["published"], true);
  }); });

test("resuming stored media cannot bypass the pending live mutation gate",
  async () => { await fixture(async state => {
    const saved = await mediaRecoveryFixture(state);
    const snapshotBytes = await readFile(saved.files.snapshot, "utf8");
    const stopped = await executeBlooketPublicationCommand(
      command("step", state.revision), state.host);
    assert.ok(!stopped.ok);
    assert.equal(stopped.issues[0]?.code,
      "blooket-publication-media-unsupported");
    assert.equal(await readFile(saved.files.snapshot, "utf8"), snapshotBytes);
    assert.equal(state.writes(), 1);
  }); });

test("legacy text publications retain checkpoint bindings",
  async () => { await fixture(async state => {
    value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host));
    const files = await publicationFiles(state.root, "fixture");
    const stored = JSON.parse(await readFile(files.snapshot, "utf8"));
    assert.equal(stored.schemaVersion, 2);
    assert.deepEqual(stored.expectedMedia, { schemaVersion: 1, items: [] });
    const { expectedMedia: unused, ...legacy } = stored;
    void unused;
    // Simulate an intact previous-version snapshot, preserving its checkpoint.
    await writeFile(files.snapshot, JSON.stringify({ ...legacy,
      schemaVersion: 1 }));
    value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host));
    assert.equal(value(await executeBlooketPublicationCommand(
      command("verify"), state.host))["published"], true);
    assert.equal(state.writes(), 2);
  }); });

test("altered image identities cannot reinterpret an existing checkpoint",
  async () => { await fixture(async state => {
    const saved = await mediaRecoveryFixture(state);
    const snapshot = JSON.parse(await readFile(saved.files.snapshot, "utf8"));
    snapshot.expectedMedia.items[0].sha256 = "d".repeat(64);
    await writeFile(saved.files.snapshot, JSON.stringify(snapshot));
    const checkpoint = await readFile(saved.files.checkpoint, "utf8");
    const provider = async (): Promise<never> => {
      throw new Error("No provider reads after a cross-plan checkpoint.");
    };
    const stopped = await executeBlooketPublicationCommand(
      command("verify"), { ...state.host, blooket: { ...state.host.blooket,
        session: { observe: provider, authenticate: provider },
        questions: { list: provider },
      } });
    assert.ok(!stopped.ok);
    assert.equal(stopped.issues[0]?.code,
      "blooket-publication-recovery-required");
    assert.equal(await readFile(saved.files.checkpoint, "utf8"), checkpoint);
    assert.equal(state.writes(), 1);
  }); });

test("a second draft cannot replay an already started identical plan",
  async () => { await fixture(async state => {
    const first = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(first["completedOperations"], 1);
    assert.equal(state.writes(), 1);
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:cloned-draft", command: "drafts.put",
      payload: { id: "cloned-fixture", document, expectedRevision: null },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const host = { ...state.host, blooket: {
      ...state.host.blooket, sets: {
        ...state.host.blooket.sets,
        // Nonempty provider listings are incomplete. This listing misses
        // the original set, so the durable local plan must stop the copy.
        list: async () => ({ ok: true as const,
          completeness: "unknown" as const, value: [] }),
      },
    } };
    const copied = await executeBlooketPublicationCommand({
      ...command("step", revision),
      payload: { draftId: "cloned-fixture", expectedRevision: revision },
    }, host);
    assert.ok(!copied.ok);
    assert.equal(copied.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.match(copied.issues[0]?.message ?? "",
      /previously started identical plan/u);
    assert.equal(state.writes(), 1);
    const paths = await publicationFiles(state.root, "cloned-fixture");
    await assert.rejects(readFile(paths.attempt));
    const original = value(await executeBlooketPublicationCommand(
      command("status"), state.host,
    ));
    assert.equal(original["completedOperations"], 1);
  }); },
);

test("a different frozen plan can publish even with another snapshot",
  async () => { await fixture(async state => {
    const first = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(first["completedOperations"], 1);
    const different = { ...document,
      description: "A separately authored private lesson" };
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:different-draft", command: "drafts.put",
      payload: { id: "different-fixture", document: different,
        expectedRevision: null },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const host = { ...state.host, blooket: {
      ...state.host.blooket, sets: { ...state.host.blooket.sets,
        list: async () => ({ ok: true as const,
          completeness: "complete" as const,
          value: [{ schemaVersion: 1 as const, id: "synthetic-remote",
            title: document.title }] }),
      },
    } };
    const second = value(await executeBlooketPublicationCommand({
      ...command("step", revision),
      payload: { draftId: "different-fixture", expectedRevision: revision },
    }, host));
    assert.equal(second["completedOperations"], 1);
    assert.equal(state.writes(), 2);
  }); },
);

test("an ambiguous prior draft blocks a duplicate even with no receipt",
  async () => { await fixture(async state => {
    state.ambiguous(true);
    const prior = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(prior["phase"], "reconciliation-required");
    assert.equal(state.writes(), 1);
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:ambiguous-copy", command: "drafts.put",
      payload: { id: "ambiguous-copy", document, expectedRevision: null },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const blocked = await executeBlooketPublicationCommand({
      ...command("step", revision), payload: {
        draftId: "ambiguous-copy", expectedRevision: revision,
      },
    }, state.host);
    assert.ok(!blocked.ok);
    assert.equal(blocked.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.equal(state.writes(), 1);
    const old = value(await executeBlooketPublicationCommand(
      command("status"), state.host,
    ));
    assert.equal(old["phase"], "reconciliation-required");
    const files = await publicationFiles(state.root, "ambiguous-copy");
    await assert.rejects(readFile(files.attempt));
  }); },
);

test("an unused frozen snapshot does not block an identical new draft",
  async () => { await fixture(async state => {
    let listCalls = 0;
    const interruptedHost = { ...state.host, blooket: {
      ...state.host.blooket,
      sets: { ...state.host.blooket.sets,
        list: async () => {
          listCalls++;
          return listCalls === 1
            ? { ok: true as const, completeness: "complete" as const,
              value: [] }
            : { ok: false as const,
              code: "blooket-browser-unavailable" as const };
        },
      },
    } };
    const interrupted = await executeBlooketPublicationCommand(
      command("step", state.revision), interruptedHost,
    );
    assert.ok(!interrupted.ok);
    assert.equal(state.writes(), 0);
    const original = await publicationFiles(state.root, "fixture");
    assert.equal(typeof await readFile(original.snapshot, "utf8"), "string");
    await assert.rejects(readFile(original.attempt));
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:unused-snapshot-copy",
      command: "drafts.put", payload: {
        id: "unused-snapshot-copy", document, expectedRevision: null,
      },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const permitted = value(await executeBlooketPublicationCommand({
      ...command("step", revision), payload: {
        draftId: "unused-snapshot-copy", expectedRevision: revision,
      },
    }, state.host));
    assert.equal(permitted["completedOperations"], 1);
    assert.equal(state.writes(), 1);
  }); },
);

test("two simultaneous identical draft publications never create two sets",
  async () => { await fixture(async state => {
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:concurrent-plan-copy",
      command: "drafts.put", payload: {
        id: "concurrent-plan-copy", document, expectedRevision: null,
      },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const first = command("step", state.revision);
    const second = {
      ...command("step", revision), payload: {
        draftId: "concurrent-plan-copy", expectedRevision: revision,
      },
    };
    const [a, b] = await Promise.all([
      executeBlooketPublicationCommand(first, state.host),
      executeBlooketPublicationCommand(second, state.host),
    ]);
    assert.equal(state.writes(), 1);
    const outcomes = [a, b];
    assert.equal(outcomes.filter(result => result.ok).length, 1);
    assert.equal(outcomes.filter(result => !result.ok).length, 1);
    const refused = outcomes.find(result => !result.ok);
    assert.ok(refused && !refused.ok);
    assert.ok([
      "blooket-publication-busy",
      "blooket-publication-remote-conflict",
    ].includes(refused.issues[0]?.code ?? ""));
  }); },
);

test("a corrupt prior identical-plan journal prevents another write",
  async () => { await fixture(async state => {
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:corrupt-journal-copy",
      command: "drafts.put", payload: {
        id: "corrupt-journal-copy", document, expectedRevision: null,
      },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const prior = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(prior["completedOperations"], 1);
    const originalPaths = await publicationFiles(state.root, "fixture");
    await writeFile(originalPaths.attempt, "{corrupt-recovery-record");
    const duplicate = await executeBlooketPublicationCommand({
      ...command("step", revision), payload: {
        draftId: "corrupt-journal-copy", expectedRevision: revision,
      },
    }, state.host);
    assert.ok(!duplicate.ok);
    assert.equal(duplicate.issues[0]?.code,
      "publication-storage-unavailable");
    assert.match(duplicate.issues[0]?.message ?? "",
      /local journal evidence could not be safely inspected/u);
    assert.equal(state.writes(), 1);
    assert.equal(await readFile(originalPaths.attempt, "utf8"),
      "{corrupt-recovery-record");
    const newPaths = await publicationFiles(state.root,
      "corrupt-journal-copy");
    await assert.rejects(readFile(newPaths.attempt));
  }); },
);

test("a confirmed but not checkpointed prior set blocks cloned create",
  async () => { await fixture(async state => {
    const initial = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(initial["completedOperations"], 1);
    const paths = await publicationFiles(state.root, "fixture");
    const source = JSON.parse(await readFile(paths.snapshot, "utf8"));
    const decoded = decodeBlooketPublicationSnapshot(source, "fixture");
    assert.ok(decoded);
    const first = decoded.plan.operations[0]!;
    const begun = await beginWriteAttempt(paths.attempt,
      decoded.plan, 0);
    assert.ok(begun.ok);
    const confirmed = await confirmWriteAttempt(paths.attempt,
      decoded.plan, first.operationId, {
        kind: "set-created", remoteSetId: "synthetic-remote",
      });
    assert.ok(confirmed.ok);
    await rm(paths.checkpoint);
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:confirmed-uncheckpointed-copy",
      command: "drafts.put", payload: {
        id: "confirmed-uncheckpointed-copy", document,
        expectedRevision: null,
      },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const duplicate = await executeBlooketPublicationCommand({
      ...command("step", revision), payload: {
        draftId: "confirmed-uncheckpointed-copy",
        expectedRevision: revision,
      },
    }, state.host);
    assert.ok(!duplicate.ok);
    assert.equal(duplicate.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.equal(state.writes(), 1);
    const untouched = JSON.parse(await readFile(paths.attempt, "utf8"));
    assert.equal(untouched.phase, "confirmed");
  }); },
);

test("different questions cannot duplicate an already-started set payload",
  async () => { await fixture(async state => {
    const first = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(first["completedOperations"], 1);
    assert.equal(state.writes(), 1);
    const differentQuestions = { ...document, questions: [{
      ...document.questions[0]!, id: "second-q",
      prompt: "Another prompt with the same set metadata.",
    }] };
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:different-questions-same-set",
      command: "drafts.put", payload: {
        id: "different-questions-same-set", document: differentQuestions,
        expectedRevision: null,
      },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const hiddenRemote = { ...state.host, blooket: {
      ...state.host.blooket,
      sets: { ...state.host.blooket.sets,
        list: async () => ({ ok: true as const,
          completeness: "unknown" as const, value: [] }),
      },
    } };
    const blocked = await executeBlooketPublicationCommand({
      ...command("step", revision), payload: {
        draftId: "different-questions-same-set",
        expectedRevision: revision,
      },
    }, hiddenRemote);
    assert.ok(!blocked.ok);
    assert.equal(blocked.issues[0]?.code,
      "blooket-publication-remote-conflict");
    assert.equal(state.writes(), 1);
    const copy = await publicationFiles(state.root,
      "different-questions-same-set");
    await assert.rejects(readFile(copy.attempt));
  }); },
);

test("orphan attempt without snapshot blocks a new remote create",
  async () => { await fixture(async state => {
    const orphan = await publicationFiles(state.root,
      "interrupted-snapshot-fixture");
    await mkdir(dirname(orphan.attempt), { recursive: true });
    await writeFile(orphan.attempt,
      "{possibly-sent-before-snapshot-recovered}");
    const blocked = await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    );
    assert.ok(!blocked.ok);
    assert.equal(blocked.issues[0]?.code,
      "publication-storage-unavailable");
    assert.equal(state.writes(), 0);
    assert.equal(await readFile(orphan.attempt, "utf8"),
      "{possibly-sent-before-snapshot-recovered}");
    await rm(orphan.attempt);
    const allowed = value(await executeBlooketPublicationCommand(
      command("step", state.revision), state.host,
    ));
    assert.equal(allowed["completedOperations"], 1);
    assert.equal(state.writes(), 1);
  }); },
);

test("canonical publication freezes prepared question image and verifies it",
  async () => { await fixture(async state => {
    const updated = await executeLibraryCommand({
      version: 1, operationId: "cli:fixture-image-draft", command: "drafts.put",
      payload: { id: "fixture", expectedRevision: state.revision,
        document: { ...document, questions: [{ ...document.questions[0],
          image: { description: "Synthetic prepared icon", mediaId: "icon" },
        }] } },
    }, state.root);
    assert.ok(updated.ok);
    const revision = (updated.value as { revision: string }).revision;
    const image = { mediaId: "icon", revision: 1,
      format: "png" as const, bytes: new Uint8Array(PNG_SIGNATURE) };
    let reads = 0;
    const inspect = state.host.blooket.capabilities.inspect;
    const host = { ...state.host, blooket: { ...state.host.blooket,
      capabilities: { inspect: async (purpose?: "text-publication") => {
        if (purpose !== "text-publication") return {
          ok: false as const, code: "blooket-browser-failed" as const,
        };
        return await inspect(purpose);
      } },
    }, preparedMedia: {
      read: async (id: string) => {
        assert.equal(id, "icon");
        reads++;
        return { ok: true as const, value: image };
      },
    } };
    const created = value(await executeBlooketPublicationCommand(
      command("step", revision), host));
    assert.equal(created["completedOperations"], 1);
    assert.deepEqual(state.capabilityPurposes(), ["text-publication"]);
    const files = await publicationFiles(state.root, "fixture");
    const snapshot = JSON.parse(await readFile(files.snapshot, "utf8"));
    assert.equal(snapshot.expectedMedia.items.length, 1);
    assert.equal(snapshot.expectedMedia.items[0].mediaId, "icon");
    assert.equal(snapshot.expectedMedia.items[0].byteLength, 8);
    assert.equal(JSON.stringify(snapshot).includes("137,80,78"), false);
    const added = value(await executeBlooketPublicationCommand(
      command("step", revision), host));
    assert.equal(added["completedOperations"], 2);
    assert.equal(value(await executeBlooketPublicationCommand(
      command("verify"), { ...host, preparedMedia: { read: async () => {
        throw Error("frozen verification cannot read current media");
      } } }))["published"], true);
    assert.equal(state.writes(), 2);
    assert.ok(reads >= 3);
  }); });

test("scoped image publication still requires supported image capability",
  async () => {
  for (const availability of ["unknown", "unsupported", "account-dependent"])
    await fixture(async state => {
      const saved = await executeLibraryCommand({
        version: 1, operationId: "cli:scoped-image-draft",
        command: "drafts.put", payload: { id: "fixture",
          expectedRevision: state.revision,
          document: { ...document, questions: [{ ...document.questions[0],
            image: { description: "Synthetic icon", mediaId: "icon" },
          }] },
        },
      }, state.root);
      assert.ok(saved.ok);
      const host = { ...state.host, blooket: { ...state.host.blooket,
        capabilities: { inspect: async (purpose?: "text-publication") => {
          assert.equal(purpose, "text-publication");
          return { ok: true as const, value: { ...capabilities,
            features: { ...capabilities.features,
              questionImages: availability } } };
        } },
      }, preparedMedia: { read: async () => ({ ok: true as const,
        value: { mediaId: "icon", revision: 1, format: "png" as const,
          bytes: new Uint8Array(PNG_SIGNATURE) },
      }) } };
      const result = await executeBlooketPublicationCommand(command("step",
        (saved.value as { revision: string }).revision), host);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.issues[0]?.code,
        "blooket-publication-invalid-draft");
      assert.equal(state.writes(), 0);
      const files = await publicationFiles(state.root, "fixture");
      await assert.rejects(readFile(files.snapshot));
      await assert.rejects(readFile(files.attempt));
    });
});

test("Stop during prepared image lookup leaves no publication snapshot",
  async () => { await fixture(async state => {
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:cancel-media-start", command: "drafts.put",
      payload: { id: "fixture", expectedRevision: state.revision,
        document: { ...document, questions: [{ ...document.questions[0],
          image: { description: "Synthetic icon", mediaId: "icon" },
        }] } },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const abort = new AbortController();
    let reads = 0;
    const result = await executeBlooketPublicationCommand(
      command("step", revision), { ...state.host, signal: abort.signal,
        preparedMedia: { read: async () => {
          reads++;
          abort.abort();
          return { ok: true as const, value: {
            mediaId: "icon", revision: 1, format: "png" as const,
            bytes: new Uint8Array(PNG_SIGNATURE),
          } };
        } },
      });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issues[0]?.code,
      "blooket-publication-cancelled");
    assert.equal(reads, 1);
    assert.equal(state.writes(), 0);
    const files = await publicationFiles(state.root, "fixture");
    await assert.rejects(readFile(files.snapshot));
    await assert.rejects(readFile(files.attempt));
  }); },
);

test("stalled image read lets Stop release the publication command promptly",
  async () => { await fixture(async state => {
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:cancel-stalled-image",
      command: "drafts.put",
      payload: { id: "fixture", expectedRevision: state.revision,
        document: { ...document, questions: [{ ...document.questions[0],
          image: { description: "Synthetic icon", mediaId: "icon" },
        }] } },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const abort = new AbortController();
    const image = { mediaId: "icon", revision: 1,
      format: "png" as const, bytes: new Uint8Array(PNG_SIGNATURE) };
    let entered!: () => void;
    let release!: (result: { ok: true; value: typeof image }) => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<{ ok: true; value: typeof image }>(
      resolve => { release = resolve; },
    );
    const work = executeBlooketPublicationCommand(
      command("step", revision), { ...state.host, signal: abort.signal,
        preparedMedia: { read: async () => {
          entered();
          return await blocked;
        } },
      });
    await started;
    abort.abort();
    try {
      const result = await Promise.race([work,
        new Promise<"hung">(resolve =>
          setTimeout(() => resolve("hung"), 160)),
      ]);
      assert.notEqual(result, "hung");
      if (result === "hung") return;
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.issues[0]?.code,
        "blooket-publication-cancelled");
      assert.equal(state.writes(), 0);
      const files = await publicationFiles(state.root, "fixture");
      await assert.rejects(readFile(files.snapshot));
      await assert.rejects(readFile(files.attempt));
    } finally {
      release({ ok: true, value: image });
      await work;
    }
  }); },
);

test("Stop during resumed image check cannot open another attempt journal",
  async () => { await fixture(async state => {
    const saved = await executeLibraryCommand({
      version: 1, operationId: "cli:cancel-media-resume", command: "drafts.put",
      payload: { id: "fixture", expectedRevision: state.revision,
        document: { ...document, questions: [{ ...document.questions[0],
          image: { description: "Synthetic icon", mediaId: "icon" },
        }] } },
    }, state.root);
    assert.ok(saved.ok);
    const revision = (saved.value as { revision: string }).revision;
    const image = { mediaId: "icon", revision: 1,
      format: "png" as const, bytes: new Uint8Array(PNG_SIGNATURE) };
    const initial = { ...state.host, preparedMedia: { read: async () =>
      ({ ok: true as const, value: image }) } };
    const created = value(await executeBlooketPublicationCommand(
      command("step", revision), initial));
    assert.equal(created["completedOperations"], 1);
    const files = await publicationFiles(state.root, "fixture");
    const checkpoint = await readFile(files.checkpoint, "utf8");
    const abort = new AbortController();
    const stopped = await executeBlooketPublicationCommand(
      command("step", revision), { ...initial, signal: abort.signal,
        preparedMedia: { read: async () => {
          abort.abort();
          return { ok: true as const, value: image };
        } },
      });
    assert.equal(stopped.ok, false);
    if (!stopped.ok) assert.equal(stopped.issues[0]?.code,
      "blooket-publication-cancelled");
    assert.equal(state.writes(), 1);
    assert.equal(await readFile(files.checkpoint, "utf8"), checkpoint);
    await assert.rejects(readFile(files.attempt));
  }); },
);

test("changed prepared image after Create Set fails before second mutation",
  async () => { await fixture(async state => {
    const updated = await executeLibraryCommand({
      version: 1, operationId: "cli:fixture-image-changes",
      command: "drafts.put",
      payload: { id: "fixture", expectedRevision: state.revision,
        document: { ...document, questions: [{ ...document.questions[0],
          image: { description: "Synthetic prepared icon", mediaId: "icon" },
        }] } },
    }, state.root);
    assert.ok(updated.ok);
    const revision = (updated.value as { revision: string }).revision;
    const image = { mediaId: "icon", revision: 1,
      format: "png" as const, bytes: new Uint8Array([...PNG_SIGNATURE, 23]) };
    const host = { ...state.host, preparedMedia: { read: async () =>
      ({ ok: true as const, value: image }) } };
    assert.equal(value(await executeBlooketPublicationCommand(
      command("step", revision), host))["completedOperations"], 1);
    const files = await publicationFiles(state.root, "fixture");
    const original = await readFile(files.snapshot, "utf8");
    image.bytes[8] = 11;
    const changed = await executeBlooketPublicationCommand(
      command("step", revision), host);
    assert.ok(!changed.ok);
    assert.equal(changed.issues[0]?.code, "blooket-media-stale");
    assert.equal(state.writes(), 1);
    assert.equal(await readFile(files.snapshot, "utf8"), original);
    await assert.rejects(readFile(files.attempt));
  }); });

test("uncertain image writes remain reconcilable without current media bytes",
  async () => { await fixture(async state => {
    const updated = await executeLibraryCommand({
      version: 1, operationId: "cli:fixture-image-interrupted",
      command: "drafts.put",
      payload: { id: "fixture", expectedRevision: state.revision,
        document: { ...document, questions: [{ ...document.questions[0],
          image: { description: "Synthetic icon", mediaId: "icon" },
        }] } },
    }, state.root);
    assert.ok(updated.ok);
    const revision = (updated.value as { revision: string }).revision;
    const media = { mediaId: "icon", revision: 1,
      format: "png" as const, bytes: new Uint8Array(PNG_SIGNATURE) };
    const host = { ...state.host, preparedMedia: { read: async () =>
      ({ ok: true as const, value: media }) } };
    assert.equal(value(await executeBlooketPublicationCommand(
      command("step", revision), host))["completedOperations"], 1);
    state.ambiguous(true);
    const interrupted = value(await executeBlooketPublicationCommand(
      command("step", revision), host));
    assert.equal(interrupted["phase"], "reconciliation-required");
    assert.equal(state.writes(), 2);
    const files = await publicationFiles(state.root, "fixture");
    const journal = await readFile(files.attempt, "utf8");
    media.bytes.fill(0);
    const missingPort = { ...host, preparedMedia: { read: async () => {
      throw Error("Recovery may not require current library image");
    } } };
    const resumed = value(await executeBlooketPublicationCommand(
      command("step", revision), missingPort));
    assert.equal(resumed["phase"], "reconciliation-required");
    const result = value(await executeBlooketPublicationCommand(
      command("reconcile"), missingPort));
    assert.equal(result["phase"], "reconciliation-required");
    assert.equal(result["reason"], "verification-inconclusive");
    assert.equal(await readFile(files.attempt, "utf8"), journal);
    assert.equal(state.writes(), 2);
  }); });
