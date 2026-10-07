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
//   - Regression coverage for browser-service Blooket port composition.
// - Must-Not:
//   - Contact Blooket, read a real library, or register publication commands.
// - Allows:
//   - Inputs: Synthetic bridge transport and temporary user root.
//   - Outputs: Exact bridge write execution and read-port assertions.
//   - Side effects: None unless a composed port is explicitly invoked.
// - Split-When:
//   - Publication composition gains a separate service boundary.
// - Merge-When:
//   - Blooket runtime composition is removed.
// - Summary:
//   - Proves browser writes pass through the canonical execution adapter.
// - Description:
//   - No test invokes persisted publication or remote browser mutation.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Add Question remains unsupported by the current bridge surface.
//
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBlooketRuntimePorts } from
  "../../../../src/api/browser-service/adapter-inbound/blooket-runtime.ts";
import { executePersistedBlooketWrite } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/execute-persisted.ts";
import type { BlooketBrowserBridgeCommand } from
  "../../../../src/ir/blooket-browser-bridge/contract/message.ts";
import type { BlooketWriteOperation } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";
import { loadWriteAttemptFile } from
  "../../../../src/platforms/write-attempt-files/adapter-outbound/file.ts";
import { loadMutationBudgetFile } from
  "../../../../src/platforms/mutation-budget-files/adapter-outbound/file.ts";
import type { BlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";
import type { HostSecretStore } from
  "../../../../src/security/host-secrets/domain/host-secret.ts";

const operation: BlooketWriteOperation = {
  operationId: "plan:runtime:set",
  kind: "set",
  title: "Synthetic set",
  description: "Synthetic description",
  visibility: "private",
  coverMediaId: null,
};

const questionOperation: BlooketWriteOperation = {
  operationId: "plan:runtime:q:0",
  kind: "question",
  localQuestionId: "q1",
  questionNumber: 1,
  question: {
    type: "typing-answer",
    prompt: "Type sun.",
    timeLimitSeconds: 15,
    imageMediaId: null,
    matchMode: "exact",
    answer: "sun",
  },
};

test(
  "runtime composes bridge Create Set through canonical write execution",
  async () => {
  const commands: BlooketBrowserBridgeCommand[] = [];
  const runtime = createBlooketRuntimePorts({
    request: async (command) => {
      commands.push(command);
      if (command.kind === "sets.create") {
        return {
          ok: true,
          value: { ok: true, remoteSetId: "remote-set-1" },
        };
      }
      return { ok: false, code: "blooket-browser-failed" };
    },
  }, "/synthetic-unused-root");

  assert.deepEqual(
    await runtime.writeExecution.execute(
      operation,
      { remoteSetId: null },
      { preparedMedia: [] },
    ),
    {
      ok: true,
      receipt: {
        kind: "set-created",
        remoteSetId: "remote-set-1",
      },
    },
  );
  assert.deepEqual(commands, [{
    kind: "sets.create",
    title: "Synthetic set",
    description: "Synthetic description",
    private: true,
  }]);
  },
);

test(
  "persisted runtime journals budgets and confirms one bridge Create Set",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "blooket-runtime-"));
    try {
      const commands: BlooketBrowserBridgeCommand[] = [];
      const runtime = createBlooketRuntimePorts({
        request: async (command) => {
          commands.push(command);
          if (command.kind === "session.observe")
            return { ok: true, value: "my-sets" };
          if (command.kind === "sets.create")
            return {
              ok: true,
              value: { ok: true, remoteSetId: "remote-set-1" },
            };
          return { ok: false, code: "blooket-browser-failed" };
        },
      }, directory);
      const plan: BlooketWritePlan = {
        schemaVersion: 1,
        planId: "plan:runtime-persisted",
        desiredStateSha256: "synthetic",
        operations: [operation],
      };
      const checkpoint = join(directory, "checkpoint.json");
      const attempt = join(directory, "attempt.json");
      const budget = join(directory, "budget.json");
      const secrets: HostSecretStore = {
        read: async () => ({ ok: true, kind: "missing" }),
        write: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
      };

      const result = await executePersistedBlooketWrite(
        { checkpoint, attempt },
        plan,
        runtime.session,
        secrets,
        runtime.writeExecution,
        undefined,
        {
          budget: {
            path: budget,
            policy: {
              maximumStarts: 2,
              maximumDurationMs: 60_000,
            },
            now: () => 10_000,
          },
          media: runtime.preparedMedia,
        },
      );

      assert.deepEqual(result, {
        ok: true,
        kind: "advanced",
        operationId: "plan:runtime:set",
        checkpoint: {
          schemaVersion: 2,
          planId: "plan:runtime-persisted",
          nextOperationIndex: 1,
          remoteSetId: "remote-set-1",
        },
      });
      assert.deepEqual(
        JSON.parse(await readFile(checkpoint, "utf8")),
        result.ok && result.kind === "advanced"
          ? result.checkpoint
          : null,
      );
      assert.deepEqual(
        await loadMutationBudgetFile(budget, plan.planId),
        {
          ok: true,
          state: { version: 1, startedAtMs: 10_000, starts: 1 },
        },
      );
      assert.deepEqual(await loadWriteAttemptFile(attempt, plan), {
        ok: true,
        kind: "missing",
      });
      assert.deepEqual(commands, [
        { kind: "session.observe" },
        { kind: "session.observe" },
        {
          kind: "sets.create",
          title: "Synthetic set",
          description: "Synthetic description",
          private: true,
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "persisted runtime challenge before mutation consumes no budget or write",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "blooket-runtime-"));
    try {
      const commands: BlooketBrowserBridgeCommand[] = [];
      const runtime = createBlooketRuntimePorts({
        request: async (command) => {
          commands.push(command);
          if (command.kind === "session.observe")
            return { ok: true, value: "security-challenge" };
          return { ok: false, code: "blooket-browser-failed" };
        },
      }, directory);
      const plan: BlooketWritePlan = {
        schemaVersion: 1,
        planId: "plan:runtime-challenge",
        desiredStateSha256: "synthetic",
        operations: [operation],
      };
      const checkpoint = join(directory, "checkpoint.json");
      const attempt = join(directory, "attempt.json");
      const budget = join(directory, "budget.json");
      const secrets: HostSecretStore = {
        read: async () => ({ ok: true, kind: "missing" }),
        write: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
      };

      const result = await executePersistedBlooketWrite(
        { checkpoint, attempt },
        plan,
        runtime.session,
        secrets,
        runtime.writeExecution,
        undefined,
        {
          budget: {
            path: budget,
            policy: {
              maximumStarts: 2,
              maximumDurationMs: 60_000,
            },
            now: () => 10_000,
          },
        },
      );

      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.kind, "human-action-required");
      assert.deepEqual(commands, [{ kind: "session.observe" }]);
      assert.deepEqual(
        await loadMutationBudgetFile(budget, plan.planId),
        { ok: true, state: null },
      );
      assert.deepEqual(await loadWriteAttemptFile(attempt, plan), {
        ok: true,
        kind: "missing",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "challenge during bridge mutation retains budget and reconciliation journal",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "blooket-runtime-"));
    try {
      const commands: BlooketBrowserBridgeCommand[] = [];
      const runtime = createBlooketRuntimePorts({
        request: async (command) => {
          commands.push(command);
          if (command.kind === "session.observe")
            return { ok: true, value: "my-sets" };
          if (command.kind === "sets.create")
            return {
              ok: true,
              value: {
                ok: false,
                kind: "navigation",
                state: "security-challenge",
              },
            };
          return { ok: false, code: "blooket-browser-failed" };
        },
      }, directory);
      const plan: BlooketWritePlan = {
        schemaVersion: 1,
        planId: "plan:runtime-ambiguous",
        desiredStateSha256: "synthetic",
        operations: [operation],
      };
      const checkpoint = join(directory, "checkpoint.json");
      const attempt = join(directory, "attempt.json");
      const budget = join(directory, "budget.json");
      const secrets: HostSecretStore = {
        read: async () => ({ ok: true, kind: "missing" }),
        write: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
      };

      const result = await executePersistedBlooketWrite(
        { checkpoint, attempt },
        plan,
        runtime.session,
        secrets,
        runtime.writeExecution,
        undefined,
        {
          budget: {
            path: budget,
            policy: {
              maximumStarts: 2,
              maximumDurationMs: 60_000,
            },
            now: () => 20_000,
          },
        },
      );

      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.kind, "reconciliation-required");
      assert.equal(
        commands.filter((command) => command.kind === "sets.create").length,
        1,
      );
      assert.deepEqual(
        await loadMutationBudgetFile(budget, plan.planId),
        {
          ok: true,
          state: { version: 1, startedAtMs: 20_000, starts: 1 },
        },
      );
      const journal = await loadWriteAttemptFile(attempt, plan);
      assert.equal(journal.ok, true);
      if (journal.ok && journal.kind === "record")
        assert.equal(journal.record.phase, "attempting");
      await assert.rejects(readFile(checkpoint, "utf8"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "runtime composes text Add Question through canonical write execution",
  async () => {
    const commands: BlooketBrowserBridgeCommand[] = [];
    const runtime = createBlooketRuntimePorts({
      request: async (command) => {
        commands.push(command);
        if (command.kind === "questions.create")
          return { ok: true, value: { ok: true } };
        return { ok: false, code: "blooket-browser-failed" };
      },
    }, "/synthetic-unused-root");

    assert.deepEqual(
      await runtime.writeExecution.execute(
        questionOperation,
        { remoteSetId: "remote-set-1" },
        { preparedMedia: [] },
      ),
      {
        ok: true,
        receipt: null,
      },
    );
    assert.deepEqual(commands, [{
      kind: "questions.create",
      setId: "remote-set-1",
      number: 1,
      question: "Type sun.",
      answers: [{ text: "sun", correct: true }],
      qType: "typing",
      random: true,
      answerTypes: ["exactly"],
      timeLimit: 15,
    }]);
  },
);

test(
  "persisted runtime advances Create Set then Add Question through one bridge",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "blooket-runtime-full-"));
    try {
      const commands: BlooketBrowserBridgeCommand[] = [];
      const runtime = createBlooketRuntimePorts({
        request: async (command) => {
          commands.push(command);
          if (command.kind === "session.observe")
            return { ok: true, value: "my-sets" };
          if (command.kind === "sets.create")
            return {
              ok: true,
              value: { ok: true, remoteSetId: "remote-set-1" },
            };
          if (command.kind === "questions.create")
            return { ok: true, value: { ok: true } };
          return { ok: false, code: "blooket-browser-failed" };
        },
      }, directory);
      const plan: BlooketWritePlan = {
        schemaVersion: 1,
        planId: "plan:runtime-full",
        desiredStateSha256: "synthetic-full",
        operations: [
          { ...operation, operationId: "plan:runtime-full:set" },
          {
            ...questionOperation,
            operationId: "plan:runtime-full:q:0",
          },
        ],
      };
      const checkpoint = join(directory, "checkpoint.json");
      const attempt = join(directory, "attempt.json");
      const budget = join(directory, "budget.json");
      const secrets: HostSecretStore = {
        read: async () => ({ ok: true, kind: "missing" }),
        write: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
      };
      const persistence = { checkpoint, attempt };
      const policy = {
        maximumStarts: 3,
        maximumDurationMs: 60_000,
      };

      const first = await executePersistedBlooketWrite(
        persistence,
        plan,
        runtime.session,
        secrets,
        runtime.writeExecution,
        undefined,
        {
          budget: { path: budget, policy, now: () => 10_000 },
          media: runtime.preparedMedia,
        },
      );
      assert.equal(first.ok, true);
      if (first.ok && first.kind === "advanced") {
        assert.equal(first.checkpoint.nextOperationIndex, 1);
        assert.equal(first.checkpoint.remoteSetId, "remote-set-1");
      } else {
        assert.fail("Create Set did not advance.");
      }

      const second = await executePersistedBlooketWrite(
        persistence,
        plan,
        runtime.session,
        secrets,
        runtime.writeExecution,
        undefined,
        {
          budget: { path: budget, policy, now: () => 20_000 },
          media: runtime.preparedMedia,
        },
      );
      assert.deepEqual(second, {
        ok: true,
        kind: "advanced",
        operationId: "plan:runtime-full:q:0",
        checkpoint: {
          schemaVersion: 2,
          planId: "plan:runtime-full",
          nextOperationIndex: 2,
          remoteSetId: "remote-set-1",
        },
      });
      assert.deepEqual(
        await loadMutationBudgetFile(budget, plan.planId),
        {
          ok: true,
          state: { version: 1, startedAtMs: 10_000, starts: 2 },
        },
      );
      assert.deepEqual(await loadWriteAttemptFile(attempt, plan), {
        ok: true,
        kind: "missing",
      });
      assert.deepEqual(
        commands.filter(
          (command) =>
            command.kind === "sets.create" ||
            command.kind === "questions.create",
        ),
        [
          {
            kind: "sets.create",
            title: "Synthetic set",
            description: "Synthetic description",
            private: true,
          },
          {
            kind: "questions.create",
            setId: "remote-set-1",
            number: 1,
            question: "Type sun.",
            answers: [{ text: "sun", correct: true }],
            qType: "typing",
            random: true,
            answerTypes: ["exactly"],
            timeLimit: 15,
          },
        ],
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
