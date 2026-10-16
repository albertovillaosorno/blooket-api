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
//   - Exact bounded prepared-image bytes crossing the local browser bridge.
// - Must-Not:
//   - Accept paths, source URLs, filenames, or infer full image validity.
// - Allows:
//   - Inputs: Unknown format/base64 candidates from admitted local snapshots.
//   - Outputs: Canonical byte envelopes or a stable decoder rejection.
//   - Side effects: None.
// - Split-When:
//   - Other binary media need incompatible envelopes or bounds.
// - Merge-When:
//   - Prepared files no longer cross the browser bridge.
// - Summary:
//   - Keeps browser payloads bounded and independent of filesystem authority.
// - Description:
//   - Magic checks supplement upstream prepared-media image decoding.
// - Usage:
//   - Decode before dispatch and before constructing a browser File.
// - Defaults:
//   - Noncanonical encoding, unknown fields, and format mismatches fail.
//
import type { DecodeResult } from
  "../../runtime-decoding/domain/decode-result.ts";
import { exactOwnData } from
  "../../runtime-decoding/domain/exact-object.ts";

export interface BlooketPreparedImage {
  readonly format: "png" | "jpeg" | "gif";
  readonly base64: string;
}

export function decodeBlooketPreparedImage(
  value: unknown,
  path = "$",
): DecodeResult<BlooketPreparedImage> {
  const owned = exactOwnData(value, ["format", "base64"]);
  if (owned &&
      (owned["format"] === "png" || owned["format"] === "jpeg" ||
        owned["format"] === "gif") && typeof owned["base64"] === "string") {
    const image: BlooketPreparedImage = {
      format: owned["format"], base64: owned["base64"],
    };
    if (blooketPreparedImageBytes(image) !== undefined)
      return { ok: true, value: image };
  }
  return { ok: false, issues: [{
    path, code: "invalid-prepared-image",
    message: "Expected one bounded canonical prepared-image byte envelope.",
  }] };
}

export function blooketPreparedImageBytes(
  value: BlooketPreparedImage,
): Uint8Array<ArrayBuffer> | undefined {
  const owned = exactOwnData(value, ["format", "base64"]);
  const format = owned?.["format"];
  const base64 = owned?.["base64"];
  if (typeof base64 !== "string" || base64.length < 4 ||
      base64.length > 3_333_332) return undefined;
  try {
    const binary = atob(base64);
    if (binary.length < 1 || binary.length >= 2_500_000 ||
        btoa(binary) !== base64) return undefined;
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const valid = format === "png"
      ? bytes.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
      : format === "jpeg"
        ? bytes.length >= 3 && bytes[0] === 255 &&
          bytes[1] === 216 && bytes[2] === 255
        : format === "gif" && bytes.length >= 6 &&
          bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 &&
          bytes[3] === 56 && (bytes[4] === 55 || bytes[4] === 57) &&
          bytes[5] === 97;
    return valid ? bytes : undefined;
  } catch { return undefined; }
}
