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
//   - Bounded static PNG and animated GIF rendering from media-editor state.
// - Must-Not:
//   - Mutate originals, invent product limits, or collapse animation timing.
// - Allows:
//   - Inputs: Source bytes, editor state, canvas, limits, and blur strength.
//   - Outputs: Edited PNG bytes or stable fail-closed rendering failures.
//   - Side effects: Native Sharp decode, transform, and encode work.
// - Split-When:
//   - Another animated output format requires different frame semantics.
// - Merge-When:
//   - Base and edited rendition pipelines can share all transformation rules.
// - Summary:
//   - Applies editor transforms to static images and each GIF frame.
// - Description:
//   - Source cropping precedes resize so extreme zoom stays canvas-bounded.
// - Usage:
//   - Render edited media before transactional rendition replacement.
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

import { resampleGifTimeline } from "../../gif-timeline/domain/timeline.ts";
import {
  renditionOptimizationCandidates,
  type RenditionOptimizationCandidate,
} from "../../rendition-optimization/domain/candidates.ts";

type DecodeFailureCode = Extract<
  ImageDecodeResult,
  { readonly ok: false }
>["code"];

export interface EditorRenditionOptions {
  readonly blurSigma: number;
  readonly gifFps?: number;
  readonly background?: {
    readonly mode: "blur" | "solid";
    readonly color: string;
  };
  readonly compression?: "lossless" | "compact";
  readonly detailScale?: number;
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

export type OptimizedEditorRenditionResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly bytes: Uint8Array;
        readonly format: "jpeg" | "gif";
        readonly mediaType: "image/jpeg" | "image/gif";
        readonly width: number;
        readonly height: number;
        readonly frameCount: number;
        readonly animated: boolean;
        readonly effective: RenditionOptimizationCandidate;
      };
    }
  | Exclude<EditorRenditionResult, { readonly ok: true }>;

export async function renderEditedImageRendition(
  source: Uint8Array,
  state: MediaEditorState,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  options: EditorRenditionOptions,
): Promise<EditorRenditionResult> {
  if (
    !validCanvasAndLimits(canvas, limits) ||
    !validEditorState(state) ||
    !validBlurSigma(options.blurSigma) ||
    (options.detailScale !== undefined &&
      ![1, 0.85, 0.7, 0.55, 0.4].includes(options.detailScale)) ||
    (options.background !== undefined &&
      (!/^(#[0-9a-f]{6})$/iu.test(options.background.color) ||
        !["blur", "solid"].includes(options.background.mode)))
  ) {
    return { ok: false, code: "invalid-editor-rendition" };
  }

  const decoded = await decodeSourceImage(source, limits.maxInputPixels);
  if (!decoded.ok) {
    return {
      ok: false,
      code: "rendition-failed",
      sourceCode: decoded.code,
    };
  }
  return await renderDecodedImageRendition(
    source,
    decoded.value,
    state,
    canvas,
    limits,
    options,
  );
}

type DecodedImage = Extract<ImageDecodeResult, { readonly ok: true }>["value"];

async function renderDecodedImageRendition(
  source: Uint8Array,
  decoded: DecodedImage,
  state: MediaEditorState,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  options: EditorRenditionOptions,
  enforceByteLimit = true,
): Promise<EditorRenditionResult> {
  const timeline = decoded.animated
    ? resampleGifTimeline(decoded.frameDelaysMs, options.gifFps ?? 10)
    : { pages: [0], delayMs: 100 };
  if (timeline === undefined)
    return { ok: false, code: "invalid-editor-rendition" };
  if (
    exceedsPixelLimit(
      canvas.width,
      canvas.height,
      timeline.pages.length,
      limits.maxOutputPixels,
    )
  ) {
    return { ok: false, code: "rendition-pixel-limit-exceeded" };
  }
  if (decoded.animated && decoded.format.format !== "gif") {
    return { ok: false, code: "editor-animation-unsupported" };
  }

  try {
    const animated = decoded.animated;
    const rendered = animated
      ? await renderAnimatedGif(
          source,
          state,
          canvas,
          limits,
          options,
          timeline,
          {
            frameCount: decoded.frameCount,
            frameDelaysMs: decoded.frameDelaysMs,
            ...(decoded.loopCount === undefined
              ? {}
              : { loopCount: decoded.loopCount }),
          },
        )
      : await renderFrame(source, state, canvas, limits, options);

    if (
      enforceByteLimit &&
      rendered.byteLength > Math.min(limits.maxOutputBytes, 2_499_999)
    ) {
      return { ok: false, code: "rendition-byte-limit-exceeded" };
    }

    return {
      ok: true,
      value: {
        bytes: rendered,
        format: animated ? "gif" : "png",
        mediaType: animated ? "image/gif" : "image/png",
        width: canvas.width,
        height: canvas.height,
        frameCount: timeline.pages.length,
        animated,
      },
    };
  } catch {
    return { ok: false, code: "rendition-failed" };
  }
}

export async function renderOptimizedImageRendition(
  source: Uint8Array,
  state: MediaEditorState,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  options: EditorRenditionOptions & {
    readonly gifFps: number;
    readonly compression: "lossless" | "compact";
  },
): Promise<OptimizedEditorRenditionResult> {
  if (
    !validCanvasAndLimits(canvas, limits) ||
    !validEditorState(state) ||
    !validBlurSigma(options.blurSigma) ||
    (options.background !== undefined &&
      (!/^(#[0-9a-f]{6})$/iu.test(options.background.color) ||
        !["blur", "solid"].includes(options.background.mode)))
  )
    return { ok: false, code: "invalid-editor-rendition" };
  const decoded = await decodeSourceImage(source, limits.maxInputPixels);
  if (!decoded.ok) {
    return {
      ok: false,
      code: "rendition-failed",
      sourceCode: decoded.code,
    };
  }
  const candidates = renditionOptimizationCandidates({
    animated: decoded.value.animated,
    gifFps: options.gifFps,
    compression: options.compression,
  });
  if (candidates.length === 0)
    return { ok: false, code: "invalid-editor-rendition" };

  let lastLimitFailure: Extract<EditorRenditionResult, { ok: false }> = {
    ok: false,
    code: "rendition-byte-limit-exceeded",
  };
  for (const effective of candidates) {
    const rendered = await renderDecodedImageRendition(
      source,
      decoded.value,
      state,
      canvas,
      limits,
      {
        ...options,
        detailScale: effective.detailScale,
        gifFps: effective.gifFps ?? options.gifFps,
        compression: effective.compression,
      },
      false,
    );
    if (rendered.ok) {
      const bytes = decoded.value.animated
        ? rendered.value.bytes
        : await encodePreparedJpeg(
            rendered.value.bytes,
            effective.compression,
            options.background?.color ?? "#ffffff",
            limits.maxOutputPixels,
          );
      if (bytes.byteLength > Math.min(limits.maxOutputBytes, 2_499_999)) {
        lastLimitFailure = {
          ok: false,
          code: "rendition-byte-limit-exceeded",
        };
        continue;
      }
      return {
        ok: true,
        value: {
          ...rendered.value,
          bytes,
          format: decoded.value.animated ? "gif" : "jpeg",
          mediaType: decoded.value.animated ? "image/gif" : "image/jpeg",
          effective,
        },
      };
    }
    if (
      rendered.code !== "rendition-byte-limit-exceeded" &&
      rendered.code !== "rendition-pixel-limit-exceeded"
    )
      return rendered;
    lastLimitFailure = rendered;
  }
  return lastLimitFailure;
}

async function encodePreparedJpeg(
  source: Uint8Array,
  compression: "lossless" | "compact",
  background: string,
  maxOutputPixels: number,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  return await sharp(source, {
    failOn: "warning",
    limitInputPixels: maxOutputPixels,
  })
    .flatten({ background })
    .jpeg({
      quality: compression === "compact" ? 80 : 92,
      mozjpeg: true,
    })
    .toBuffer();
}

async function renderFrame(
  source: Uint8Array,
  state: MediaEditorState,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  options: EditorRenditionOptions,
  page?: number,
): Promise<Uint8Array> {
  const adjusted = await adjustSource(
    source,
    state,
    limits.maxInputPixels,
    page,
  );
  const adjustedDecoded = await decodeSourceImage(
    adjusted,
    limits.maxInputPixels,
  );
  if (!adjustedDecoded.ok || adjustedDecoded.value.animated) {
    throw new Error("Expected one decoded editor frame.");
  }
  const detailScale = options.detailScale ?? 1;
  const working =
    detailScale === 1
      ? adjusted
      : await reduceWorkingDetail(
          adjusted,
          adjustedDecoded.value.frameWidth,
          adjustedDecoded.value.frameHeight,
          detailScale,
          limits.maxInputPixels,
        );
  const workingWidth = Math.max(
    1,
    Math.round(adjustedDecoded.value.frameWidth * detailScale),
  );
  const workingHeight = Math.max(
    1,
    Math.round(adjustedDecoded.value.frameHeight * detailScale),
  );

  const sample = resolveForegroundRasterSample(
    {
      width: workingWidth,
      height: workingHeight,
    },
    canvas,
    state.transform,
  );
  if (!sample.ok) {
    throw new Error("Invalid editor frame layout.");
  }

  const base = await renderStaticBase(
    working,
    canvas,
    limits,
    sample.value,
    options.background,
  );
  const final = await applyRegions(
    base,
    state.regions,
    canvas,
    limits.maxOutputPixels,
    options.blurSigma,
  );
  if (options.compression !== "compact") return final;
  const sharp = await loadSharp();
  return await sharp(final, { limitInputPixels: limits.maxOutputPixels })
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toBuffer();
}

async function renderAnimatedGif(
  source: Uint8Array,
  state: MediaEditorState,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  options: EditorRenditionOptions,
  timeline: { readonly pages: readonly number[]; readonly delayMs: number },
  decoded: {
    readonly frameCount: number;
    readonly frameDelaysMs: readonly number[];
    readonly loopCount?: number;
  },
): Promise<Uint8Array> {
  const rawFrames: Uint8Array[] = [];
  const cache = new Map<number, Uint8Array>();
  for (const page of timeline.pages) {
    const cached = cache.get(page);
    if (cached !== undefined) {
      rawFrames.push(cached);
      continue;
    }
    const rendered = await renderFrame(
      source,
      state,
      canvas,
      limits,
      options,
      page,
    );
    const raw = await renderedFrameToRgba(
      rendered,
      canvas,
      limits.maxOutputPixels,
    );
    cache.set(page, raw);
    rawFrames.push(raw);
  }

  const sharp = await loadSharp();
  return await sharp(concatenate(rawFrames), {
    failOn: "warning",
    limitInputPixels: limits.maxOutputPixels,
    raw: {
      width: canvas.width,
      height: canvas.height * timeline.pages.length,
      channels: 4,
      pageHeight: canvas.height,
    },
  })
    .gif({
      loop: decoded.loopCount ?? 0,
      delay: timeline.pages.map(() => timeline.delayMs),
      effort: 7,
      ...(options.compression === "compact" ? { colours: 128 } : {}),
      keepDuplicateFrames: true,
    })
    .toBuffer();
}

async function renderedFrameToRgba(
  frame: Uint8Array,
  canvas: RenditionCanvas,
  maxOutputPixels: number,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const raw = await sharp(frame, {
    failOn: "warning",
    limitInputPixels: maxOutputPixels,
  })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const expected = canvas.width * canvas.height * 4;
  if (raw.byteLength !== expected) {
    throw new Error("Rendered editor frame has unexpected raw dimensions.");
  }
  return raw;
}

function concatenate(frames: readonly Uint8Array[]): Uint8Array {
  const byteLength = frames.reduce(
    (total, frame) => total + frame.byteLength,
    0,
  );
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.byteLength;
  }
  return output;
}

async function adjustSource(
  source: Uint8Array,
  state: MediaEditorState,
  maxInputPixels: number,
  page?: number,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const contrast = state.transform.contrast;
  const offset = 128 * (1 - contrast);

  const normalized = await sharp(source, {
    failOn: "warning",
    limitInputPixels: maxInputPixels,
    ...(page === undefined ? {} : { page, pages: 1 }),
  })
    .rotate()
    .toColourspace("srgb")
    .ensureAlpha()
    .png()
    .toBuffer();

  return await sharp(normalized, {
    failOn: "warning",
    limitInputPixels: maxInputPixels,
  })
    .linear([contrast, contrast, contrast, 1], [offset, offset, offset, 0])
    .modulate({ saturation: state.transform.saturation })
    .png()
    .toBuffer();
}

async function reduceWorkingDetail(
  source: Uint8Array,
  width: number,
  height: number,
  scale: number,
  maxInputPixels: number,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  return await sharp(source, {
    failOn: "warning",
    limitInputPixels: maxInputPixels,
  })
    .resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      fit: "fill",
    })
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
  fill?: EditorRenditionOptions["background"],
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

  const background =
    fill?.mode === "solid"
      ? await sharp(
          new Uint8Array([
            Number.parseInt(fill.color.slice(1, 3), 16),
            Number.parseInt(fill.color.slice(3, 5), 16),
            Number.parseInt(fill.color.slice(5, 7), 16),
            255,
          ]),
          { raw: { width: 1, height: 1, channels: 4 } },
        )
          .resize({ width: canvas.width, height: canvas.height, fit: "fill" })
          .png()
          .toBuffer()
      : await sharp(adjusted, {
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
    .composite([
      {
        input: foreground,
        top: sample.canvas.top,
        left: sample.canvas.left,
      },
    ])
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
        .composite([
          {
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
          },
        ])
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
      .composite([
        {
          input: blurred,
          top: rectangle.top,
          left: rectangle.left,
        },
      ])
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
  return (
    positiveSafeInteger(canvas.width) &&
    positiveSafeInteger(canvas.height) &&
    positiveSafeInteger(limits.maxInputPixels) &&
    positiveSafeInteger(limits.maxOutputPixels) &&
    positiveSafeInteger(limits.maxOutputBytes)
  );
}

function validEditorState(state: MediaEditorState): boolean {
  return (
    finite(state.transform.panX) &&
    finite(state.transform.panY) &&
    positiveFinite(state.transform.zoom) &&
    nonNegativeFinite(state.transform.contrast) &&
    nonNegativeFinite(state.transform.saturation) &&
    state.regions.every(validRegion)
  );
}

function validRegion(region: MediaEditorRegion): boolean {
  return (
    region.id.length > 0 &&
    (region.mode === "blur" || region.mode === "redact") &&
    unit(region.x) &&
    unit(region.y) &&
    positiveUnit(region.width) &&
    positiveUnit(region.height) &&
    region.x + region.width <= 1 &&
    region.y + region.height <= 1
  );
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
