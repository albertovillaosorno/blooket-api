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
//   - Admission checks for untrusted image bytes before decode or persistence.
// - Must-Not:
//   - Choose a Blooket limit, decode pixels, or write media-vault files.
// - Allows:
//   - Inputs: Untrusted bytes and an explicit caller-supplied byte ceiling.
//   - Outputs: Admitted source metadata or stable rejection diagnostics.
//   - Side effects: None.
// - Split-When:
//   - Decoder-derived dimensions and animation metadata need their own domain.
// - Merge-When:
//   - Image format detection becomes the complete source admission contract.
// - Summary:
//   - Enforces explicit byte ceilings and supported content signatures.
// - Description:
//   - Keeps platform capability limits outside the generic media domain.
// - Usage:
//   - Admit before selecting a decoder or publishing an original.
// - Defaults:
//   - There is no guessed upload limit; callers must supply one.
//
import {
  detectImageFormat,
  type ImageFormatInfo,
} from "../../image-formats/domain/image-format.ts";

export interface AdmittedSourceImage {
  readonly byteLength: number;
  readonly format: ImageFormatInfo;
}

export type SourceImageAdmissionResult =
  | { readonly ok: true; readonly value: AdmittedSourceImage }
  | {
      readonly ok: false;
      readonly code:
        | "invalid-byte-limit"
        | "source-image-too-large"
        | "unsupported-image-format";
      readonly message: string;
    };

export function admitSourceImage(
  bytes: Uint8Array,
  maxBytes: number,
): SourceImageAdmissionResult {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return {
      ok: false,
      code: "invalid-byte-limit",
      message: "Expected a positive safe-integer source-image byte limit.",
    };
  }

  if (bytes.byteLength > maxBytes) {
    return {
      ok: false,
      code: "source-image-too-large",
      message: "Source image exceeds the configured byte limit.",
    };
  }

  const format = detectImageFormat(bytes);
  if (format === undefined) {
    return {
      ok: false,
      code: "unsupported-image-format",
      message: "Source bytes are not a supported image format.",
    };
  }

  return {
    ok: true,
    value: {
      byteLength: bytes.byteLength,
      format,
    },
  };
}
