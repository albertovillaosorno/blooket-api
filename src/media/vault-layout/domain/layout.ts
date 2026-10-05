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
//   - Deterministic relative paths for original and prepared vault assets.
// - Must-Not:
//   - Touch files, choose media IDs, or infer formats from extensions.
// - Allows:
//   - Inputs: Validated media IDs, source formats, and rendition formats.
//   - Outputs: Repository-owned normalized relative vault paths.
//   - Side effects: None.
// - Split-When:
//   - Additional rendition classes require independently versioned paths.
// - Merge-When:
//   - Media records no longer refer to local relative asset paths.
// - Summary:
//   - Keeps vault path construction deterministic and non-user-controlled.
// - Description:
//   - Separates immutable originals from working Blooket-ready renditions.
// - Usage:
//   - Derive paths after validating a media ID and decoding source bytes.
// - Defaults:
//   - Renditions live under media/ to match persisted media-record examples.
//
import { decodeMediaId } from
  "../../media-identifiers/domain/media-id.ts";
import { type ImageFormat } from
  "../../image-formats/domain/image-format.ts";

export type SourceImageExtension =
  | ".jpg"
  | ".png"
  | ".webp"
  | ".avif"
  | ".gif";

export type RenditionImageFormat = "png" | "gif";

export interface MediaVaultPaths {
  readonly original: string;
  readonly rendition: string;
}

export function mediaVaultPaths(
  mediaId: string,
  sourceFormat: ImageFormat,
  renditionFormat: RenditionImageFormat,
): MediaVaultPaths | undefined {
  const decodedId = decodeMediaId(mediaId);
  if (!decodedId.ok) {
    return undefined;
  }

  return {
    original: "originals/"
      + decodedId.value.value
      + sourceExtension(sourceFormat),
    rendition: mediaRenditionPath(
      decodedId.value.value,
      renditionFormat,
    )!,
  };
}

export function mediaRenditionPath(
  mediaId: string,
  renditionFormat: RenditionImageFormat,
): string | undefined {
  const decodedId = decodeMediaId(mediaId);
  if (!decodedId.ok) {
    return undefined;
  }
  return "media/"
    + decodedId.value.value
    + "."
    + renditionFormat;
}

export function sourceExtension(
  sourceFormat: ImageFormat,
): SourceImageExtension {
  switch (sourceFormat) {
    case "jpeg":
      return ".jpg";
    case "png":
      return ".png";
    case "webp":
      return ".webp";
    case "avif":
      return ".avif";
    case "gif":
      return ".gif";
  }
}
