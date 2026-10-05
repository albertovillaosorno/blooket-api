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
//   - Bounded integer crop/placement geometry for static editor rendering.
// - Must-Not:
//   - Decode pixels, allocate image buffers, or choose interpolation kernels.
// - Allows:
//   - Inputs: Source/canvas dimensions plus validated pan and zoom values.
//   - Outputs: Source crop and canvas placement rectangles or no visibility.
//   - Side effects: None.
// - Split-When:
//   - Animated frames require independent per-frame sampling semantics.
// - Merge-When:
//   - Editor geometry and raster rendering can share one reviewed operation.
// - Summary:
//   - Maps floating editor geometry to bounded source and canvas rectangles.
// - Description:
//   - Crops source before resize so large zoom cannot allocate huge images.
// - Usage:
//   - Resolve before native static editor rendering.
// - Defaults:
//   - Pixel coverage is conservative at partially covered destination edges.
//
import {
  resolveForegroundLayout,
  type EditorImageSize,
  type EditorPanZoom,
} from "./foreground-layout.ts";

export interface PixelRectangle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ForegroundRasterSample {
  readonly source: PixelRectangle;
  readonly canvas: PixelRectangle;
}

export type ForegroundRasterResult =
  | {
      readonly ok: true;
      readonly value: ForegroundRasterSample | null;
    }
  | { readonly ok: false; readonly code: "invalid-editor-layout" };

export function resolveForegroundRasterSample(
  source: EditorImageSize,
  canvas: EditorImageSize,
  transform: EditorPanZoom,
): ForegroundRasterResult {
  const layout = resolveForegroundLayout(source, canvas, transform);
  if (!layout.ok) {
    return layout;
  }

  const destination = layout.value.destination;
  const visible = layout.value.visible;
  if (visible.width <= 0 || visible.height <= 0) {
    return { ok: true, value: null };
  }

  const canvasLeft = clampInteger(
    Math.floor(visible.left),
    0,
    canvas.width,
  );
  const canvasTop = clampInteger(
    Math.floor(visible.top),
    0,
    canvas.height,
  );
  const canvasRight = clampInteger(
    Math.ceil(visible.left + visible.width),
    0,
    canvas.width,
  );
  const canvasBottom = clampInteger(
    Math.ceil(visible.top + visible.height),
    0,
    canvas.height,
  );

  const canvasWidth = canvasRight - canvasLeft;
  const canvasHeight = canvasBottom - canvasTop;
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { ok: true, value: null };
  }

  const sourceLeft = sourceCoordinate(
    canvasLeft,
    destination.left,
    destination.width,
    source.width,
    Math.floor,
  );
  const sourceTop = sourceCoordinate(
    canvasTop,
    destination.top,
    destination.height,
    source.height,
    Math.floor,
  );
  const sourceRight = sourceCoordinate(
    canvasRight,
    destination.left,
    destination.width,
    source.width,
    Math.ceil,
  );
  const sourceBottom = sourceCoordinate(
    canvasBottom,
    destination.top,
    destination.height,
    source.height,
    Math.ceil,
  );

  const sourceWidth = sourceRight - sourceLeft;
  const sourceHeight = sourceBottom - sourceTop;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      source: {
        left: sourceLeft,
        top: sourceTop,
        width: sourceWidth,
        height: sourceHeight,
      },
      canvas: {
        left: canvasLeft,
        top: canvasTop,
        width: canvasWidth,
        height: canvasHeight,
      },
    },
  };
}

function sourceCoordinate(
  canvasCoordinate: number,
  destinationOrigin: number,
  destinationLength: number,
  sourceLength: number,
  rounding: (value: number) => number,
): number {
  const mapped = (
    (canvasCoordinate - destinationOrigin)
    / destinationLength
  ) * sourceLength;
  return clampInteger(rounding(mapped), 0, sourceLength);
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value));
}
