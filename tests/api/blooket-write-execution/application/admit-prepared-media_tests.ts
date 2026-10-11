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
//   - Portable tests for write-time stable-ID prepared-media admission.
// - Must-Not:
//   - Read a real library, decode images, upload, or contact Blooket.
// - Allows:
//   - Inputs: Synthetic operations and deterministic prepared-media ports.
//   - Outputs: Exact lookup ordering, deduplication, and refusal assertions.
//   - Side effects: In-memory call tracking only.
// - Split-When:
//   - Provider media admission gains independent format families.
// - Merge-When:
//   - Prepared-media admission is removed.
// - Summary:
//   - Proves stale, oversized, malformed, and unavailable media fail closed.
// - Description:
//   - Successful fixtures represent already decoded current prepared files.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - No-media operations make zero media-port calls.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  admitBlooketPreparedMedia,
  blooketWriteOperationMediaIds,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/admit-prepared-media.ts";
import type {
  BlooketPreparedMediaReadPort,
  BlooketPreparedMediaReadResult,
} from
  "../../../../src/api/blooket-write-execution/contract/prepared-media.ts";
import type { BlooketWriteOperation } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const multipleChoice: BlooketWriteOperation = {
  operationId: "plan:test:q:0",
  kind: "question",
  localQuestionId: "q1",
  questionNumber: 1,
  question: {
    type: "multiple-choice",
    prompt: "Which is the sun?",
    timeLimitSeconds: 20,
    randomOrder: true,
    imageMediaId: "shared",
    answers: [
      { text: null, correct: true, imageMediaId: "shared" },
      { text: null, correct: false, imageMediaId: "moon" },
    ],
  },
};

function port(
  result: (mediaId: string) => BlooketPreparedMediaReadResult,
  calls: string[],
): BlooketPreparedMediaReadPort {
  return {
    read: async (mediaId) => {
      calls.push(mediaId);
      return result(mediaId);
    },
  };
}

function prepared(
  mediaId: string,
  bytes = 128,
): BlooketPreparedMediaReadResult {
  return {
    ok: true,
    value: {
      mediaId,
      revision: 3,
      format: "jpeg",
      bytes: new Uint8Array(bytes),
    },
  };
}

test("operation media IDs are ordered and deduplicated", () => {
  assert.deepEqual(
    blooketWriteOperationMediaIds(multipleChoice),
    ["shared", "moon"],
  );
  assert.deepEqual(
    blooketWriteOperationMediaIds({
      operationId: "plan:test:set",
      kind: "set",
      title: "Fixture",
      description: "",
      visibility: "private",
      coverMediaId: null,
    }),
    [],
  );
});

test("prepared media admission reads each stable ID exactly once", async () => {
  const calls: string[] = [];
  const result = await admitBlooketPreparedMedia(
    multipleChoice,
    port((mediaId) => prepared(mediaId), calls),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(calls, ["shared", "moon"]);
  assert.deepEqual(
    result.media.map((item) => [item.mediaId, item.revision, item.format]),
    [
      ["shared", 3, "jpeg"],
      ["moon", 3, "jpeg"],
    ],
  );
});

test("no-media operations make no media-port calls", async () => {
  const calls: string[] = [];
  const operation: BlooketWriteOperation = {
    operationId: "plan:test:q:typing",
    kind: "question",
    localQuestionId: "typing",
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
  assert.deepEqual(
    await admitBlooketPreparedMedia(
      operation,
      port((mediaId) => prepared(mediaId), calls),
    ),
    { ok: true, media: [] },
  );
  assert.deepEqual(calls, []);
});

test(
  "missing and stale prepared media preserve stable refusal codes",
  async () => {
  for (const code of [
    "blooket-media-not-prepared",
    "blooket-media-stale",
    "blooket-media-unavailable",
  ] as const) {
    const result = await admitBlooketPreparedMedia(
      multipleChoice,
      port(() => ({ ok: false, code }), []),
    );
    assert.deepEqual(result, {
      ok: false,
      code,
      mediaId: "shared",
    });
  }
  },
);

test("malformed success and exact byte ceiling fail closed", async () => {
  const cases: BlooketPreparedMediaReadResult[] = [
    prepared("different"),
    {
      ok: true,
      value: {
        mediaId: "shared",
        revision: 0,
        format: "jpeg",
        bytes: new Uint8Array(1),
      },
    },
    {
      ok: true,
      value: {
        mediaId: "shared",
        revision: 1,
        format: "png",
        bytes: new Uint8Array(2_500_000),
      },
    },
  ];
  for (const candidate of cases) {
    assert.deepEqual(
      await admitBlooketPreparedMedia(
        multipleChoice,
        port(() => candidate, []),
      ),
      {
        ok: false,
        code: "blooket-media-invalid",
        mediaId: "shared",
      },
    );
  }
});

test(
  "media-port exceptions fail closed without reading later IDs",
  async () => {
  const calls: string[] = [];
  const media: BlooketPreparedMediaReadPort = {
    read: async (mediaId) => {
      calls.push(mediaId);
      throw new Error("synthetic-read-failure");
    },
  };
  assert.deepEqual(
    await admitBlooketPreparedMedia(multipleChoice, media),
    {
      ok: false,
      code: "blooket-media-unavailable",
      mediaId: "shared",
    },
  );
  assert.deepEqual(calls, ["shared"]);
  },
);


test("admission owns bytes before another media read can reuse a buffer",
  async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const result = await admitBlooketPreparedMedia(multipleChoice, {
    read: async mediaId => {
      if (mediaId === "moon") bytes.fill(9);
      return { ok: true, value: {
        mediaId, revision: 3, format: "png", bytes,
      } };
    },
  });
  assert.ok(result.ok);
  assert.deepEqual(Array.from(result.media[0]!.bytes), [1, 2, 3]);
  bytes.fill(0);
  assert.deepEqual(Array.from(result.media[1]!.bytes), [9, 9, 9]);
});

test("a durable media identity refuses changed bytes, format or revision",
  async () => {
  const { identifyPreparedMedia } = await import(
// jig-ignore-next-line: TypeScript module specifier is indivisible.
    "../../../../src/projects/blooket-write-plans/domain/prepared-media-identities.ts"
  );
  const prepared = { mediaId: "sun", revision: 3, format: "png" as const,
    bytes: new Uint8Array([1, 2, 3]) };
  const expected = { schemaVersion: 1 as const,
    items: [identifyPreparedMedia(prepared)!] };
  const operation: BlooketWriteOperation = { ...multipleChoice,
    kind: "question", localQuestionId: "q1", questionNumber: 1,
    question: { type: "typing-answer", prompt: "Type sun.",
      timeLimitSeconds: 10, imageMediaId: "sun", matchMode: "exact",
      answer: "sun" } };
  for (const change of [{}, { revision: 4 }, { format: "gif" as const },
    { bytes: new Uint8Array([3, 2, 1]) }, { bytes: new Uint8Array([1, 2]) }]) {
    const actual = { ...prepared, ...change };
    const result = await admitBlooketPreparedMedia(operation,
      { read: async () => ({ ok: true, value: actual }) }, expected);
    assert.equal(result.ok, Object.keys(change).length === 0);
    if (!result.ok) assert.equal(result.code, "blooket-media-stale");
  }
  let called = false;
  assert.equal((await admitBlooketPreparedMedia(operation, {
    read: async () => { called = true; throw new Error("must not read"); },
  }, { schemaVersion: 1, items: [] })).ok, false);
  assert.equal(called, false);
});

test("untrusted media read envelopes fail closed before later lookups",
  async () => {
  for (const result of [
    null,
    {},
    { ok: 1, value: { mediaId: "shared" } },
    { ok: false, code: "unknown-failure" },
    { ok: false, code: "blooket-media-stale", extra: true },
    { ok: false, code: "blooket-media-stale", value: null },
    { ok: true, value: null },
    { ok: true, value: undefined },
    { ok: true, value: {
      mediaId: "shared", revision: 3, format: "png",
      bytes: new Uint8Array([1, 2, 3]), extra: true,
    } },
    { ok: true, value: {
      mediaId: "shared", revision: 3, format: "png",
      bytes: new Uint8Array([1, 2, 3]),
    }, extra: true },
    { ok: true, value: new Proxy({}, {
      get: () => { throw Error("unreadable-prepared-media"); },
    }) },
  ]) {
    const calls: string[] = [];
    assert.deepEqual(await admitBlooketPreparedMedia(
      multipleChoice,
      port(() => result as BlooketPreparedMediaReadResult, calls),
    ), { ok: false, code: "blooket-media-invalid", mediaId: "shared" });
    assert.deepEqual(calls, ["shared"]);
  }
  },
);

test("malformed second-media replies cannot release partial media",
  async () => {
  const calls: string[] = [];
  assert.deepEqual(await admitBlooketPreparedMedia(
    multipleChoice,
    port(mediaId => mediaId === "shared" ? prepared(mediaId) :
      { ok: false, code: "not-an-admitted-code" } as
        BlooketPreparedMediaReadResult, calls),
  ), { ok: false, code: "blooket-media-invalid", mediaId: "moon" });
  assert.deepEqual(calls, ["shared", "moon"]);
  },
);
