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
//   - Behavioral tests for current and legacy Blooket capability snapshots.
// - Must-Not:
//   - Probe Blooket or decide current account capabilities.
// - Allows:
//   - Inputs: Fixed verified, unknown, and invalid capability fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Capability schema versions need independent fixture suites.
// - Merge-When:
//   - Blooket capability snapshots are removed.
// - Summary:
//   - Verifies explicit evidence, unknown values, and cross-field bounds.
// - Description:
//   - Mirrors the Blooket capability snapshot runtime contract.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unknown upload limits remain null.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  decodeBlooketCapabilitySnapshot,
  serializeBlooketCapabilitySnapshot,
} from
  "../../../../src/ir/capability-snapshots/contract/blooket-capabilities.ts";

const verified = {
  schemaVersion: 2,
  verifiedOn: "2026-10-05",
  evidence: [
    {
      kind: "official-doc",
      reference: "Blooket Question Types Explained",
    },
  ],
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
    answerImages: "account-dependent",
    audio: "account-dependent",
  },
  setMetadata: {
    titleRequired: true,
    descriptionRequired: true,
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

test("official fixture preserves unknown upload limits", async () => {
  const fixtureUrl = new URL(
    "./blooket-official-2026-10-05.json",
    import.meta.url,
  );
  const source = await readFile(fixtureUrl, "utf8");
  const result = decodeBlooketCapabilitySnapshot(JSON.parse(source));

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.verifiedOn, "2026-10-05");
    assert.equal(result.value.features.questionImages, "supported");
    assert.equal(result.value.features.answerImages, "account-dependent");
    assert.deepEqual(result.value.upload, {
      maxBytes: null,
      canvasWidth: null,
      canvasHeight: null,
      maxPixels: null,
    });
  }
});

test("version-one upload capabilities migrate unknown image limits", () => {
  const legacy = {
    ...verified,
    schemaVersion: 1,
    upload: {
      maxBytes: null,
    },
  } as const;
  const result = decodeBlooketCapabilitySnapshot(legacy);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.schemaVersion, 2);
    assert.deepEqual(result.value.upload, {
      maxBytes: null,
      canvasWidth: null,
      canvasHeight: null,
      maxPixels: null,
    });
    const serialized = serializeBlooketCapabilitySnapshot(result.value);
    assert.equal(serialized.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(serialized), result.value);
    assert.deepEqual(
      decodeBlooketCapabilitySnapshot(JSON.parse(serialized)),
      { ok: true, value: result.value },
    );
  }
});

test("version-one snapshots reject version-two upload fields", () => {
  const result = decodeBlooketCapabilitySnapshot({
    ...verified,
    schemaVersion: 1,
    upload: {
      maxBytes: null,
      canvasWidth: null,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some((issue) => issue.code === "unknown-field"),
      true,
    );
  }
});

test("version-two upload capabilities admit verified image limits", () => {
  const result = decodeBlooketCapabilitySnapshot({
    ...verified,
    upload: {
      maxBytes: 2_000_000,
      canvasWidth: 800,
      canvasHeight: 600,
      maxPixels: 1_000_000,
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.upload, {
      maxBytes: 2_000_000,
      canvasWidth: 800,
      canvasHeight: 600,
      maxPixels: 1_000_000,
    });
  }
});

test("version-two canvas dimensions must become known together", () => {
  const result = decodeBlooketCapabilitySnapshot({
    ...verified,
    upload: {
      ...verified.upload,
      canvasWidth: 800,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some((issue) => issue.code === "partial-image-canvas"),
      true,
    );
  }
});

test("verified canvas area cannot exceed the pixel limit", () => {
  const result = decodeBlooketCapabilitySnapshot({
    ...verified,
    upload: {
      maxBytes: 2_000_000,
      canvasWidth: 800,
      canvasHeight: 600,
      maxPixels: 100_000,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "canvas-exceeds-pixel-limit",
      ),
      true,
    );
  }
});

test("capability snapshots accept verified facts and explicit unknowns", () => {
  const result = decodeBlooketCapabilitySnapshot(verified);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.upload.maxBytes, null);
    assert.equal(result.value.features.answerImages, "account-dependent");
  }
});

test("capability snapshots reject unknown fields", () => {
  const result = decodeBlooketCapabilitySnapshot({
    ...verified,
    guessedUploadLimit: 2_500_000,
  });

  assert.equal(result.ok, false);
});

test("capability snapshots require real ISO calendar dates", () => {
  const result = decodeBlooketCapabilitySnapshot({
    ...verified,
    verifiedOn: "2026-02-31",
  });

  assert.equal(result.ok, false);
});

test("multiple choice answer bounds cannot be contradictory", () => {
  const result = decodeBlooketCapabilitySnapshot({
    ...verified,
    questionTypes: {
      ...verified.questionTypes,
      multipleChoice: {
        ...verified.questionTypes.multipleChoice,
        minAnswers: 5,
        maxAnswers: 4,
      },
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some((issue) => issue.code === "invalid-answer-range"),
      true,
    );
  }
});

test("capability arrays reject duplicate enum values", () => {
  const result = decodeBlooketCapabilitySnapshot({
    ...verified,
    setMetadata: {
      ...verified.setMetadata,
      visibility: ["public", "public"],
    },
  });

  assert.equal(result.ok, false);
});

test("capability evidence may use browser observations", () => {
  const result = decodeBlooketCapabilitySnapshot({
    ...verified,
    evidence: [
      {
        kind: "browser-observation",
        reference: "Authenticated set editor fixture",
      },
    ],
  });

  assert.equal(result.ok, true);
});
