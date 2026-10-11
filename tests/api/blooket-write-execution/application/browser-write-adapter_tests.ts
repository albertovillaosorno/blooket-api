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
//   - Unit tests for canonical-write to browser-surface adaptation.
// - Must-Not:
//   - Invoke a real browser, Blooket, filesystem, or retry loop.
// - Allows:
//   - Inputs: Fixed operations and deterministic browser-surface doubles.
//   - Outputs: Exact submissions, receipts, stops, and stable failures.
//   - Side effects: In-memory call recording only.
// - Split-When:
//   - Create/question browser surfaces gain independent adapters.
// - Merge-When:
//   - The write execution adapter is removed.
// - Summary:
//   - Proves only observed browser success can become a durable write receipt.
// - Description:
//   - Malformed Create Set IDs and surface exceptions fail closed.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - No confirmation is synthesized from target or operation data.
//
import assert from "node:assert/strict";
import test from "node:test";

import { blooketBrowserWriteExecutionPort } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/browser-write-adapter.ts";
import type { BlooketBrowserWriteSurfacePort } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/contract/browser-write-surface.ts";
import type { BlooketWriteOperation } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const setOperation: BlooketWriteOperation = {
  operationId: "plan:test:set",
  kind: "set",
  title: "Astronomy",
  description: "Review",
  visibility: "private",
  coverMediaId: null,
};

const questionOperation: BlooketWriteOperation = {
  operationId: "plan:test:q:0",
  kind: "question",
  localQuestionId: "q1",
  questionNumber: 1,
  question: {
    type: "typing-answer",
    prompt: "Type sun.",
    timeLimitSeconds: 10,
    imageMediaId: null,
    matchMode: "exact",
    answer: "sun",
  },
};

test(
  "confirmed Create Set success becomes an exact durable receipt",
  async () => {
  const calls: unknown[] = [];
  const surface: BlooketBrowserWriteSurfacePort = {
    createSet: async (submission) => {
      calls.push(submission);
      return { ok: true, remoteSetId: "remote-set-1" };
    },
    addQuestion: async () => ({ ok: true }),
  };
  const writes = blooketBrowserWriteExecutionPort(surface);

  assert.deepEqual(
    await writes.execute(
      setOperation,
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
  assert.equal(calls.length, 1);
  },
);

test(
  "confirmed Add Question success never invents a question receipt",
  async () => {
  const calls: unknown[] = [];
  const surface: BlooketBrowserWriteSurfacePort = {
    createSet: async () => ({ ok: true, remoteSetId: "unused" }),
    addQuestion: async (submission) => {
      calls.push(submission);
      return { ok: true };
    },
  };
  const writes = blooketBrowserWriteExecutionPort(surface);

  assert.deepEqual(
    await writes.execute(
      questionOperation,
      { remoteSetId: "remote-set-1" },
      { preparedMedia: [] },
    ),
    { ok: true, receipt: null },
  );
  assert.deepEqual(
    calls,
    [{
      schemaVersion: 1,
      kind: "add-question",
      remoteSetId: "remote-set-1",
      number: 1,
      question: "Type sun.",
      answers: [{ kind: "text", text: "sun", correct: true }],
      image: null,
      audio: "",
      qType: "typing",
      random: true,
      answerTypes: ["exactly"],
      timeLimit: 10,
    }],
  );
  },
);

test("navigation stops pass through without becoming success", async () => {
  const surface: BlooketBrowserWriteSurfacePort = {
    createSet: async () => ({
      ok: false,
      kind: "navigation",
      state: "security-challenge",
    }),
    addQuestion: async () => ({ ok: true }),
  };
  const writes = blooketBrowserWriteExecutionPort(surface);

  assert.deepEqual(
    await writes.execute(
      setOperation,
      { remoteSetId: null },
      { preparedMedia: [] },
    ),
    {
      ok: false,
      kind: "navigation",
      state: "security-challenge",
    },
  );
});

test(
  "malformed success data exceptions and bad targets fail closed",
  async () => {
  const malformed = blooketBrowserWriteExecutionPort({
    createSet: async () => ({ ok: true, remoteSetId: "" }),
    addQuestion: async () => ({ ok: true }),
  });
  assert.deepEqual(
    await malformed.execute(
      setOperation,
      { remoteSetId: null },
      { preparedMedia: [] },
    ),
    {
      ok: false,
      kind: "browser",
      code: "blooket-browser-failed",
    },
  );

  const throwing = blooketBrowserWriteExecutionPort({
    createSet: async () => {
      throw new Error("fixture failure");
    },
    addQuestion: async () => ({ ok: true }),
  });
  assert.deepEqual(
    await throwing.execute(
      setOperation,
      { remoteSetId: null },
      { preparedMedia: [] },
    ),
    {
      ok: false,
      kind: "browser",
      code: "blooket-browser-failed",
    },
  );

  assert.deepEqual(
    await malformed.execute(
      questionOperation,
      { remoteSetId: null },
      { preparedMedia: [] },
    ),
    {
      ok: false,
      kind: "browser",
      code: "blooket-browser-failed",
    },
  );
  },
);

test(
  "browser surface receives the exact admitted prepared media snapshot",
  async () => {
  const operation: BlooketWriteOperation = {
    ...setOperation,
    coverMediaId: "cover",
  };
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const snapshots: unknown[] = [];
  const writes = blooketBrowserWriteExecutionPort({
    createSet: async (_submission, media) => {
      snapshots.push(media);
      return { ok: true, remoteSetId: "remote-set-1" };
    },
    addQuestion: async () => ({ ok: true }),
  });

  const result = await writes.execute(
    operation,
    { remoteSetId: null },
    {
      preparedMedia: [{
        mediaId: "cover",
        revision: 4,
        format: "png",
        bytes,
      }],
    },
  );

  assert.equal(result.ok, true);
  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0] as Array<{ bytes: Uint8Array }>;
  assert.equal(snapshot[0]?.bytes, bytes);
  },
);

test(
  "browser surface is never called with missing or extra prepared media",
  async () => {
  const operation: BlooketWriteOperation = {
    ...setOperation,
    coverMediaId: "cover",
  };
  const calls: string[] = [];
  const writes = blooketBrowserWriteExecutionPort({
    createSet: async () => {
      calls.push("create");
      return { ok: true, remoteSetId: "remote-set-1" };
    },
    addQuestion: async () => ({ ok: true }),
  });
  const valid = {
    mediaId: "cover",
    revision: 1,
    format: "jpeg" as const,
    bytes: new Uint8Array(1),
  };

  for (const preparedMedia of [
    [],
    [valid, { ...valid, mediaId: "extra" }],
  ]) {
    assert.deepEqual(
      await writes.execute(
        operation,
        { remoteSetId: null },
        { preparedMedia },
      ),
      {
        ok: false,
        kind: "browser",
        code: "blooket-browser-failed",
      },
    );
  }
  assert.deepEqual(calls, []);
  },
);


test("only exact browser write acknowledgements become durable receipts",
  async () => {
  const malformedCreate: unknown[] = [
    { ok: true, remoteSetId: "remote-set-1", diagnostic: "untrusted" },
    { ok: true, remoteSetId: "remote-set-1", receipt: { confirmed: false } },
    { ok: "true", remoteSetId: "remote-set-1" },
    { ok: true, remoteSetId: "" },
    { ok: true },
    null,
  ];
  const malformedQuestion: unknown[] = [
    { ok: true, diagnostic: "untrusted" },
    { ok: true, receipt: { kind: "question-created" } },
    { ok: 1 },
    { ok: "true" },
    null,
  ];
  for (const candidate of malformedCreate) {
    const surface = blooketBrowserWriteExecutionPort({
      createSet: async () => candidate as Awaited<ReturnType<
        BlooketBrowserWriteSurfacePort["createSet"]>>,
      addQuestion: async () => ({ ok: true }),
    });
    assert.deepEqual(await surface.execute(
      setOperation, { remoteSetId: null }, { preparedMedia: [] },
    ), { ok: false, kind: "browser", code: "blooket-browser-failed" });
  }
  for (const candidate of malformedQuestion) {
    const surface = blooketBrowserWriteExecutionPort({
      createSet: async () => ({ ok: true, remoteSetId: "unused" }),
      addQuestion: async () => candidate as Awaited<ReturnType<
        BlooketBrowserWriteSurfacePort["addQuestion"]>>,
    });
    assert.deepEqual(await surface.execute(
      questionOperation, { remoteSetId: "remote-set-1" },
      { preparedMedia: [] },
    ), { ok: false, kind: "browser", code: "blooket-browser-failed" });
  }
  },
);

test("malformed or extra browser stop fields cannot escape the adapter",
  async () => {
  const malformed: unknown[] = [
    { ok: false, kind: "navigation", state: "dashboard" },
    { ok: false, kind: "navigation", state: "security-challenge",
      account: "untrusted" },
    { ok: false, kind: "browser", code: "blooket-browser-failed",
      detail: "untrusted" },
    { ok: false, kind: "browser", code: "not-a-browser-code" },
    { ok: "false", kind: "navigation", state: "security-challenge" },
    { ok: false, kind: "unknown", code: "blooket-browser-failed" },
  ];
  for (const candidate of malformed) {
    const adapter = blooketBrowserWriteExecutionPort({
      createSet: async () => candidate as Awaited<ReturnType<
        BlooketBrowserWriteSurfacePort["createSet"]>>,
      addQuestion: async () => candidate as Awaited<ReturnType<
        BlooketBrowserWriteSurfacePort["addQuestion"]>>,
    });
    for (const [operation, target] of [
      [setOperation, { remoteSetId: null }],
      [questionOperation, { remoteSetId: "remote-set-1" }],
    ] as const) assert.deepEqual(await adapter.execute(
      operation, target, { preparedMedia: [] },
    ), { ok: false, kind: "browser", code: "blooket-browser-failed" });
  }
  },
);
