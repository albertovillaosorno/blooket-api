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
//   - Deterministic foreground placement semantics for editor pan and zoom.
// - Must-Not:
//   - Decode pixels, allocate resized images, or choose UI nudge increments.
// - Allows:
//   - Inputs: Source/canvas dimensions plus finite pan and positive zoom.
//   - Outputs: Floating-point destination and visible canvas rectangles.
//   - Side effects: None.
// - Split-When:
//   - Rotation or perspective transforms need independent layout semantics.
// - Merge-When:
//   - Editor rendering no longer separates geometry from pixel processing.
// - Summary:
//   - Defines zoom-one contain placement and canvas-relative pan offsets.
// - Description:
//   - Pan one moves the foreground center by one full canvas dimension.
// - Usage:
//   - Resolve geometry before bounded Sharp crop/resize/composite work.
// - Defaults:
//   - Neutral pan is zero and neutral zoom is one.
//
export interface EditorImageSize {
  readonly width: number;
  readonly height: number;
}

export interface EditorPanZoom {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

export interface EditorRectangle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ForegroundLayout {
  readonly destination: EditorRectangle;
  readonly visible: EditorRectangle;
}

export type ForegroundLayoutResult =
  | { readonly ok: true; readonly value: ForegroundLayout }
  | { readonly ok: false; readonly code: "invalid-editor-layout" };

export function resolveForegroundLayout(
  source: EditorImageSize,
  canvas: EditorImageSize,
  transform: EditorPanZoom,
): ForegroundLayoutResult {
  if (
    !positiveSafeInteger(source.width)
    || !positiveSafeInteger(source.height)
    || !positiveSafeInteger(canvas.width)
    || !positiveSafeInteger(canvas.height)
    || !finite(transform.panX)
    || !finite(transform.panY)
    || !positiveFinite(transform.zoom)
  ) {
    return { ok: false, code: "invalid-editor-layout" };
  }

  const scale = Math.min(
    canvas.width / source.width,
    canvas.height / source.height,
  ) * transform.zoom;
  const width = source.width * scale;
  const height = source.height * scale;
  const left = (canvas.width - width) / 2
    + transform.panX * canvas.width;
  const top = (canvas.height - height) / 2
    + transform.panY * canvas.height;

  if (
    !positiveFinite(width)
    || !positiveFinite(height)
    || !finite(left)
    || !finite(top)
  ) {
    return { ok: false, code: "invalid-editor-layout" };
  }

  const visibleLeft = Math.max(0, left);
  const visibleTop = Math.max(0, top);
  const visibleRight = Math.min(canvas.width, left + width);
  const visibleBottom = Math.min(canvas.height, top + height);

  return {
    ok: true,
    value: {
      destination: { left, top, width, height },
      visible: {
        left: visibleLeft,
        top: visibleTop,
        width: Math.max(0, visibleRight - visibleLeft),
        height: Math.max(0, visibleBottom - visibleTop),
      },
    },
  };
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function positiveFinite(value: number): boolean {
  return finite(value) && value > 0;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}
