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
//   - Tests for evidence-led image import policy resolution.
// - Must-Not:
//   - Probe Blooket or use production capability observations.
// - Allows:
//   - Inputs: Synthetic verified, legacy, unknown, and invalid snapshots.
//   - Outputs: Exact preparation policies and fail-closed refusal codes.
//   - Side effects: None.
// - Split-When:
//   - Multiple upload targets gain independent policy contracts.
// - Merge-When:
//   - Media import no longer resolves limits from capability evidence.
// - Summary:
//   - Verifies local source safety stays separate from remote upload limits.
// - Description:
//   - Covers v1 migration, null evidence, and complete v2 policy derivation.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Synthetic numbers are test fixtures, not Blooket capability claims.
//
import assert from "node:assert/strict";
import test from "node:test";

import { resolveImageImportPolicy } from
  "../../../../src/api/media-import-policy/application/resolve-policy.ts";

const complete = {
  schemaVersion: 2,
  verifiedOn: "2026-10-05",
  evidence: [{
    kind: "browser-observation",
    reference: "Synthetic authenticated editor fixture",
  }],
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
    maxBytes: 2_000_000,
    canvasWidth: 800,
    canvasHeight: 600,
    maxPixels: 1_000_000,
  },
} as const;

test("verified upload facts bind only rendition-facing limits", () => {
  const result = resolveImageImportPolicy(complete, {
    maxSourceBytes: 12_000_000,
    maxInputPixels: 24_000_000,
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      maxSourceBytes: 12_000_000,
      canvas: { width: 800, height: 600 },
      renditionLimits: {
        maxInputPixels: 24_000_000,
        maxOutputPixels: 1_000_000,
        maxOutputBytes: 2_000_000,
      },
    },
  });
});

test("unknown v2 upload facts fail closed", () => {
  const result = resolveImageImportPolicy({
    ...complete,
    upload: {
      maxBytes: null,
      canvasWidth: null,
      canvasHeight: null,
      maxPixels: null,
    },
  }, {
    maxSourceBytes: 1,
    maxInputPixels: 1,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "unverified-image-upload-limits",
  });
});

test("legacy snapshots migrate new upload facts to unknown", () => {
  const result = resolveImageImportPolicy({
    ...complete,
    schemaVersion: 1,
    upload: {
      maxBytes: 2_000_000,
    },
  }, {
    maxSourceBytes: 1,
    maxInputPixels: 1,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "unverified-image-upload-limits",
  });
});

test("invalid capability data is distinct from unknown evidence", () => {
  const result = resolveImageImportPolicy({
    ...complete,
    upload: {
      ...complete.upload,
      maxBytes: "2000000",
    },
  }, {
    maxSourceBytes: 1,
    maxInputPixels: 1,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "invalid-capability-snapshot",
  });
});

test("local decoder safety limits must be explicit positive integers", () => {
  assert.deepEqual(
    resolveImageImportPolicy(complete, {
      maxSourceBytes: 0,
      maxInputPixels: 1,
    }),
    { ok: false, code: "invalid-local-image-limits" },
  );
  assert.deepEqual(
    resolveImageImportPolicy(complete, {
      maxSourceBytes: 1,
      maxInputPixels: Number.POSITIVE_INFINITY,
    }),
    { ok: false, code: "invalid-local-image-limits" },
  );
});
