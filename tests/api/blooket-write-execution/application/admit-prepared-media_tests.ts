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
  admitPreparedPublicationIdentities,
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

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const validPngBytes = (...body: number[]): Uint8Array =>
  new Uint8Array([...PNG_SIGNATURE, ...body]);

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
      bytes: new Uint8Array([255, 216, 255,
        ...new Array(Math.max(0, bytes - 3)).fill(0)]),
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

test("matching PNG, JPEG and GIF signatures retain bounded admission",
  async () => {
  const samples = [
    { format: "png" as const, bytes: validPngBytes(1, 2) },
    { format: "jpeg" as const,
      bytes: new Uint8Array([255, 216, 255, 217]) },
    { format: "gif" as const,
      bytes: new Uint8Array([71, 73, 70, 56, 57, 97, 0, 0]) },
  ];
  for (const sample of samples) {
    const reads: string[] = [];
    const admitted = await admitBlooketPreparedMedia(multipleChoice, {
      read: async mediaId => {
        reads.push(mediaId);
        return { ok: true, value: { mediaId, revision: 3,
          format: sample.format, bytes: sample.bytes } };
      },
    });
    assert.equal(admitted.ok, true, sample.format);
    if (admitted.ok) {
      assert.deepEqual(admitted.media.map(item => item.format),
        [sample.format, sample.format]);
    }
    assert.deepEqual(reads, ["shared", "moon"]);
  }
});

test("declared prepared image format must match its actual bytes",
  async () => {
  for (const [format, bytes] of [
    ["png", new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    ["jpeg", new Uint8Array([0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a])],
    ["gif", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
  ] as const) {
    const calls: string[] = [];
    assert.deepEqual(await admitBlooketPreparedMedia(
      multipleChoice, { read: async mediaId => {
        calls.push(mediaId);
        return { ok: true, value: { mediaId, revision: 3,
          format, bytes } };
      } },
    ), { ok: false, code: "blooket-media-invalid", mediaId: "shared" });
    assert.deepEqual(calls, ["shared"]);
  }
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
  const bytes = validPngBytes(1, 2, 3);
  const result = await admitBlooketPreparedMedia(multipleChoice, {
    read: async mediaId => {
      if (mediaId === "moon") bytes.set([9, 9, 9], 8);
      return { ok: true, value: {
        mediaId, revision: 3, format: "png", bytes,
      } };
    },
  });
  assert.ok(result.ok);
  assert.deepEqual(Array.from(result.media[0]!.bytes),
    Array.from(validPngBytes(1, 2, 3)));
  bytes.fill(0);
  assert.deepEqual(Array.from(result.media[1]!.bytes),
    Array.from(validPngBytes(9, 9, 9)));
});

test("a durable media identity refuses changed bytes, format or revision",
  async () => {
  const { identifyPreparedMedia } = await import(
// jig-ignore-next-line: TypeScript module specifier is indivisible.
    "../../../../src/projects/blooket-write-plans/domain/prepared-media-identities.ts"
  );
  const prepared = { mediaId: "sun", revision: 3, format: "png" as const,
    bytes: validPngBytes(1, 2, 3) };
  const expected = { schemaVersion: 1 as const,
    items: [identifyPreparedMedia(prepared)!] };
  const operation: BlooketWriteOperation = { ...multipleChoice,
    kind: "question", localQuestionId: "q1", questionNumber: 1,
    question: { type: "typing-answer", prompt: "Type sun.",
      timeLimitSeconds: 10, imageMediaId: "sun", matchMode: "exact",
      answer: "sun" } };
  for (const change of [{}, { revision: 4 }, { format: "gif" as const },
    { bytes: validPngBytes(3, 2, 1) },
    { bytes: validPngBytes(1, 2) }]) {
    const actual = { ...prepared, ...change };
    const result = await admitBlooketPreparedMedia(operation,
      { read: async () => ({ ok: true, value: actual }) }, expected);
    assert.equal(result.ok, Object.keys(change).length === 0);
    if (!result.ok) assert.equal(result.code,
      "format" in change ? "blooket-media-invalid" :
        "blooket-media-stale");
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


test("prepared media port getters cannot execute during admission",
  async () => {
  for (const variation of ["ok", "value", "mediaId", "bytes",
    "hidden", "symbol"] as const) {
    let reads = 0;
    const detail = { mediaId: "shared", revision: 3, format: "png",
      bytes: new Uint8Array([1, 2, 3]) };
    let response: object = { ok: true, value: detail };
    if (variation === "ok" || variation === "value") {
      response = Object.defineProperty({ ...response }, variation, {
        enumerable: true, get() { reads++; throw Error("executed"); },
      });
    } else if (variation === "mediaId" || variation === "bytes") {
      Object.defineProperty(detail, variation, { enumerable: true,
        get() { reads++; throw Error("executed"); } });
    } else if (variation === "hidden") {
      Object.defineProperty(detail, "hidden", { value: true });
    } else {
      Object.defineProperty(response, Symbol("hidden"), { value: true });
    }
    const calls: string[] = [];
    assert.deepEqual(await admitBlooketPreparedMedia(multipleChoice,
      port(() => response as BlooketPreparedMediaReadResult, calls)), {
      ok: false, code: "blooket-media-invalid", mediaId: "shared",
    });
    assert.equal(reads, 0);
    assert.deepEqual(calls, ["shared"]);
  }
  },
);

test("prepared media copies typed slots without inherited iterators",
  async () => {
    let iteratorCalls = 0;
    let countCalls = 0;
    class UntrustedBytes extends Uint8Array {
      override get byteLength(): number {
        countCalls++;
        throw new Error("subclass length getter executed");
      }
      override *[Symbol.iterator](): ArrayIterator<number> {
        iteratorCalls++;
        throw new Error("subclass iterator executed");
      }
    }
    const bytes = new UntrustedBytes(validPngBytes(1, 2, 3));
    const admitted = await admitBlooketPreparedMedia({
      operationId: "plan:test:q:typing", kind: "question",
      localQuestionId: "q1", questionNumber: 1,
      question: { type: "typing-answer", prompt: "Type sun.",
        timeLimitSeconds: 15, imageMediaId: "shared",
        matchMode: "exact", answer: "sun" },
    }, { read: async () => ({ ok: true, value: {
      mediaId: "shared", revision: 3, format: "png", bytes,
    } }) });
    assert.equal(admitted.ok, true);
    if (!admitted.ok) return;
    assert.deepEqual(Array.from(admitted.media[0]!.bytes),
      Array.from(validPngBytes(1, 2, 3)));
    assert.equal(iteratorCalls, 0);
    assert.equal(countCalls, 0);
  },
);


test("media lookup IDs stay fixed across asynchronous read callbacks",
  async () => {
  const operation: BlooketWriteOperation = {
    ...multipleChoice,
    question: { ...multipleChoice.question,
      answers: [...multipleChoice.question.answers] },
  };
  const calls: string[] = [];
  const result = await admitBlooketPreparedMedia(operation, {
    read: async mediaId => {
      calls.push(mediaId);
      if (calls.length === 1 && operation.kind === "question" &&
          operation.question.type === "multiple-choice") {
        (operation.question.answers as { imageMediaId: string | null }[])[1]!
          .imageMediaId = "injected-after-await";
      }
      return prepared(mediaId);
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["shared", "moon"]);
  },
);


const syntheticPublication = {
  schemaVersion: 1 as const, title: "Prepared images",
  description: "Local fixture", quizLanguage: "English",
  visibility: "private" as const, mediaIndex: "media.jsonl",
  coverImage: null,
  questions: [{
    id: "q1", type: "typing-answer" as const, prompt: "Type sun.",
    timeLimitSeconds: 15, matchMode: "exactly" as const,
    answer: "sun", image: { description: "Sun", mediaId: "shared" },
  }, {
    id: "q2", type: "typing-answer" as const, prompt: "Type sky.",
    timeLimitSeconds: 15, matchMode: "exactly" as const,
    answer: "sky", image: { description: "Sky", mediaId: "shared" },
  }],
};

test("snapshot media identities deduplicate stable IDs and freeze hashes",
  async () => {
  const calls: string[] = [];
  const result = await admitPreparedPublicationIdentities(
    syntheticPublication, port(id => prepared(id), calls),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(calls, ["shared"]);
  assert.deepEqual(result.identities.items.map(item =>
    [item.mediaId, item.revision, item.format, item.byteLength]),
  [["shared", 3, "jpeg", 128]]);
  assert.match(result.identities.items[0]!.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result.identities).includes("bytes"), false);
});

test("unresolved project images do not read a media port", async () => {
  const calls: string[] = [];
  const result = await admitPreparedPublicationIdentities({
    ...syntheticPublication,
    questions: [{ ...syntheticPublication.questions[0]!,
      image: { description: "Missing asset", mediaId: null } }],
  }, port(id => prepared(id), calls));
  assert.deepEqual(result, {
    ok: false, code: "blooket-media-not-prepared", mediaId: "unresolved",
  });
  assert.deepEqual(calls, []);
});

test("invalid oversized or mismatched media cannot freeze a publication",
  async () => {
  for (const result of [
    prepared("foreign"),
    { ok: true as const, value: { mediaId: "shared", revision: 1,
      format: "png" as const, bytes: new Uint8Array(2_500_000) } },
  ]) {
    const stopped = await admitPreparedPublicationIdentities(
      syntheticPublication, port(() => result, []),
    );
    assert.deepEqual(stopped, { ok: false,
      code: "blooket-media-invalid", mediaId: "shared" });
  }
});

test("more than 200 distinct publication images stop before media reads",
  async () => {
  const calls: string[] = [];
  const document = { ...syntheticPublication,
    questions: Array.from({ length: 201 }, (_, index) => ({
      ...syntheticPublication.questions[0]!, id: "q" + (index + 1),
      image: { description: "Synthetic image", mediaId: "asset" + index },
    })),
  };
  assert.deepEqual(await admitPreparedPublicationIdentities(document,
    port(id => prepared(id), calls)), {
    ok: false, code: "blooket-media-invalid", mediaId: "snapshot",
  });
  assert.deepEqual(calls, []);
});

test("canceled media snapshot stops before subsequent stable-ID reads",
  async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const document = { ...syntheticPublication,
    questions: [syntheticPublication.questions[0]!, {
      ...syntheticPublication.questions[1]!,
      image: { description: "Sky", mediaId: "sky" },
    }],
  };
  const result = await admitPreparedPublicationIdentities(document, {
    read: async mediaId => {
      calls.push(mediaId);
      controller.abort();
      return prepared(mediaId);
    },
  }, controller.signal);
  assert.deepEqual(result, { ok: false,
    code: "blooket-publication-cancelled", mediaId: "shared" });
  assert.deepEqual(calls, ["shared"]);
});

test("pre-canceled media snapshot does not open a prepared media port",
  async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  const result = await admitPreparedPublicationIdentities(
    syntheticPublication, { read: async () => {
      reads++;
      throw Error("must-not-read-after-abort");
    } }, controller.signal,
  );
  assert.deepEqual(result, { ok: false,
    code: "blooket-publication-cancelled", mediaId: "snapshot" });
  assert.equal(reads, 0);
});

test("Stop resolves a stalled prepared-media lookup without waiting for I/O",
  async () => {
  const controller = new AbortController();
  let release!: (result: BlooketPreparedMediaReadResult) => void;
  let notifyRead!: () => void;
  const entered = new Promise<void>(resolve => { notifyRead = resolve; });
  const waiting = new Promise<BlooketPreparedMediaReadResult>(resolve => {
    release = resolve;
  });
  const lookup = admitPreparedPublicationIdentities(
    syntheticPublication, { read: async () => {
      notifyRead();
      return await waiting;
    } }, controller.signal,
  );
  await entered;
  controller.abort();
  try {
    const outcome = await Promise.race([
      lookup,
      new Promise<"hung">(resolve =>
        setTimeout(() => resolve("hung"), 150)),
    ]);
    assert.deepEqual(outcome, { ok: false,
      code: "blooket-publication-cancelled", mediaId: "shared" });
  } finally {
    release(prepared("shared"));
    await lookup;
  }
});
