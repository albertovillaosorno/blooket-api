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
//   - Verification of derived library metadata state.
// - Must-Not:
//   - Persist state or perform image work.
// - Allows:
//   - Inputs: Validated library metadata.
//   - Outputs: Deterministic normalization status.
//   - Side effects: None.
// - Split-When:
//   - Another metadata state needs independent lifecycle.
// - Merge-When:
//   - Normalization status is no longer derived from metadata.
// - Summary:
//   - Keeps pending/completed/stale status free of redundant persistence.
// - Description:
//   - Completion requires AI output, detected language and matching revision.
// - Usage:
//   - Run with the repository Node test suite.
// - Defaults:
//   - Missing analysis remains pending.
//
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeLibraryMetadata,
  normalizationStatus,
  type LibraryMetadata,
} from "../../../../src/media/library-metadata/domain/metadata.ts";

const base: LibraryMetadata = {
  schemaVersion: 1,
  id: "asset-1",
  asset: "photos/asset-1.webp",
  revision: 1,
  original: {
    revision: 1,
    name: "Gato",
    description: "Un gato en una ventana.",
    language: "",
  },
  topics: [],
  generatedEnglish: null,
  edit: {
    panX: 0,
    panY: 0,
    zoom: 1,
    contrast: 1,
    saturation: 1,
    background: { mode: "blur", color: "#ffffff" },
    width: 1280,
    height: 720,
    gifFps: 10,
    compression: "compact",
  },
  prepared: null,
};

test(
  "normalization status is derived from durable current-revision evidence",
  () => {
  assert.equal(normalizationStatus(base), "pending");
  const generated = {
    ...base,
    original: { ...base.original, language: "es" },
    topics: ["cat"],
    generatedEnglish: {
      name: "Cat",
      description: "A cat sitting beside a window.",
      generatedBy: "ai" as const,
      sourceRevision: 1,
      verified: false as const,
    },
  };
  assert.equal(normalizationStatus(generated), "completed");
  assert.equal(
    normalizationStatus({
      ...generated,
      original: { ...generated.original, revision: 2, language: "" },
    }),
    "stale",
  );
  assert.equal(
    normalizationStatus({
      ...generated,
      original: { ...generated.original, language: "" },
    }),
    "pending",
  );
  },
);

test("prepared effective metadata is key-order independent", () => {
  const prepared = {
    ...base,
    prepared: {
      file: "renditions/asset-1/1.png",
      bytes: 100,
      recipeRevision: 1,
      effective: {
        compression: "compact",
        gifFps: null,
        detailScale: 1,
        stage: "requested",
      },
    },
  };
  assert.deepEqual(
    decodeLibraryMetadata(prepared).prepared?.effective,
    prepared.prepared.effective,
  );
  assert.throws(
    () =>
      decodeLibraryMetadata({
        ...prepared,
        prepared: {
          ...prepared.prepared,
          effective: {
            compression: "compact",
            gifFps: null,
            detailScale: 0.4,
            stage: "fps",
          },
        },
      }),
    /invalid-prepared-media/u,
  );
});
