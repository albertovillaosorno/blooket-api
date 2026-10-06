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
//   - One shared source-image preparation flow for local intake surfaces.
// - Must-Not:
//   - Persist vault state, choose Blooket limits, or accept arbitrary paths.
// - Allows:
//   - Inputs: Untrusted bytes plus explicit source/rendition limits and canvas.
//   - Outputs: Validated source facts plus a bounded working rendition.
//   - Side effects: Native image decoding and rendition work.
// - Split-When:
//   - Durable vault import requires a transactional application operation.
// - Merge-When:
//   - Intake preparation is no longer independently callable.
// - Summary:
//   - Composes byte admission and image rendition into one reusable operation.
// - Description:
//   - Gives desktop, extension, and future HTTP intake one semantic path.
// - Usage:
//   - Prepare bytes before immutable original and metadata publication.
// - Defaults:
//   - No product dimensions or upload ceilings are guessed here.
//
import {
  type ImageRendition,
  type ImageRenditionResult,
  type RenditionCanvas,
  type RenditionLimits,
} from "../../../media/image-renditions/adapter-outbound/sharp-rendition.ts";
import {
  admitSourceImage,
  type AdmittedSourceImage,
  type SourceImageAdmissionResult,
} from "../../../media/source-images/domain/source-image.ts";

import { renderEditorIsolated } from
  "../../../platforms/native-media/adapter-outbound/process.ts";

export interface PrepareImageRequest {
  readonly bytes: Uint8Array;
  readonly maxSourceBytes: number;
  readonly canvas: RenditionCanvas;
  readonly renditionLimits: RenditionLimits;
}

export interface PreparedImage {
  readonly source: AdmittedSourceImage;
  readonly rendition: ImageRendition;
}

type SourceFailure = Extract<
  SourceImageAdmissionResult,
  { readonly ok: false }
>;

type RenditionFailure = Extract<ImageRenditionResult, { readonly ok: false }>;

export type PrepareImageResult =
  | { readonly ok: true; readonly value: PreparedImage }
  | {
      readonly ok: false;
      readonly stage: "source";
      readonly code: SourceFailure["code"];
    }
  | {
      readonly ok: false;
      readonly stage: "rendition";
      readonly code: RenditionFailure["code"];
      readonly sourceCode?: NonNullable<RenditionFailure["sourceCode"]>;
    };

export async function prepareImage(
  request: PrepareImageRequest,
): Promise<PrepareImageResult> {
  const admitted = admitSourceImage(request.bytes, request.maxSourceBytes);
  if (!admitted.ok) {
    return {
      ok: false,
      stage: "source",
      code: admitted.code,
    };
  }

  const result = await renderEditorIsolated(
    request.bytes,
    {
      name: "",
      description: "",
      regions: [],
      transform: { panX: 0, panY: 0, zoom: 1, contrast: 1, saturation: 1 },
    },
    request.canvas,
    request.renditionLimits,
    { blurSigma: 20 },
  );
  const rendered =
    !result.ok && result.code === "invalid-editor-rendition"
      ? { ok: false as const, code: "invalid-rendition-limits" }
      : !result.ok && result.code === "editor-animation-unsupported"
        ? { ok: false as const, code: "animated-rendition-unsupported" }
        : result;
  if (!rendered.ok) {
    return {
      ok: false,
      stage: "rendition",
      code: rendered.code,
      ...(!("sourceCode" in rendered) || rendered.sourceCode === undefined
        ? {}
        : { sourceCode: rendered.sourceCode }),
    };
  }

  return {
    ok: true,
    value: {
      source: admitted.value,
      rendition: rendered.value,
    },
  };
}
