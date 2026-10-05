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
//   - Fail-closed image import policy resolution from verified capabilities.
// - Must-Not:
//   - Guess Blooket limits or conflate local source safety with upload limits.
// - Allows:
//   - Inputs: Untrusted capability data and trusted local decoder ceilings.
//   - Outputs: Complete image-preparation policy or stable refusal codes.
//   - Side effects: None.
// - Split-When:
//   - Account-specific media targets require different upload policies.
// - Merge-When:
//   - Image preparation no longer distinguishes local and remote limits.
// - Summary:
//   - Binds rendition limits only from verified Blooket capability data.
// - Description:
//   - Keeps source limits local while target limits remain evidence-led.
// - Usage:
//   - Resolve before invoking the durable image-import application operation.
// - Defaults:
//   - Unknown Blooket limits fail closed and are never filled with constants.
//
import {
  decodeBlooketCapabilitySnapshot,
} from "../../../ir/capability-snapshots/contract/blooket-capabilities.ts";
import {
  type RenditionCanvas,
  type RenditionLimits,
} from "../../../media/image-renditions/adapter-outbound/sharp-rendition.ts";

export interface LocalImageSafetyLimits {
  readonly maxSourceBytes: number;
  readonly maxInputPixels: number;
}

export interface ResolvedImageImportPolicy {
  readonly maxSourceBytes: number;
  readonly canvas: RenditionCanvas;
  readonly renditionLimits: RenditionLimits;
}

export type ResolveImageImportPolicyResult =
  | {
      readonly ok: true;
      readonly value: ResolvedImageImportPolicy;
    }
  | {
      readonly ok: false;
      readonly code:
        | "invalid-capability-snapshot"
        | "invalid-local-image-limits"
        | "unverified-image-upload-limits";
    };

export function resolveImageImportPolicy(
  capabilities: unknown,
  local: LocalImageSafetyLimits,
): ResolveImageImportPolicyResult {
  if (
    !isPositiveSafeInteger(local.maxSourceBytes)
    || !isPositiveSafeInteger(local.maxInputPixels)
  ) {
    return { ok: false, code: "invalid-local-image-limits" };
  }

  const decoded = decodeBlooketCapabilitySnapshot(capabilities);
  if (!decoded.ok) {
    return { ok: false, code: "invalid-capability-snapshot" };
  }

  const upload = decoded.value.upload;
  if (
    upload.maxBytes === null
    || upload.canvasWidth === null
    || upload.canvasHeight === null
    || upload.maxPixels === null
  ) {
    return { ok: false, code: "unverified-image-upload-limits" };
  }

  return {
    ok: true,
    value: {
      maxSourceBytes: local.maxSourceBytes,
      canvas: {
        width: upload.canvasWidth,
        height: upload.canvasHeight,
      },
      renditionLimits: {
        maxInputPixels: local.maxInputPixels,
        maxOutputPixels: upload.maxPixels,
        maxOutputBytes: upload.maxBytes,
      },
    },
  };
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
