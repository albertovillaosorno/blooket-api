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
import { isRecord, unknownFieldIssues } from
  "../../runtime-decoding/domain/exact-object.ts";

export interface BlooketPreparedImage {
  readonly format: "png" | "jpeg" | "gif";
  readonly base64: string;
}

export function decodeBlooketPreparedImage(
  value: unknown,
  path = "$",
): DecodeResult<BlooketPreparedImage> {
  if (isRecord(value) &&
      unknownFieldIssues(value, new Set(["format", "base64"]), path)
        .length === 0 &&
      (value["format"] === "png" || value["format"] === "jpeg" ||
        value["format"] === "gif") && typeof value["base64"] === "string") {
    const image: BlooketPreparedImage = {
      format: value["format"], base64: value["base64"],
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
  if (typeof value.base64 !== "string" || value.base64.length < 4 ||
      value.base64.length > 3_333_332) return undefined;
  try {
    const binary = atob(value.base64);
    if (binary.length < 1 || binary.length >= 2_500_000 ||
        btoa(binary) !== value.base64) return undefined;
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const valid = value.format === "png"
      ? bytes.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
      : value.format === "jpeg"
        ? bytes.length >= 3 && bytes[0] === 255 &&
          bytes[1] === 216 && bytes[2] === 255
        : value.format === "gif" && bytes.length >= 6 &&
          bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 &&
          bytes[3] === 56 && (bytes[4] === 55 || bytes[4] === 57) &&
          bytes[5] === 97;
    return valid ? bytes : undefined;
  } catch { return undefined; }
}
