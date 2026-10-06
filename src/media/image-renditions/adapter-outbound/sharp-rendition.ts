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
import { renderEditedImageRendition } from "./edit.ts";
import type { EditorRenditionOptions } from "./edit.ts";

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
export type ImageRenditionResult =
  | { readonly ok: true; readonly value: ImageRendition }
  | { readonly ok: false; readonly code: string; readonly sourceCode?: string };

export async function renderImageRendition(
  source: Uint8Array,
  canvas: RenditionCanvas,
  limits: RenditionLimits,
  options: Partial<EditorRenditionOptions> = {},
): Promise<ImageRenditionResult> {
  const result = await renderEditedImageRendition(
    source,
    {
      name: "",
      description: "",
      regions: [],
      transform: { panX: 0, panY: 0, zoom: 1, contrast: 1, saturation: 1 },
    },
    canvas,
    limits,
    { ...options, blurSigma: options.blurSigma ?? 20 },
  );
  return !result.ok && result.code === "invalid-editor-rendition"
    ? { ok: false, code: "invalid-rendition-limits" }
    : !result.ok && result.code === "editor-animation-unsupported"
      ? { ok: false, code: "animated-rendition-unsupported" }
      : result;
}
