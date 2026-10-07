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
//   - Verification of bounded media optimization candidate ordering.
// - Must-Not:
//   - Encode files or infer success from candidate parameters.
// - Allows:
//   - Inputs: Fixed optimization requests.
//   - Outputs: Deterministic candidate assertions.
//   - Side effects: None.
// - Split-When:
//   - Another format needs distinct optimization policy verification.
// - Merge-When:
//   - Optimization ordering no longer has a standalone domain.
// - Summary:
//   - Proves detail precedes FPS and compression fallback.
// - Description:
//   - Keeps candidate count bounded and final-canvas policy implicit.
// - Usage:
//   - Run with the repository Node test suite.
// - Defaults:
//   - Invalid requested rates fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { renditionOptimizationCandidates } from
  "../../../../src/media/rendition-optimization/domain/candidates.ts";

test("GIF candidates reduce detail before FPS and compression", () => {
  const candidates = renditionOptimizationCandidates({
    animated: true,
    gifFps: 25,
    compression: "lossless",
  });
  assert.deepEqual(
    candidates.map((candidate) => candidate.stage),
    [
      "requested",
      "detail",
      "detail",
      "detail",
      "detail",
      "fps",
      "fps",
      "fps",
      "fps",
      "fps",
      "compression",
    ],
  );
  assert.deepEqual(
    candidates.slice(0, 5).map((candidate) => candidate.detailScale),
    [1, 0.85, 0.7, 0.55, 0.4],
  );
  assert.deepEqual(
    candidates
      .filter((candidate) => candidate.stage === "fps")
      .map((candidate) => candidate.gifFps),
    [20, 10, 5, 2, 1],
  );
  assert.deepEqual(candidates.at(-1), {
    stage: "compression",
    detailScale: 0.4,
    gifFps: 1,
    compression: "compact",
  });
  assert.ok(candidates.length <= 12);
});

test("static candidates never invent an FPS reduction", () => {
  const candidates = renditionOptimizationCandidates({
    animated: false,
    gifFps: 50,
    compression: "lossless",
  });
  assert.deepEqual(
    candidates.map((candidate) => candidate.stage),
    ["requested", "detail", "detail", "detail", "detail", "compression"],
  );
  assert.ok(candidates.every((candidate) => candidate.gifFps === null));
});

test(
  "requested compact mode does not add a duplicate compression stage",
  () => {
  const candidates = renditionOptimizationCandidates({
    animated: true,
    gifFps: 10,
    compression: "compact",
  });
  assert.equal(
    candidates.filter((candidate) => candidate.stage === "compression").length,
    0,
  );
  assert.deepEqual(
    candidates
      .filter((candidate) => candidate.stage === "fps")
      .map((candidate) => candidate.gifFps),
    [5, 2, 1],
  );
  assert.ok(
    candidates.every((candidate) => candidate.compression === "compact"),
  );
  },
);

test("invalid requested FPS fails closed", () => {
  assert.deepEqual(
    renditionOptimizationCandidates({
      animated: true,
      gifFps: 30,
      compression: "compact",
    }),
    [],
  );
});
