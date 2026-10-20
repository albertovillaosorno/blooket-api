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

import { blooketBrowserWriteExecutionPort, isBrowserWriteExecutionPort,
  browserCreateSetConfirmationSupported } from
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

test("browser transport identity cannot be copied into another writer", () => {
  const port = blooketBrowserWriteExecutionPort({
    createSet: async () => ({ ok: false, kind: "browser",
      code: "blooket-browser-failed" }),
    addQuestion: async () => ({ ok: false, kind: "browser",
      code: "blooket-browser-failed" }),
  });
  assert.equal(isBrowserWriteExecutionPort(port), true);
  assert.equal(isBrowserWriteExecutionPort({ ...port }), false);
  assert.equal(Object.isFrozen(port), true);
});

test("browser confirmation support needs an owned fresh probe", async () => {
  const base: BlooketBrowserWriteSurfacePort = {
    createSet: async () => ({ ok: false, kind: "browser",
      code: "blooket-browser-failed" }),
    addQuestion: async () => ({ ok: false, kind: "browser",
      code: "blooket-browser-failed" }),
  };
  assert.equal(await browserCreateSetConfirmationSupported(
    blooketBrowserWriteExecutionPort(base)), false);
  let supported = true;
  const port = blooketBrowserWriteExecutionPort({ ...base,
    inspectCreateSetConfirmation: async () => supported });
  assert.equal(await browserCreateSetConfirmationSupported(port), true);
  assert.equal(await browserCreateSetConfirmationSupported({ ...port }),
    false);
  supported = false;
  assert.equal(await browserCreateSetConfirmationSupported(port), false);
  const throwing = blooketBrowserWriteExecutionPort({ ...base,
    inspectCreateSetConfirmation: async () => { throw new Error("offline"); }
  });
  assert.equal(await browserCreateSetConfirmationSupported(throwing), false);
  let getterCalls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, "inspectCreateSetConfirmation", {
    enumerable: true, get: () => { getterCalls++; return async () => true; },
  });
  assert.equal(await browserCreateSetConfirmationSupported(
    blooketBrowserWriteExecutionPort(accessor)), false);
  assert.equal(getterCalls, 0);
});

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
  assert.notEqual(snapshot[0]?.bytes, bytes);
  assert.deepEqual([...snapshot[0]!.bytes], [1, 2, 3, 4]);
  bytes[0] = 200;
  assert.deepEqual([...snapshot[0]!.bytes], [1, 2, 3, 4]);
  },
);

test("admitted image bytes remain stable during an asynchronous upload",
  async () => {
  const bytes = new Uint8Array([11, 22, 33, 44]);
  let observed: Uint8Array | undefined;
  let release: (() => void) | undefined;
  const writes = blooketBrowserWriteExecutionPort({
    createSet: async (_submission, media) => {
      observed = media[0]?.bytes;
      await new Promise<void>(resolve => { release = resolve; });
      assert.deepEqual([...observed!], [11, 22, 33, 44]);
      return { ok: true, remoteSetId: "remote-set-1" };
    },
    addQuestion: async () => ({ ok: true }),
  });
  const pending = writes.execute({ ...setOperation, coverMediaId: "cover" },
    { remoteSetId: null }, { preparedMedia: [{
      mediaId: "cover", revision: 1, format: "png", bytes,
    }] });
  assert.ok(release);
  bytes.set([9, 9, 9, 9]);
  release!();
  assert.deepEqual(await pending, {
    ok: true, receipt: { kind: "set-created", remoteSetId: "remote-set-1" },
  });
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


test("media list proxy cannot hide a foreign payload before upload",
  async () => {
  const operation = { ...setOperation, coverMediaId: "cover" };
  const admitted = { mediaId: "cover", revision: 1,
    format: "png" as const, bytes: new Uint8Array([1, 2, 3]) };
  let dispatched = 0;
  const surface = blooketBrowserWriteExecutionPort({
    createSet: async () => {
      dispatched++;
      return { ok: true, remoteSetId: "remote-set-1" };
    },
    addQuestion: async () => ({ ok: true }),
  });
  const hidden = new Proxy([admitted, { ...admitted, mediaId: "foreign" }], {
    get(target, key, receiver) {
      if (key === "length") return 1;
      if (key === "some") return () => false;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.deepEqual(await surface.execute(operation,
    { remoteSetId: null }, { preparedMedia: hidden }),
  { ok: false, kind: "browser", code: "blooket-browser-failed" });
  assert.equal(dispatched, 0);
  },
);

test("media object property traps cannot impersonate the required ID",
  async () => {
  let reads = 0;
  let uploads = 0;
  const item = new Proxy({ mediaId: "foreign", revision: 1,
    format: "png" as const, bytes: new Uint8Array([1, 2, 3]) }, {
    get(target, key, receiver) {
      if (key === "mediaId") { reads++; return "cover"; }
      return Reflect.get(target, key, receiver);
    },
  });
  const surface = blooketBrowserWriteExecutionPort({
    createSet: async () => {
      uploads++;
      return { ok: true, remoteSetId: "remote-set-1" };
    },
    addQuestion: async () => ({ ok: true }),
  });
  assert.deepEqual(await surface.execute({ ...setOperation,
    coverMediaId: "cover" }, { remoteSetId: null },
  { preparedMedia: [item] }),
  { ok: false, kind: "browser", code: "blooket-browser-failed" });
  assert.equal(reads, 0);
  assert.equal(uploads, 0);
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

test("browser adapter refuses proxy-spoofed durable write receipts",
  async () => {
  let reads = 0;
  const forged = <T extends object>(value: T) => new Proxy(value, {
    get(target, key, receiver) {
      if (key === "ok" || key === "remoteSetId") {
        reads++;
        return key === "ok" ? true : "remote-set-1";
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const surface = blooketBrowserWriteExecutionPort({
    createSet: async () => forged({ ok: false as const,
      remoteSetId: "unrelated-set" }) as never,
    addQuestion: async () => forged({ ok: false as const }) as never,
  });
  for (const [operation, target] of [
    [setOperation, { remoteSetId: null }],
    [questionOperation, { remoteSetId: "remote-set-1" }],
  ] as const) {
    assert.deepEqual(await surface.execute(operation, target,
      { preparedMedia: [] }),
    { ok: false, kind: "browser", code: "blooket-browser-failed" });
  }
  assert.equal(reads, 0);
  },
);

test("browser adapter preserves owned stops rather than proxy claims",
  async () => {
  const cases = [
    { own: { ok: false, kind: "navigation", state: "signed-out" },
      expected: { ok: false, kind: "navigation", state: "signed-out" } },
    { own: { ok: false, kind: "browser",
      code: "blooket-browser-unavailable" },
      expected: { ok: false, kind: "browser",
        code: "blooket-browser-unavailable" } },
  ];
  let reads = 0;
  for (const candidate of cases) {
    const reply = new Proxy(candidate.own, { get(target, key, receiver) {
      if (key === "state" || key === "code" || key === "kind" ||
          key === "ok") reads++;
      if (key === "state") return "security-challenge";
      if (key === "code") return "blooket-browser-failed";
      return Reflect.get(target, key, receiver);
    } });
    const surface = blooketBrowserWriteExecutionPort({
      createSet: async () => reply as never,
      addQuestion: async () => reply as never,
    });
    for (const [operation, target] of [
      [setOperation, { remoteSetId: null }],
      [questionOperation, { remoteSetId: "remote-set-1" }],
    ] as const)
      assert.deepEqual(await surface.execute(operation, target,
        { preparedMedia: [] }), candidate.expected);
  }
  assert.equal(reads, 0);
  },
);

test("browser write adapter never invokes accessor-backed acknowledgements",
  async () => {
  let getterCalls = 0;
  const altered = (source: Record<string, unknown>, field: string) => {
    const value = { ...source };
    Object.defineProperty(value, field, {
      enumerable: true,
      get() { getterCalls++; throw Error("write getter must not run"); },
    });
    return value;
  };
  for (const [reply, field] of [
    [{ ok: true, remoteSetId: "set-fixture" }, "ok"],
    [{ ok: true, remoteSetId: "set-fixture" }, "remoteSetId"],
    [{ ok: false, kind: "navigation", state: "security-challenge" }, "kind"],
    [{ ok: false, kind: "navigation", state: "security-challenge" }, "state"],
    [{ ok: false, kind: "browser", code: "blooket-browser-failed" }, "code"],
  ] as const) {
    const surface = blooketBrowserWriteExecutionPort({
      createSet: async () => altered(reply, field) as Awaited<ReturnType<
        BlooketBrowserWriteSurfacePort["createSet"]>>,
      addQuestion: async () => ({ ok: true }),
    });
    assert.deepEqual(await surface.execute(setOperation,
      { remoteSetId: null }, { preparedMedia: [] }), {
      ok: false, kind: "browser", code: "blooket-browser-failed",
    });
  }
  for (const [reply, field] of [
    [{ ok: true }, "ok"],
    [{ ok: false, kind: "navigation", state: "security-challenge" }, "ok"],
    [{ ok: false, kind: "browser", code: "blooket-browser-failed" }, "kind"],
  ] as const) {
    const surface = blooketBrowserWriteExecutionPort({
      createSet: async () => ({ ok: true, remoteSetId: "unused" }),
      addQuestion: async () => altered(reply, field) as Awaited<ReturnType<
        BlooketBrowserWriteSurfacePort["addQuestion"]>>,
    });
    assert.deepEqual(await surface.execute(questionOperation,
      { remoteSetId: "set-fixture" }, { preparedMedia: [] }), {
      ok: false, kind: "browser", code: "blooket-browser-failed",
    });
  }
  assert.equal(getterCalls, 0);
  },
);


for (const supported of [false, true]) {
  test(`replacement ${supported ? "uses its dedicated surface" :
    "never falls back to append"}`, async () => {
    const { replacementFixture } = await import(
      "../../../projects/blooket-write-plans/domain/replacement-fixtures.ts");
    const { buildBlooketReplacementPlan } = await import(
// jig-ignore-next-line: TypeScript module specifier is indivisible.
      "../../../../src/projects/blooket-write-plans/domain/replacement-plan.ts");
    const f = replacementFixture();
    const replacement = buildBlooketReplacementPlan(f.desired, {
      remoteSetId: "fixture", baseline: { schemaVersion: 1,
        kind: "question-list", itemCount: 2, sha256: "a".repeat(64) },
    }, f.previous)!;
    let appends = 0, replacements = 0;
    const surface: BlooketBrowserWriteSurfacePort = {
      createSet: async () => { throw Error("never create during edit"); },
      addQuestion: async () => { appends++; return { ok: true }; },
      ...(supported ? { replaceQuestion: async submission => {
        replacements++;
        assert.equal(submission.kind, "replace-question");
        assert.equal(submission.number, 2);
        assert.equal(submission.previous.question, "Old second question.");
        assert.equal(submission.timeLimit, 20);
        return { ok: true as const };
      } } : {}),
    };
    const result = await blooketBrowserWriteExecutionPort(surface).execute(
      replacement.operations[0], { remoteSetId: "fixture" },
      { preparedMedia: [] });
    assert.equal(appends, 0);
    assert.equal(replacements, supported ? 1 : 0);
    assert.deepEqual(result, supported ? { ok: true, receipt: null }
      : { ok: false, kind: "browser", code: "blooket-browser-failed" });
  });
}
