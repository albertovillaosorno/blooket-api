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
//   - Strict decoder-backed validation and metadata inspection of images.
// - Must-Not:
//   - Choose product byte/pixel limits, persist media, or invent canvas sizes.
// - Allows:
//   - Inputs: Untrusted supported-format bytes and an explicit pixel ceiling.
//   - Outputs: Validated frame metadata or stable decoder failure codes.
//   - Side effects: Native decoder work and bounded temporary process memory.
// - Split-When:
//   - Rendition generation needs independently versioned transformation rules.
// - Merge-When:
//   - One reviewed decoder owns both validation and rendition generation.
// - Summary:
//   - Fully decodes supported source images with Sharp and reports frame facts.
// - Description:
//   - Cross-checks magic-byte detection against libvips decoder metadata.
// - Usage:
//   - Run after byte admission and before durable original publication.
// - Defaults:
//   - Sharp warning-level failures and unknown decoder formats fail closed.
//
import {
  detectImageFormat,
  type ImageFormat,
  type ImageFormatInfo,
} from "../../image-formats/domain/image-format.ts";

interface SharpInputOptions {
  readonly animated: boolean;
  readonly failOn: "warning";
  readonly limitInputPixels: number | boolean;
}

interface SharpMetadata {
  readonly format?: string;
  readonly compression?: string;
  readonly width?: number;
  readonly height?: number;
  readonly pages?: number;
  readonly pageHeight?: number;
  readonly loop?: number;
  readonly delay?: readonly number[];
}

interface SharpPipeline {
  metadata(): Promise<SharpMetadata>;
  raw(): SharpPipeline;
  toBuffer(): Promise<Uint8Array>;
}

type SharpFactory = (
  input: Uint8Array,
  options: SharpInputOptions,
) => SharpPipeline;

let sharpFactory: SharpFactory | undefined;

export interface DecodedSourceImage {
  readonly format: ImageFormatInfo;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  readonly animated: boolean;
  readonly loopCount?: number;
  readonly frameDelaysMs: readonly number[];
}

export type ImageDecodeResult =
  | { readonly ok: true; readonly value: DecodedSourceImage }
  | {
      readonly ok: false;
      readonly code:
        | "invalid-pixel-limit"
        | "unsupported-image-format"
        | "image-pixel-limit-exceeded"
        | "image-decode-failed"
        | "decoder-format-mismatch"
        | "invalid-image-metadata";
    };

export async function decodeSourceImage(
  bytes: Uint8Array,
  maxInputPixels: number,
): Promise<ImageDecodeResult> {
  if (!Number.isSafeInteger(maxInputPixels) || maxInputPixels < 1) {
    return { ok: false, code: "invalid-pixel-limit" };
  }

  const detected = detectImageFormat(bytes);
  if (detected === undefined) {
    return { ok: false, code: "unsupported-image-format" };
  }

  try {
    const sharp = await loadSharp();
    const metadataOptions = {
      animated: true,
      failOn: "warning" as const,
      limitInputPixels: false,
    };
    const metadata = await sharp(bytes, metadataOptions).metadata();
    const decodedFormat = normalizeDecoderFormat(
      metadata.format,
      metadata.compression,
    );
    if (decodedFormat !== detected.format) {
      return { ok: false, code: "decoder-format-mismatch" };
    }

    const frameCount = metadata.pages ?? 1;
    const frameWidth = metadata.width;
    const frameHeight = metadata.pageHeight ?? metadata.height;
    if (
      !isPositiveInteger(frameWidth)
      || !isPositiveInteger(frameHeight)
      || !isPositiveInteger(frameCount)
    ) {
      return { ok: false, code: "invalid-image-metadata" };
    }

    if (
      exceedsPixelLimit(
        frameWidth,
        frameHeight,
        frameCount,
        maxInputPixels,
      )
    ) {
      return { ok: false, code: "image-pixel-limit-exceeded" };
    }

    const frameDelaysMs = frameCount > 1
      ? normalizeDelays(metadata.delay, frameCount)
      : [];
    if (frameDelaysMs === undefined) {
      return { ok: false, code: "invalid-image-metadata" };
    }

    // Force a complete pixel decode so valid headers cannot admit corrupt image
    // payloads into durable storage. The caller-supplied pixel ceiling remains
    // active for this second decoder instance.
    await sharp(bytes, {
      animated: true,
      failOn: "warning",
      limitInputPixels: maxInputPixels,
    }).raw().toBuffer();

    const value: DecodedSourceImage = {
      format: detected,
      frameWidth,
      frameHeight,
      frameCount,
      animated: frameCount > 1,
      frameDelaysMs,
      ...(frameCount > 1 && metadata.loop !== undefined
        ? { loopCount: metadata.loop }
        : {}),
    };
    return { ok: true, value };
  } catch {
    return { ok: false, code: "image-decode-failed" };
  }
}

async function loadSharp(): Promise<SharpFactory> {
  if (sharpFactory !== undefined) {
    return sharpFactory;
  }

  const moduleUrl = new URL(
    "../../../../.dependencies/pnpm/node_modules/sharp/dist/index.mjs",
    import.meta.url,
  );
  const loaded = await import(moduleUrl.href) as {
    readonly default: SharpFactory;
  };
  sharpFactory = loaded.default;
  return sharpFactory;
}

function normalizeDecoderFormat(
  format: string | undefined,
  compression: string | undefined,
): ImageFormat | undefined {
  if (
    format === "jpeg"
    || format === "png"
    || format === "webp"
    || format === "gif"
  ) {
    return format;
  }
  if (format === "heif" && compression === "av1") {
    return "avif";
  }
  return undefined;
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
  const framePixels = width * height;
  return frames > Math.floor(limit / framePixels);
}

function normalizeDelays(
  delays: readonly number[] | undefined,
  frameCount: number,
): readonly number[] | undefined {
  if (delays === undefined || delays.length !== frameCount) {
    return undefined;
  }
  return delays.every((delay) => Number.isSafeInteger(delay) && delay >= 0)
    ? [...delays]
    : undefined;
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined
    && Number.isSafeInteger(value)
    && value > 0;
}
