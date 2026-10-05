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
//   - Behavioral tests for version-one Blooket capability snapshots.
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
import test from "node:test";

import { decodeBlooketCapabilitySnapshot } from
  "../../../../src/ir/capability-snapshots/contract/blooket-capabilities.ts";

const verified = {
  schemaVersion: 1,
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
  },
} as const;

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
