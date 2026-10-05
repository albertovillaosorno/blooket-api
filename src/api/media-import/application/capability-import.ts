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
//   - Capability-bound durable image import for external intake surfaces.
// - Must-Not:
//   - Accept target canvas/output limits directly or guess unknown evidence.
// - Allows:
//   - Inputs: Bytes, metadata, untrusted capabilities, and local safety limits.
//   - Outputs: Durable imports or exact policy/preparation/vault failures.
//   - Side effects: Native image work and transactional local vault writes.
// - Split-When:
//   - Distinct media targets require independently bound capability policies.
// - Merge-When:
//   - Durable image import no longer depends on verified target capabilities.
// - Summary:
//   - Keeps UI callers from selecting Blooket-facing rendition constraints.
// - Description:
//   - Resolves evidence-led policy before entering the shared import operation.
// - Usage:
//   - Use this operation from paste, drop, file, and extension intake adapters.
// - Defaults:
//   - English verification still defaults to false in the shared importer.
//
import {
  resolveImageImportPolicy,
  type LocalImageSafetyLimits,
  type ResolveImageImportPolicyResult,
} from "../../media-import-policy/application/resolve-policy.ts";
import {
  importImage,
  type ImportImageResult,
} from "./import-image.ts";

export interface CapabilityBoundImageImportRequest {
  readonly vaultDirectory: string;
  readonly id: string;
  readonly description: string;
  readonly english?: boolean;
  readonly bytes: Uint8Array;
  readonly capabilities: unknown;
  readonly localSafety: LocalImageSafetyLimits;
}

type PolicyFailure = Extract<
  ResolveImageImportPolicyResult,
  { readonly ok: false }
>;

export type CapabilityBoundImageImportResult =
  | ImportImageResult
  | {
      readonly ok: false;
      readonly stage: "policy";
      readonly code: PolicyFailure["code"];
    };

export async function importImageForCapabilities(
  request: CapabilityBoundImageImportRequest,
): Promise<CapabilityBoundImageImportResult> {
  const policy = resolveImageImportPolicy(
    request.capabilities,
    request.localSafety,
  );
  if (!policy.ok) {
    return {
      ok: false,
      stage: "policy",
      code: policy.code,
    };
  }

  return await importImage({
    vaultDirectory: request.vaultDirectory,
    id: request.id,
    description: request.description,
    ...(request.english === undefined
      ? {}
      : { english: request.english }),
    bytes: request.bytes,
    ...policy.value,
  });
}
