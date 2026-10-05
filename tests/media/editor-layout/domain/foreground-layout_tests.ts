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
//   - Tests for deterministic editor foreground pan/zoom geometry.
// - Must-Not:
//   - Decode images or test Sharp rendering.
// - Allows:
//   - Inputs: Fixed source/canvas sizes and transform values.
//   - Outputs: Exact destination/visible rectangle verdicts.
//   - Side effects: None.
// - Split-When:
//   - Additional transform families gain independent geometry.
// - Merge-When:
//   - Editor geometry is no longer a separate domain contract.
// - Summary:
//   - Verifies contain scale, zoom, pan units, clipping, and invalid inputs.
// - Description:
//   - Keeps interaction semantics testable without native image processing.
// - Usage:
//   - Run before integrating editor geometry into a renderer.
// - Defaults:
//   - Test coordinates use small exact values to avoid tolerance ambiguity.
//
import assert from "node:assert/strict";
import test from "node:test";

import { resolveForegroundLayout } from
  "../../../../src/media/editor-layout/domain/foreground-layout.ts";

test("neutral zoom contains a wide source and centers it", () => {
  assert.deepEqual(
    resolveForegroundLayout(
      { width: 4, height: 2 },
      { width: 8, height: 8 },
      { panX: 0, panY: 0, zoom: 1 },
    ),
    {
      ok: true,
      value: {
        destination: {
          left: 0,
          top: 2,
          width: 8,
          height: 4,
        },
        visible: {
          left: 0,
          top: 2,
          width: 8,
          height: 4,
        },
      },
    },
  );
});

test("zoom scales around the centered foreground", () => {
  const result = resolveForegroundLayout(
    { width: 4, height: 2 },
    { width: 8, height: 8 },
    { panX: 0, panY: 0, zoom: 2 },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.destination, {
      left: -4,
      top: 0,
      width: 16,
      height: 8,
    });
    assert.deepEqual(result.value.visible, {
      left: 0,
      top: 0,
      width: 8,
      height: 8,
    });
  }
});

test("pan values are fractions of full canvas dimensions", () => {
  const result = resolveForegroundLayout(
    { width: 4, height: 4 },
    { width: 8, height: 8 },
    { panX: 0.25, panY: -0.5, zoom: 1 },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.destination, {
      left: 2,
      top: -4,
      width: 8,
      height: 8,
    });
    assert.deepEqual(result.value.visible, {
      left: 2,
      top: 0,
      width: 6,
      height: 4,
    });
  }
});

test("fully panned-off foregrounds have zero visible area", () => {
  const result = resolveForegroundLayout(
    { width: 1, height: 1 },
    { width: 8, height: 8 },
    { panX: 2, panY: 0, zoom: 1 },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.visible, {
      left: 8,
      top: 0,
      width: 0,
      height: 8,
    });
  }

  const opposite = resolveForegroundLayout(
    { width: 1, height: 1 },
    { width: 8, height: 8 },
    { panX: -2, panY: 0, zoom: 1 },
  );
  assert.equal(opposite.ok, true);
  if (opposite.ok) {
    assert.deepEqual(opposite.value.visible, {
      left: 0,
      top: 0,
      width: 0,
      height: 8,
    });
  }
});

test("visible rectangles stay inside the canvas at extremes", () => {
  const sources = [
    { width: 1, height: 1 },
    { width: 16, height: 9 },
    { width: 9, height: 16 },
  ];
  const pans = [-3, -1, -0.25, 0, 0.25, 1, 3];
  const zooms = [0.1, 1, 2, 10];

  for (const source of sources) {
    for (const panX of pans) {
      for (const panY of pans) {
        for (const zoom of zooms) {
          const result = resolveForegroundLayout(
            source,
            { width: 320, height: 180 },
            { panX, panY, zoom },
          );
          assert.equal(result.ok, true);
          if (!result.ok) {
            continue;
          }

          const visible = result.value.visible;
          assert.equal(visible.left >= 0 && visible.left <= 320, true);
          assert.equal(visible.top >= 0 && visible.top <= 180, true);
          assert.equal(visible.width >= 0, true);
          assert.equal(visible.height >= 0, true);
          assert.equal(visible.left + visible.width <= 320, true);
          assert.equal(visible.top + visible.height <= 180, true);
        }
      }
    }
  }
});

test("invalid dimensions and non-finite transforms fail closed", () => {
  assert.deepEqual(
    resolveForegroundLayout(
      { width: 0, height: 1 },
      { width: 8, height: 8 },
      { panX: 0, panY: 0, zoom: 1 },
    ),
    { ok: false, code: "invalid-editor-layout" },
  );
  assert.deepEqual(
    resolveForegroundLayout(
      { width: 1, height: 1 },
      { width: 8, height: 8 },
      { panX: Number.POSITIVE_INFINITY, panY: 0, zoom: 1 },
    ),
    { ok: false, code: "invalid-editor-layout" },
  );
  assert.deepEqual(
    resolveForegroundLayout(
      { width: 1, height: 1 },
      { width: 8, height: 8 },
      { panX: 0, panY: 0, zoom: 0 },
    ),
    { ok: false, code: "invalid-editor-layout" },
  );
});
