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
//   - Bounded static PNG rendering from immutable media-editor state.
// - Must-Not:
//   - Mutate originals, invent product limits, or flatten animated sources.
// - Allows:
//   - Inputs: Source bytes, editor state, canvas, limits, and blur strength.
//   - Outputs: Edited PNG bytes or stable fail-closed rendering failures.
//   - Side effects: Native Sharp decode, transform, and encode work.
// - Split-When:
//   - Animated editor rendering gains independently reviewed semantics.
// - Merge-When:
//   - Base and edited rendition pipelines can share all transformation rules.
// - Summary:
//   - Applies pan, zoom, contrast, saturation, blur, and redaction to statics.
// - Description:
//   - Source cropping precedes resize so extreme zoom stays canvas-bounded.
// - Usage:
//   - Render edited static media before transactional rendition replacement.
// - Defaults:
//   - Redaction is opaque black; blur sigma is always caller-supplied.
//
import {
  resolveForegroundRasterSample,
  type PixelRectangle,
} from "../../editor-layout/domain/raster-layout.ts";
import {
  type MediaEditorRegion,
  type MediaEditorState,
} from "../../editor-state/domain/editor-state.ts";
import {
  decodeSourceImage,
  type ImageDecodeResult,
} from "../../image-decoding/adapter-outbound/sharp-image.ts";
import {
  type ImageRendition,
  type RenditionCanvas,
  type RenditionLimits,
} from "./sharp-rendition.ts";
import { loadSharp } from
  "../../sharp-runtime/adapter-outbound/sharp-runtime.ts";

type DecodeFailureCode = Extract<
  ImageDecodeResult,
  { readonly ok: false }
>["code"];

export interface EditorRenditionOptions {
  readonly blurSigma: number;
}

export type EditorRenditionResult =
  | { readonly ok: true; readonly value: ImageRendition }
  | {
      readonly ok: false;
      readonly code:
        | "invalid-editor-rendition"
        | "editor-animation-unsupported"
        | "rendition-pixel-limit-exceeded"
        | "rendition-byte-limit-exceeded"
        | "rendition-failed";
      readonly sourceCode?: DecodeFailureCode;
    };

export async function renderEditedImageRendition(
  source: Uint8Array,
  state: MediaEditorState,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  options: EditorRenditionOptions,
): Promise<EditorRenditionResult> {
  if (
    !validCanvasAndLimits(canvas, limits)
    || !validEditorState(state)
    || !validBlurSigma(options.blurSigma)
  ) {
    return { ok: false, code: "invalid-editor-rendition" };
  }

  if (
    exceedsPixelLimit(
      canvas.width,
      canvas.height,
      1,
      limits.maxOutputPixels,
    )
  ) {
    return { ok: false, code: "rendition-pixel-limit-exceeded" };
  }

  const decoded = await decodeSourceImage(source, limits.maxInputPixels);
  if (!decoded.ok) {
    return {
      ok: false,
      code: "rendition-failed",
      sourceCode: decoded.code,
    };
  }
  if (decoded.value.animated) {
    return { ok: false, code: "editor-animation-unsupported" };
  }

  try {
    const adjusted = await adjustSource(
      source,
      state,
      limits.maxInputPixels,
    );
    const adjustedDecoded = await decodeSourceImage(
      adjusted,
      limits.maxInputPixels,
    );
    if (!adjustedDecoded.ok || adjustedDecoded.value.animated) {
      return { ok: false, code: "rendition-failed" };
    }

    const sample = resolveForegroundRasterSample(
      {
        width: adjustedDecoded.value.frameWidth,
        height: adjustedDecoded.value.frameHeight,
      },
      canvas,
      state.transform,
    );
    if (!sample.ok) {
      return { ok: false, code: "invalid-editor-rendition" };
    }

    let rendered = await renderStaticBase(
      adjusted,
      canvas,
      limits,
      sample.value,
    );
    rendered = await applyRegions(
      rendered,
      state.regions,
      canvas,
      limits.maxOutputPixels,
      options.blurSigma,
    );

    if (rendered.byteLength > limits.maxOutputBytes) {
      return { ok: false, code: "rendition-byte-limit-exceeded" };
    }

    return {
      ok: true,
      value: {
        bytes: rendered,
        format: "png",
        mediaType: "image/png",
        width: canvas.width,
        height: canvas.height,
        frameCount: 1,
        animated: false,
      },
    };
  } catch {
    return { ok: false, code: "rendition-failed" };
  }
}

async function adjustSource(
  source: Uint8Array,
  state: MediaEditorState,
  maxInputPixels: number,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const contrast = state.transform.contrast;
  const offset = 128 * (1 - contrast);

  return await sharp(source, {
    failOn: "warning",
    limitInputPixels: maxInputPixels,
  })
    .rotate()
    .ensureAlpha()
    .linear(
      [contrast, contrast, contrast, 1],
      [offset, offset, offset, 0],
    )
    .modulate({ saturation: state.transform.saturation })
    .png()
    .toBuffer();
}

async function renderStaticBase(
  adjusted: Uint8Array,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  sample: {
    readonly source: PixelRectangle;
    readonly canvas: PixelRectangle;
  } | null,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

  const background = await sharp(adjusted, {
    failOn: "warning",
    limitInputPixels: limits.maxInputPixels,
  })
    .resize({
      width: canvas.width,
      height: canvas.height,
      fit: "cover",
    })
    .blur(20)
    .png()
    .toBuffer();

  if (sample === null) {
    return background;
  }

  const foreground = await sharp(adjusted, {
    failOn: "warning",
    limitInputPixels: limits.maxInputPixels,
  })
    .extract(sample.source)
    .resize({
      width: sample.canvas.width,
      height: sample.canvas.height,
      fit: "fill",
      background: transparent,
    })
    .png()
    .toBuffer();

  return await sharp(background, {
    failOn: "warning",
    limitInputPixels: limits.maxOutputPixels,
  })
    .composite([{
      input: foreground,
      top: sample.canvas.top,
      left: sample.canvas.left,
    }])
    .png()
    .toBuffer();
}

async function applyRegions(
  base: Uint8Array,
  regions: readonly MediaEditorRegion[],
  canvas: RenditionCanvas,
  maxOutputPixels: number,
  blurSigma: number,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  let current = base;

  for (const region of regions) {
    const rectangle = rasterizeRegion(region, canvas);
    if (region.mode === "redact") {
      current = await sharp(current, {
        failOn: "warning",
        limitInputPixels: maxOutputPixels,
      })
        .composite([{
          input: {
            create: {
              width: rectangle.width,
              height: rectangle.height,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 1 },
            },
          },
          top: rectangle.top,
          left: rectangle.left,
        }])
        .png()
        .toBuffer();
      continue;
    }

    const blurred = await sharp(current, {
      failOn: "warning",
      limitInputPixels: maxOutputPixels,
    })
      .extract(rectangle)
      .blur(blurSigma)
      .png()
      .toBuffer();
    current = await sharp(current, {
      failOn: "warning",
      limitInputPixels: maxOutputPixels,
    })
      .composite([{
        input: blurred,
        top: rectangle.top,
        left: rectangle.left,
      }])
      .png()
      .toBuffer();
  }

  return current;
}

function rasterizeRegion(
  region: MediaEditorRegion,
  canvas: RenditionCanvas,
): PixelRectangle {
  const left = Math.floor(region.x * canvas.width);
  const top = Math.floor(region.y * canvas.height);
  const right = Math.min(
    canvas.width,
    Math.ceil((region.x + region.width) * canvas.width),
  );
  const bottom = Math.min(
    canvas.height,
    Math.ceil((region.y + region.height) * canvas.height),
  );
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function validCanvasAndLimits(
  canvas: RenditionCanvas,
  limits: RenditionLimits,
): boolean {
  return positiveSafeInteger(canvas.width)
    && positiveSafeInteger(canvas.height)
    && positiveSafeInteger(limits.maxInputPixels)
    && positiveSafeInteger(limits.maxOutputPixels)
    && positiveSafeInteger(limits.maxOutputBytes);
}

function validEditorState(state: MediaEditorState): boolean {
  return finite(state.transform.panX)
    && finite(state.transform.panY)
    && positiveFinite(state.transform.zoom)
    && nonNegativeFinite(state.transform.contrast)
    && nonNegativeFinite(state.transform.saturation)
    && state.regions.every(validRegion);
}

function validRegion(region: MediaEditorRegion): boolean {
  return region.id.length > 0
    && (region.mode === "blur" || region.mode === "redact")
    && unit(region.x)
    && unit(region.y)
    && positiveUnit(region.width)
    && positiveUnit(region.height)
    && region.x + region.width <= 1
    && region.y + region.height <= 1;
}

function validBlurSigma(value: number): boolean {
  return finite(value) && value >= 0.3 && value <= 1000;
}

function unit(value: number): boolean {
  return finite(value) && value >= 0 && value <= 1;
}

function positiveUnit(value: number): boolean {
  return finite(value) && value > 0 && value <= 1;
}

function positiveFinite(value: number): boolean {
  return finite(value) && value > 0;
}

function nonNegativeFinite(value: number): boolean {
  return finite(value) && value >= 0;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function exceedsPixelLimit(
  width: number,
  height: number,
  frames: number,
  limit: number,
): boolean {
  if (width > Math.floor(limit / height)) {
    return true;
  }
  return frames > Math.floor(limit / (width * height));
}
