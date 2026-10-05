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
//   - Tests for bounded integer editor crop and placement geometry.
// - Must-Not:
//   - Decode pixels or invoke native image processing.
// - Allows:
//   - Inputs: Fixed source/canvas dimensions and editor transforms.
//   - Outputs: Exact crop/placement and bound-invariant verdicts.
//   - Side effects: None.
// - Split-When:
//   - Animated sampling gains separate geometry.
// - Merge-When:
//   - Raster sampling no longer has standalone domain semantics.
// - Summary:
//   - Verifies zoom crops source before resize and pan clips to canvas.
// - Description:
//   - Exercises large zoom without producing oversized output rectangles.
// - Usage:
//   - Run before native editor renderer tests.
// - Defaults:
//   - Fixtures use integral-friendly geometry where exact values matter.
//
import assert from "node:assert/strict";
import test from "node:test";

import { resolveForegroundRasterSample } from
  "../../../../src/media/editor-layout/domain/raster-layout.ts";

test("neutral contain maps the full source into its canvas area", () => {
  assert.deepEqual(
    resolveForegroundRasterSample(
      { width: 4, height: 2 },
      { width: 8, height: 8 },
      { panX: 0, panY: 0, zoom: 1 },
    ),
    {
      ok: true,
      value: {
        source: { left: 0, top: 0, width: 4, height: 2 },
        canvas: { left: 0, top: 2, width: 8, height: 4 },
      },
    },
  );
});

test("zoom crops source instead of creating oversized output", () => {
  assert.deepEqual(
    resolveForegroundRasterSample(
      { width: 8, height: 8 },
      { width: 8, height: 8 },
      { panX: 0, panY: 0, zoom: 2 },
    ),
    {
      ok: true,
      value: {
        source: { left: 2, top: 2, width: 4, height: 4 },
        canvas: { left: 0, top: 0, width: 8, height: 8 },
      },
    },
  );
});

test("pan clips both canvas placement and source crop", () => {
  assert.deepEqual(
    resolveForegroundRasterSample(
      { width: 8, height: 8 },
      { width: 8, height: 8 },
      { panX: 0.5, panY: -0.25, zoom: 1 },
    ),
    {
      ok: true,
      value: {
        source: { left: 0, top: 2, width: 4, height: 6 },
        canvas: { left: 4, top: 0, width: 4, height: 6 },
      },
    },
  );
});

test("fully off-canvas foregrounds require no source sampling", () => {
  assert.deepEqual(
    resolveForegroundRasterSample(
      { width: 8, height: 8 },
      { width: 8, height: 8 },
      { panX: 2, panY: 0, zoom: 1 },
    ),
    { ok: true, value: null },
  );
});

test("raster samples remain within source and canvas bounds", () => {
  const pans = [-4, -1, -0.2, 0, 0.2, 1, 4];
  const zooms = [0.05, 0.5, 1, 3, 1000];

  for (const panX of pans) {
    for (const panY of pans) {
      for (const zoom of zooms) {
        const result = resolveForegroundRasterSample(
          { width: 4032, height: 3024 },
          { width: 320, height: 180 },
          { panX, panY, zoom },
        );
        assert.equal(result.ok, true);
        if (!result.ok || result.value === null) {
          continue;
        }

        const source = result.value.source;
        const canvas = result.value.canvas;
        assert.equal(source.left >= 0, true);
        assert.equal(source.top >= 0, true);
        assert.equal(source.width > 0, true);
        assert.equal(source.height > 0, true);
        assert.equal(source.left + source.width <= 4032, true);
        assert.equal(source.top + source.height <= 3024, true);
        assert.equal(canvas.left >= 0, true);
        assert.equal(canvas.top >= 0, true);
        assert.equal(canvas.width > 0 && canvas.width <= 320, true);
        assert.equal(canvas.height > 0 && canvas.height <= 180, true);
        assert.equal(canvas.left + canvas.width <= 320, true);
        assert.equal(canvas.top + canvas.height <= 180, true);
      }
    }
  }
});

test("invalid geometry fails before raster calculations", () => {
  assert.deepEqual(
    resolveForegroundRasterSample(
      { width: 0, height: 8 },
      { width: 8, height: 8 },
      { panX: 0, panY: 0, zoom: 1 },
    ),
    { ok: false, code: "invalid-editor-layout" },
  );
});
