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
//   - Unit tests for differential set and question verification over reads.
// - Must-Not:
//   - Contact Blooket, mutate remotely, or infer media identity.
// - Allows:
//   - Inputs: Deterministic list/detail probe sequences.
//   - Outputs: Baselines and exact confirmed/not-confirmed/inconclusive
//     verdicts.
//   - Side effects: In-memory probe call recording only.
// - Split-When:
//   - Set and question verification need separate test lifecycles.
// - Merge-When:
//   - Set verification no longer uses differential collection evidence.
// - Summary:
//   - Proves one exact new set is required before Create Set is confirmed.
// - Description:
//   - Duplicate titles and concurrent changes remain inconclusive.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Question media remains inconclusive without stable media identity.
//
import assert from "node:assert/strict";
import test from "node:test";

import { blooketSetReadWriteVerifier } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/set-read-verifier.ts";
import type { BlooketSetReadPort } from
  "../../../../src/api/blooket-set-reads/contract/set-reads.ts";
import type { BlooketQuestionReadPort } from
  "../../../../src/api/blooket-set-reads/contract/question-reads.ts";
import type { BlooketWriteOperation } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const operation: BlooketWriteOperation = {
  operationId: "plan:test:set",
  kind: "set",
  title: "Astronomy",
  description: "Review",
  visibility: "private",
  coverMediaId: null,
};

function summary(id: string, title: string) {
  return { schemaVersion: 1, id, title };
}

function detail(
  id: string,
  title: string,
  description = "Review",
  visibility: "public" | "private" = "private",
) {
  return {
    schemaVersion: 1,
    id,
    title,
    description,
    visibility,
  };
}

test("Create Set verifies only one exact post-state addition", async () => {
  const before = [summary("old-1", "Existing")];
  const after = [
    summary("old-1", "Existing"),
    summary("new-1", "Astronomy"),
  ];
  let lists = 0;
  const reads: BlooketSetReadPort = {
    list: async () => ({
      ok: true,
      value: lists++ === 0 ? before : after,
      completeness: "complete",
    }),
    get: async (id) => ({
      ok: true,
      value: detail(id, "Astronomy"),
    }),
  };
  const verifier = blooketSetReadWriteVerifier(reads);

  const captured = await verifier.captureBaseline(
    operation,
    { remoteSetId: null },
  );
  assert.equal(captured.ok, true);
  if (!captured.ok) {
    return;
  }

  assert.deepEqual(
    await verifier.verify(
      operation,
      { remoteSetId: null },
      captured.baseline,
    ),
    {
      ok: true,
      outcome: "confirmed",
      receipt: {
        kind: "set-created",
        remoteSetId: "new-1",
      },
    },
  );
});

test("unchanged set collection proves non-confirmation", async () => {
  const sets = [summary("old-1", "Existing")];
  const reads: BlooketSetReadPort = {
    list: async () => ({
      ok: true,
      value: sets,
      completeness: "complete",
    }),
    get: async () => {
      throw new Error("detail should not be read");
    },
  };
  const verifier = blooketSetReadWriteVerifier(reads);
  const captured = await verifier.captureBaseline(
    operation,
    { remoteSetId: null },
  );
  assert.equal(captured.ok, true);
  if (!captured.ok) {
    return;
  }

  assert.deepEqual(
    await verifier.verify(
      operation,
      { remoteSetId: null },
      captured.baseline,
    ),
    { ok: true, outcome: "not-confirmed" },
  );
});

test(
  "concurrent changes and metadata mismatches stay inconclusive",
  async () => {
  const before = [summary("old-1", "Existing")];
  let current = [
    summary("old-1", "Existing"),
    summary("new-1", "Astronomy"),
    summary("other", "Concurrent"),
  ];
  const reads: BlooketSetReadPort = {
    list: async () => ({
      ok: true,
      value: current,
      completeness: "complete",
    }),
    get: async (id) => ({
      ok: true,
      value: detail(id, "Astronomy", "Different"),
    }),
  };
  const verifier = blooketSetReadWriteVerifier(reads);

  const captureReads: BlooketSetReadPort = {
    list: async () => ({
      ok: true,
      value: before,
      completeness: "complete",
    }),
    get: reads.get,
  };
  const captured = await blooketSetReadWriteVerifier(
    captureReads,
  ).captureBaseline(operation, { remoteSetId: null });
  assert.equal(captured.ok, true);
  if (!captured.ok) {
    return;
  }

  assert.deepEqual(
    await verifier.verify(
      operation,
      { remoteSetId: null },
      captured.baseline,
    ),
    { ok: true, outcome: "inconclusive" },
  );

  current = [
    summary("old-1", "Existing"),
    summary("new-1", "Astronomy"),
  ];
  assert.deepEqual(
    await verifier.verify(
      operation,
      { remoteSetId: null },
      captured.baseline,
    ),
    { ok: true, outcome: "inconclusive" },
  );
  },
);

test(
  "set covers remain inconclusive because reads do not observe them",
  async () => {
  const before = [summary("old-1", "Existing")];
  const after = [
    summary("old-1", "Existing"),
    summary("new-1", "Astronomy"),
  ];
  let lists = 0;
  let detailReads = 0;
  const reads: BlooketSetReadPort = {
    list: async () => ({
      ok: true,
      value: lists++ === 0 ? before : after,
      completeness: "complete",
    }),
    get: async (id) => {
      detailReads += 1;
      return {
        ok: true,
        value: detail(id, "Astronomy"),
      };
    },
  };
  const verifier = blooketSetReadWriteVerifier(reads);
  const withCover: BlooketWriteOperation = {
    ...operation,
    coverMediaId: "cover-1",
  };

  const captured = await verifier.captureBaseline(
    withCover,
    { remoteSetId: null },
  );
  assert.equal(captured.ok, true);
  if (!captured.ok) {
    return;
  }
  assert.deepEqual(
    await verifier.verify(
      withCover,
      { remoteSetId: null },
      captured.baseline,
    ),
    { ok: true, outcome: "inconclusive" },
  );
  assert.equal(detailReads, 0);
  },
);

test(
  "questions remain explicitly unverifiable without a read shape",
  async () => {
  const reads: BlooketSetReadPort = {
    list: async () => {
      throw new Error("question verification must not list sets");
    },
    get: async () => {
      throw new Error("question verification must not read set detail");
    },
  };
  const verifier = blooketSetReadWriteVerifier(reads);
  const question: BlooketWriteOperation = {
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

  assert.deepEqual(
    await verifier.captureBaseline(
      question,
      { remoteSetId: "remote-set-1" },
    ),
    { ok: true, baseline: null },
  );
  assert.deepEqual(
    await verifier.verify(
      question,
      { remoteSetId: "remote-set-1" },
      null,
    ),
    { ok: true, outcome: "inconclusive" },
  );
  },
);

function typingOperation(
  imageMediaId: string | null = null,
): BlooketWriteOperation {
  return {
    operationId: "plan:test:q:0",
    kind: "question",
    localQuestionId: "q1",
    questionNumber: 1,
    question: {
      type: "typing-answer",
      prompt: "Type sun.",
      timeLimitSeconds: 10,
      imageMediaId,
      matchMode: "exact",
      answer: "sun",
    },
  };
}

function remoteTyping(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    schemaVersion: 1,
    number: 1,
    question: "Type sun.",
    qType: "typing",
    random: true,
    timeLimit: 10,
    answers: ["sun"],
    correctAnswers: ["sun"],
    answerTypes: ["exactly"],
    hasImage: false,
    hasAudio: false,
    ...overrides,
  };
}

function questionReads(
  values: readonly (readonly unknown[])[],
): BlooketQuestionReadPort {
  let index = 0;
  return {
    list: async () => ({
      ok: true,
      value: values[index++] ?? values.at(-1) ?? [],
    }),
  };
}

test("exact text question addition is confirmed from differential reads",
  async () => {
  const sets: BlooketSetReadPort = {
    list: async () => {
      throw new Error("question verification must not list sets");
    },
    get: async () => {
      throw new Error("question verification must not get set metadata");
    },
  };
  const verifier = blooketSetReadWriteVerifier(
    sets,
    questionReads([[], [remoteTyping()]]),
  );
  const operation = typingOperation();
  const target = { remoteSetId: "remote-set-1" };
  const captured = await verifier.captureBaseline(operation, target);
  assert.equal(captured.ok, true);
  if (!captured.ok) return;
  assert.equal(captured.baseline?.kind, "question-list");
  assert.equal(captured.baseline?.itemCount, 0);

  assert.deepEqual(
    await verifier.verify(operation, target, captured.baseline),
    { ok: true, outcome: "confirmed", receipt: null },
  );
  },);

test("unchanged question collection proves non-confirmation", async () => {
  const sets: BlooketSetReadPort = {
    list: async () => ({
      ok: true,
      value: [],
      completeness: "complete",
    }),
    get: async () => ({ ok: true, value: {} }),
  };
  const verifier = blooketSetReadWriteVerifier(
    sets,
    questionReads([[], []]),
  );
  const operation = typingOperation();
  const target = { remoteSetId: "remote-set-1" };
  const captured = await verifier.captureBaseline(operation, target);
  assert.equal(captured.ok, true);
  if (!captured.ok) return;

  assert.deepEqual(
    await verifier.verify(operation, target, captured.baseline),
    { ok: true, outcome: "not-confirmed" },
  );
});

test("question media and concurrent edits remain inconclusive", async () => {
  const sets: BlooketSetReadPort = {
    list: async () => ({
      ok: true,
      value: [],
      completeness: "complete",
    }),
    get: async () => ({ ok: true, value: {} }),
  };
  const mediaVerifier = blooketSetReadWriteVerifier(
    sets,
    questionReads([[], [remoteTyping({ hasImage: true })]]),
  );
  const mediaOperation = typingOperation("media-1");
  const target = { remoteSetId: "remote-set-1" };
  const mediaBaseline = await mediaVerifier.captureBaseline(
    mediaOperation,
    target,
  );
  assert.equal(mediaBaseline.ok, true);
  if (!mediaBaseline.ok) return;
  assert.deepEqual(
    await mediaVerifier.verify(
      mediaOperation,
      target,
      mediaBaseline.baseline,
    ),
    { ok: true, outcome: "inconclusive" },
  );

  const existing = remoteTyping({
    number: 2,
    question: "Existing",
    answers: ["old"],
    correctAnswers: ["old"],
  });
  const changed = { ...existing, timeLimit: 20 };
  const concurrentVerifier = blooketSetReadWriteVerifier(
    sets,
    questionReads([
      [existing],
      [changed, remoteTyping()],
    ]),
  );
  const concurrentBaseline = await concurrentVerifier.captureBaseline(
    typingOperation(),
    target,
  );
  assert.equal(concurrentBaseline.ok, true);
  if (!concurrentBaseline.ok) return;
  assert.deepEqual(
    await concurrentVerifier.verify(
      typingOperation(),
      target,
      concurrentBaseline.baseline,
    ),
    { ok: true, outcome: "inconclusive" },
  );
});

test(
  "unknown set-list completeness cannot prove reconciliation",
  async () => {
    let lists = 0;
    let details = 0;
    const reads: BlooketSetReadPort = {
      list: async () => {
        lists++;
        return {
          ok: true,
          value: [summary("new-1", "Astronomy")],
          completeness: "unknown",
        };
      },
      get: async () => {
        details++;
        return {
          ok: true,
          value: detail("new-1", "Astronomy"),
        };
      },
    };
    const verifier = blooketSetReadWriteVerifier(reads);
    assert.deepEqual(
      await verifier.captureBaseline(operation, { remoteSetId: null }),
      { ok: true, baseline: null },
    );
    assert.deepEqual(
      await verifier.verify(
        operation,
        { remoteSetId: null },
        {
          schemaVersion: 1,
          kind: "set-list",
          itemCount: 0,
          sha256: "0".repeat(64),
        },
      ),
      { ok: true, outcome: "inconclusive" },
    );
    assert.equal(lists, 2);
    assert.equal(details, 0);
  },
);
