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
//   - Fixed-canvas PNG and animation-preserving GIF working renditions.
// - Must-Not:
//   - Invent Blooket dimensions/limits, persist files, or mutate originals.
// - Allows:
//   - Inputs: Validatable source bytes and explicit resource/canvas ceilings.
//   - Outputs: Encoded rendition bytes with exact canvas and frame metadata.
//   - Side effects: Native decoder/encoder work and bounded process memory.
// - Split-When:
//   - Interactive editor transforms require independently versioned operations.
// - Merge-When:
//   - One media adapter owns decoding and every rendition transformation.
// - Summary:
//   - Builds bounded fixed-size static or GIF renditions with Sharp.
// - Description:
//   - Static images use blurred cover background plus contained foreground.
// - Usage:
//   - Call with capability-derived dimensions and byte/pixel limits.
// - Defaults:
//   - Static output is PNG; animated output is GIF only when input is GIF.
//
import {
  decodeSourceImage,
  type ImageDecodeResult,
} from "../../image-decoding/adapter-outbound/sharp-image.ts";
import { loadSharp } from
  "../../sharp-runtime/adapter-outbound/sharp-runtime.ts";

export interface RenditionLimits {
  readonly maxInputPixels: number;
  readonly maxOutputPixels: number;
  readonly maxOutputBytes: number;
}

export interface RenditionCanvas {
  readonly width: number;
  readonly height: number;
}

export interface ImageRendition {
  readonly bytes: Uint8Array;
  readonly format: "png" | "gif";
  readonly mediaType: "image/png" | "image/gif";
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly animated: boolean;
}

type DecodeFailureCode = Extract<
  ImageDecodeResult,
  { readonly ok: false }
>["code"];

export type ImageRenditionResult =
  | { readonly ok: true; readonly value: ImageRendition }
  | {
      readonly ok: false;
      readonly code:
        | "invalid-rendition-limits"
        | "rendition-pixel-limit-exceeded"
        | "animated-rendition-unsupported"
        | "rendition-byte-limit-exceeded"
        | "rendition-failed";
      readonly sourceCode?: DecodeFailureCode;
    };

export async function renderImageRendition(
  source: Uint8Array,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
): Promise<ImageRenditionResult> {
  if (!validRequest(canvas, limits)) {
    return { ok: false, code: "invalid-rendition-limits" };
  }

  const decoded = await decodeSourceImage(source, limits.maxInputPixels);
  if (!decoded.ok) {
    return {
      ok: false,
      code: "rendition-failed",
      sourceCode: decoded.code,
    };
  }

  if (
    exceedsPixelLimit(
      canvas.width,
      canvas.height,
      decoded.value.frameCount,
      limits.maxOutputPixels,
    )
  ) {
    return { ok: false, code: "rendition-pixel-limit-exceeded" };
  }

  if (decoded.value.animated && decoded.value.format.format !== "gif") {
    return { ok: false, code: "animated-rendition-unsupported" };
  }

  try {
    const bytes = decoded.value.animated
      ? await renderAnimatedGif(source, canvas, limits, decoded.value)
      : await renderStaticPng(source, canvas, limits);

    if (bytes.byteLength > limits.maxOutputBytes) {
      return { ok: false, code: "rendition-byte-limit-exceeded" };
    }

    const animated = decoded.value.animated;
    return {
      ok: true,
      value: {
        bytes,
        format: animated ? "gif" : "png",
        mediaType: animated ? "image/gif" : "image/png",
        width: canvas.width,
        height: canvas.height,
        frameCount: decoded.value.frameCount,
        animated,
      },
    };
  } catch {
    return { ok: false, code: "rendition-failed" };
  }
}

async function renderStaticPng(
  source: Uint8Array,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const inputOptions = {
    failOn: "warning" as const,
    limitInputPixels: limits.maxInputPixels,
  };
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

  const background = await sharp(source, inputOptions)
    .rotate()
    .resize({
      width: canvas.width,
      height: canvas.height,
      fit: "cover",
    })
    .blur(20)
    .png()
    .toBuffer();

  const foreground = await sharp(source, inputOptions)
    .rotate()
    .resize({
      width: canvas.width,
      height: canvas.height,
      fit: "contain",
      background: transparent,
    })
    .png()
    .toBuffer();

  return await sharp(background, {
    failOn: "warning",
    limitInputPixels: limits.maxOutputPixels,
  })
    .composite([{ input: foreground }])
    .png()
    .toBuffer();
}

async function renderAnimatedGif(
  source: Uint8Array,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  decoded: {
    readonly loopCount?: number;
    readonly frameDelaysMs: readonly number[];
  },
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  return await sharp(source, {
    animated: true,
    failOn: "warning",
    limitInputPixels: limits.maxInputPixels,
  })
    .resize({
      width: canvas.width,
      height: canvas.height,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .gif({
      loop: decoded.loopCount ?? 0,
      delay: decoded.frameDelaysMs,
      keepDuplicateFrames: true,
    })
    .toBuffer();
}

function validRequest(
  canvas: RenditionCanvas,
  limits: RenditionLimits,
): boolean {
  return isPositiveInteger(canvas.width)
    && isPositiveInteger(canvas.height)
    && isPositiveInteger(limits.maxInputPixels)
    && isPositiveInteger(limits.maxOutputPixels)
    && isPositiveInteger(limits.maxOutputBytes);
}

function isPositiveInteger(value: number): boolean {
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
