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
//   - Behavioral tests for validated deterministic Blooket write planning.
// - Must-Not:
//   - Call Blooket or imply remote selectors, routes, or IDs.
// - Allows:
//   - Inputs: Fixed local project/media fixtures.
//   - Outputs: Deterministic plan and readiness verdicts.
//   - Side effects: None.
// - Split-When:
//   - Set and question operation fixtures require independent suites.
// - Merge-When:
//   - Desired-state write planning is removed.
// - Summary:
//   - Proves validation, determinism, operation identity, and media lowering.
// - Description:
//   - Mirrors src/projects/blooket-write-plans/domain/write-plan.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Media descriptions never enter remote-facing plan payloads.
//
import assert from "node:assert/strict";
import test from "node:test";

const capabilities = {
  schemaVersion: 3,
  verifiedOn: "2026-10-05",
  evidence: [{ kind: "browser-observation", reference: "fixture" }],
  questionTypes: {
    multipleChoice: {
      availability: "supported",
      minAnswers: 2,
      maxAnswers: 4,
      requiresQuestionText: true,
      allowsMultipleCorrect: true,
    },
    typingAnswer: {
      availability: "supported",
      matchModes: ["exact", "contains"],
    },
  },
  features: {
    questionImages: "supported",
    answerImages: "supported",
    audio: "unknown",
  },
  setMetadata: {
    titleRequired: true,
    descriptionRequired: false,
    titleMaxLength: 75,
    descriptionMaxLength: 300,
    coverImageOptional: true,
    visibility: ["public", "private"],
  },
  upload: {
    maxBytes: null,
    canvasWidth: null,
    canvasHeight: null,
    maxPixels: null,
  },
} as const;

import { decodeOperationId } from
  "../../../../src/ir/operation-identifiers/domain/operation-id.ts";
import { buildBlooketWritePlan, buildPreparedBlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const media = [
  {
    schemaVersion: 2,
    id: "sun",
    path: "media/sun.png",
    name: "Sun",
    description: "A bright yellow sun.",
    english: true,
  },
  {
    schemaVersion: 2,
    id: "moon",
    path: "media/moon.png",
    name: "Moon",
    description: "A silver moon.",
    english: true,
  },
];

function project(description = "Astronomy review.") {
  return {
    schemaVersion: 1,
    title: "Astronomy",
    description,
    quizLanguage: "English",
    visibility: "private",
    mediaIndex: "media.jsonl",
    coverImage: {
      description: "A sun.",
      mediaId: "sun",
    },
    questions: [
      {
        id: "q1",
        type: "multiple-choice",
        prompt: "Which is a star?",
        timeLimitSeconds: 20,
        randomOrder: true,
        image: null,
        answers: [
          {
            text: null,
            correct: true,
            image: { description: "Sun.", mediaId: "sun" },
          },
          {
            text: null,
            correct: false,
            image: { description: "Moon.", mediaId: "moon" },
          },
        ],
      },
      {
        id: "q2",
        type: "typing-answer",
        prompt: "Type moon.",
        timeLimitSeconds: 15,
        image: { description: "Moon.", mediaId: "moon" },
        matchMode: "exact",
        answer: "moon",
      },
    ],
  };
}

const mediaJsonl = media.map((record) => JSON.stringify(record)).join("\n")
  + "\n";

test("validated projects lower to ordered remote-neutral operations", () => {
  const result = buildBlooketWritePlan(
    JSON.stringify(project()),
    mediaJsonl,
    capabilities,
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.operations.length, 3);
  assert.deepEqual(result.value.operations[0], {
    operationId: result.value.planId + ":set",
    kind: "set",
    title: "Astronomy",
    description: "Astronomy review.",
    visibility: "private",
    coverMediaId: "sun",
  });
  assert.deepEqual(result.value.operations[1], {
    operationId: result.value.planId + ":q:0",
    kind: "question",
    localQuestionId: "q1",
    questionNumber: 1,
    question: {
      type: "multiple-choice",
      prompt: "Which is a star?",
      timeLimitSeconds: 20,
      randomOrder: true,
      imageMediaId: null,
      answers: [
        { text: null, correct: true, imageMediaId: "sun" },
        { text: null, correct: false, imageMediaId: "moon" },
      ],
    },
  });
  assert.deepEqual(result.value.operations[2], {
    operationId: result.value.planId + ":q:1",
    kind: "question",
    localQuestionId: "q2",
    questionNumber: 2,
    question: {
      type: "typing-answer",
      prompt: "Type moon.",
      timeLimitSeconds: 15,
      imageMediaId: "moon",
      matchMode: "exact",
      answer: "moon",
    },
  });
});

test("plan and operation identities are deterministic and valid", () => {
  const first = buildBlooketWritePlan(
    JSON.stringify(project()),
    mediaJsonl,
    capabilities,
  );
  const second = buildBlooketWritePlan(
    JSON.stringify(project()),
    mediaJsonl,
    capabilities,
  );

  assert.deepEqual(second, first);
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }

  assert.equal(decodeOperationId(first.value.planId).ok, true);
  for (const operation of first.value.operations) {
    assert.equal(decodeOperationId(operation.operationId).ok, true);
  }
});

test("non-execution media metadata does not change plan identity", () => {
  const changedMedia = media.map((record) => ({
    ...record,
    path: "media/changed-" + record.id + ".png",
    name: "Changed " + record.name,
    description: "Changed local description.",
  }));
  const newline = String.fromCharCode(10);
  const changedMediaJsonl = changedMedia
    .map((record) => JSON.stringify(record))
    .join(newline) + newline;
  const first = buildBlooketWritePlan(
    JSON.stringify(project()),
    mediaJsonl,
    capabilities,
  );
  const changed = buildBlooketWritePlan(
    JSON.stringify(project()),
    changedMediaJsonl,
    capabilities,
  );

  assert.equal(first.ok, true);
  assert.equal(changed.ok, true);
  if (first.ok && changed.ok) {
    assert.equal(first.value.planId, changed.value.planId);
    assert.deepEqual(first.value.operations, changed.value.operations);
  }
});

test("content changes produce a different plan identity", () => {
  const first = buildBlooketWritePlan(
    JSON.stringify(project()),
    mediaJsonl,
    capabilities,
  );
  const changed = buildBlooketWritePlan(
    JSON.stringify(project("Changed review.")),
    mediaJsonl,
    capabilities,
  );

  assert.equal(first.ok, true);
  assert.equal(changed.ok, true);
  if (first.ok && changed.ok) {
    assert.notEqual(first.value.planId, changed.value.planId);
    assert.notDeepEqual(
      first.value.operations.map((item) => item.operationId),
      changed.value.operations.map((item) => item.operationId),
    );
  }
});

test("account-dependent answer images block write planning", () => {
  const result = buildBlooketWritePlan(
    JSON.stringify(project()),
    mediaJsonl,
    {
      ...capabilities,
      features: {
        ...capabilities.features,
        answerImages: "account-dependent",
      },
    },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "incompatible-capabilities");
  }
});

test("invalid capability snapshots block write planning", () => {
  const result = buildBlooketWritePlan(
    JSON.stringify(project()),
    mediaJsonl,
    { schemaVersion: 999 },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "invalid-capabilities");
  }
});

test("invalid project input cannot produce a write plan", () => {
  const result = buildBlooketWritePlan(
    "{",
    mediaJsonl,
    capabilities,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "invalid-project");
  }
});

test("unresolved images block plan creation", () => {
  const source = project();
  const unresolved = {
    ...source,
    coverImage: {
      ...source.coverImage,
      mediaId: null,
    },
  };
  const result = buildBlooketWritePlan(
    JSON.stringify(unresolved),
    mediaJsonl,
    capabilities,
  );

  assert.deepEqual(result, {
    ok: false,
    kind: "unresolved-media",
    count: 1,
  });
});

test("media descriptions and vault paths do not enter plan payloads", () => {
  const result = buildBlooketWritePlan(
    JSON.stringify(project()),
    mediaJsonl,
    capabilities,
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const serialized = JSON.stringify(result.value);
  assert.equal(serialized.includes("bright yellow"), false);
  assert.equal(serialized.includes("silver moon"), false);
  assert.equal(serialized.includes("media/sun.png"), false);
  assert.equal(serialized.includes("media/moon.png"), false);
});

const identities = { schemaVersion: 1, items: [
  { mediaId: "sun", revision: 1, format: "png", byteLength: 20,
    sha256: "a".repeat(64) },
  { mediaId: "moon", revision: 2, format: "jpeg", byteLength: 30,
    sha256: "b".repeat(64) },
] };

test("prepared planning binds every byte identity without metadata or paths",
  () => {
    const original = buildPreparedBlooketWritePlan(project(), identities,
      capabilities);
    assert.ok(original.ok);
    assert.deepEqual(buildPreparedBlooketWritePlan(project(), {
      ...identities, items: [...identities.items].reverse(),
    }, capabilities), original);
    for (const change of [{ revision: 3 }, { format: "gif" },
      { byteLength: 21 }, { sha256: "c".repeat(64) }]) {
      const changed = buildPreparedBlooketWritePlan(project(), {
        ...identities, items: [{ ...identities.items[0], ...change },
          identities.items[1]],
      }, capabilities);
      assert.ok(changed.ok);
      assert.notEqual(changed.value.planId, original.value.planId);
      assert.ok(changed.value.operations.every(operation =>
        operation.operationId.startsWith(changed.value.planId)));
    }
    assert.ok(!JSON.stringify(original).includes("media/sun.png"));
  });

test("prepared planning rejects missing extra and unresolved media", () => {
  for (const items of [[], identities.items.slice(0, 1),
    [...identities.items, { ...identities.items[0], mediaId: "unused" }]])
    assert.equal(buildPreparedBlooketWritePlan(project(), {
      schemaVersion: 1, items,
    }, capabilities).ok, false);
  const unresolved = project();
  const result = buildPreparedBlooketWritePlan({ ...unresolved,
    coverImage: { ...unresolved.coverImage, mediaId: null },
  }, identities, capabilities);
  assert.ok(!result.ok && result.kind === "unresolved-media");
  assert.equal(buildPreparedBlooketWritePlan(project(), identities, {
    ...capabilities, features: { ...capabilities.features,
      answerImages: "unknown" },
  }).ok, false);
});

test("empty prepared context preserves all legacy text plan identities", () => {
  const text = { ...project(), coverImage: null, questions: [{
    id: "q", type: "typing-answer", prompt: "Type sun.",
    timeLimitSeconds: 15, image: null, matchMode: "exact", answer: "sun",
  }] };
  assert.deepEqual(buildPreparedBlooketWritePlan(text,
    { schemaVersion: 1, items: [] }, capabilities),
  buildBlooketWritePlan(JSON.stringify(text), "", capabilities));
});
