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
//   - Content-based identification of image formats admitted for media intake.
// - Must-Not:
//   - Trust file extensions, claimed MIME types, or decode image pixels.
// - Allows:
//   - Inputs: Untrusted image bytes.
//   - Outputs: Supported format identity, MIME type, and canonical extension.
//   - Side effects: None.
// - Split-When:
//   - A format requires substantial independent structural validation.
// - Merge-When:
//   - Media intake delegates all format authority to one reviewed decoder.
// - Summary:
//   - Recognizes the initial JPEG, PNG, WebP, AVIF, and GIF intake formats.
// - Description:
//   - Uses stable file signatures and AVIF ISO BMFF brands.
// - Usage:
//   - Detect before decoder selection or durable media publication.
// - Defaults:
//   - Unknown, truncated, HEIC-only, and spoofed signatures are rejected.
//
export type ImageFormat = "jpeg" | "png" | "webp" | "avif" | "gif";

export interface ImageFormatInfo {
  readonly format: ImageFormat;
  readonly mediaType: string;
  readonly extension: string;
}

const FORMAT_INFO: Readonly<Record<ImageFormat, ImageFormatInfo>> = {
  jpeg: {
    format: "jpeg",
    mediaType: "image/jpeg",
    extension: ".jpg",
  },
  png: {
    format: "png",
    mediaType: "image/png",
    extension: ".png",
  },
  webp: {
    format: "webp",
    mediaType: "image/webp",
    extension: ".webp",
  },
  avif: {
    format: "avif",
    mediaType: "image/avif",
    extension: ".avif",
  },
  gif: {
    format: "gif",
    mediaType: "image/gif",
    extension: ".gif",
  },
};

export function detectImageFormat(
  bytes: Uint8Array,
): ImageFormatInfo | undefined {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return FORMAT_INFO.jpeg;
  }
  if (hasPrefix(bytes, [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ])) {
    return FORMAT_INFO.png;
  }
  if (asciiEquals(bytes, 0, "GIF87a") || asciiEquals(bytes, 0, "GIF89a")) {
    return FORMAT_INFO.gif;
  }
  if (
    asciiEquals(bytes, 0, "RIFF")
    && asciiEquals(bytes, 8, "WEBP")
  ) {
    return FORMAT_INFO.webp;
  }
  if (hasAvifBrand(bytes)) {
    return FORMAT_INFO.avif;
  }
  return undefined;
}

function hasAvifBrand(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || !asciiEquals(bytes, 4, "ftyp")) {
    return false;
  }

  const boxSize = readUint32BigEndian(bytes, 0);
  if (boxSize < 16 || boxSize > bytes.length) {
    return false;
  }
  if (isAvifBrand(bytes, 8)) {
    return true;
  }

  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    if (isAvifBrand(bytes, offset)) {
      return true;
    }
  }
  return false;
}

function isAvifBrand(bytes: Uint8Array, offset: number): boolean {
  return asciiEquals(bytes, offset, "avif")
    || asciiEquals(bytes, offset, "avis");
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000
    + bytes[offset + 1]! * 0x10000
    + bytes[offset + 2]! * 0x100
    + bytes[offset + 3]!
  );
}

function asciiEquals(
  bytes: Uint8Array,
  offset: number,
  expected: string,
): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function hasPrefix(
  bytes: Uint8Array,
  prefix: readonly number[],
): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }
  return prefix.every((byte, index) => bytes[index] === byte);
}
