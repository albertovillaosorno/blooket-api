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
//   - Unit tests for differential Create Set verification over set reads.
// - Must-Not:
//   - Contact Blooket, mutate remotely, or claim question verification.
// - Allows:
//   - Inputs: Deterministic list/detail probe sequences.
//   - Outputs: Baselines and exact confirmed/not-confirmed/inconclusive
//     verdicts.
//   - Side effects: In-memory probe call recording only.
// - Split-When:
//   - Question verification gains a concrete read model.
// - Merge-When:
//   - Set verification no longer uses differential collection evidence.
// - Summary:
//   - Proves one exact new set is required before Create Set is confirmed.
// - Description:
//   - Duplicate titles and concurrent changes remain inconclusive.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Questions capture null baselines and cannot be recovery-confirmed.
//
import assert from "node:assert/strict";
import test from "node:test";

import { blooketSetReadWriteVerifier } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/set-read-verifier.ts";
import type { BlooketSetReadPort } from
  "../../../../src/api/blooket-set-reads/contract/set-reads.ts";
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
    list: async () => ({ ok: true, value: sets }),
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
    list: async () => ({ ok: true, value: current }),
    get: async (id) => ({
      ok: true,
      value: detail(id, "Astronomy", "Different"),
    }),
  };
  const verifier = blooketSetReadWriteVerifier(reads);

  const captureReads: BlooketSetReadPort = {
    list: async () => ({ ok: true, value: before }),
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
