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
//   - Capability-bound rendering and durable persistence of one static edit.
// - Must-Not:
//   - Accept caller-owned original bytes, rename stable IDs, or guess limits.
// - Allows:
//   - Inputs: Stable media ID, editor state, capabilities, and local ceilings.
//   - Outputs: Updated records or staged policy/source/render/vault failures.
//   - Side effects: Trusted reads, native rendering, transactional writes.
// - Split-When:
//   - Animated editor persistence gains independently reviewed semantics.
// - Merge-When:
//   - Import and edit share one application lifecycle.
// - Summary:
//   - Reopens immutable originals and persists edited static renditions safely.
// - Description:
//   - Changed descriptions lose prior English verification unless re-verified.
// - Usage:
//   - Desktop and extension editor surfaces call this shared operation.
// - Defaults:
//   - Editor names equal stable IDs until display names gain persistence.
//
import {
  resolveImageImportPolicy,
  type LocalImageSafetyLimits,
  type ResolveImageImportPolicyResult,
} from "../../media-import-policy/application/resolve-policy.ts";
import {
  createMediaRecord,
  type MediaRecord,
} from "../../../media/media-records/domain/media-record.ts";
import {
  admitSourceImage,
  type SourceImageAdmissionResult,
} from "../../../media/source-images/domain/source-image.ts";
import {
  renderEditedImageRendition,
  type EditorRenditionResult,
} from "../../../media/image-renditions/adapter-outbound/edit.ts";
import { type MediaEditorState } from
  "../../../media/editor-state/domain/editor-state.ts";
import {
  loadMediaVaultOriginal,
  updateMediaVaultAsset,
  type MediaVaultOriginalResult,
  type MediaVaultUpdateResult,
} from
  "../../../platforms/media-vault-files/adapter-outbound/directory.ts";
import { type ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";

export interface EditImageRequest {
  readonly vaultDirectory: string;
  readonly id: string;
  readonly state: MediaEditorState;
  readonly english?: boolean;
  readonly capabilities: unknown;
  readonly localSafety: LocalImageSafetyLimits;
  readonly blurSigma: number;
}

type PolicyFailure = Extract<
  ResolveImageImportPolicyResult,
  { readonly ok: false }
>;
type SourceFailure = Extract<
  SourceImageAdmissionResult,
  { readonly ok: false }
>;
type OriginalFailure = Extract<
  MediaVaultOriginalResult,
  { readonly ok: false }
>;
type RenditionFailure = Extract<
  EditorRenditionResult,
  { readonly ok: false }
>;
type VaultFailure = Extract<
  MediaVaultUpdateResult,
  { readonly ok: false }
>;

export type EditImageResult =
  | { readonly ok: true; readonly record: MediaRecord }
  | {
      readonly ok: false;
      readonly stage: "metadata";
      readonly code: "media-name-change-unsupported";
    }
  | {
      readonly ok: false;
      readonly stage: "metadata";
      readonly issues: readonly ValidationIssue[];
    }
  | (PolicyFailure & { readonly stage: "policy" })
  | (OriginalFailure & { readonly stage: "original" })
  | (SourceFailure & { readonly stage: "source" })
  | {
      readonly ok: false;
      readonly stage: "source";
      readonly code: "original-format-mismatch";
    }
  | (RenditionFailure & { readonly stage: "rendition" })
  | (VaultFailure & { readonly stage: "vault" });

export async function editImage(
  request: EditImageRequest,
): Promise<EditImageResult> {
  if (request.state.name !== request.id) {
    return {
      ok: false,
      stage: "metadata",
      code: "media-name-change-unsupported",
    };
  }

  const policy = resolveImageImportPolicy(
    request.capabilities,
    request.localSafety,
  );
  if (!policy.ok) {
    return { ...policy, stage: "policy" };
  }

  const original = await loadMediaVaultOriginal(
    request.vaultDirectory,
    request.id,
  );
  if (!original.ok) {
    return { ...original, stage: "original" };
  }

  const english = request.english
    ?? (
      request.state.description === original.record.description
        ? original.record.english
        : false
    );
  const record = createMediaRecord({
    id: original.record.id,
    path: original.record.path,
    description: request.state.description,
    english,
  });
  if (!record.ok) {
    return {
      ok: false,
      stage: "metadata",
      issues: record.issues,
    };
  }

  const admitted = admitSourceImage(
    original.bytes,
    policy.value.maxSourceBytes,
  );
  if (!admitted.ok) {
    return { ...admitted, stage: "source" };
  }
  if (admitted.value.format.format !== original.sourceFormat) {
    return {
      ok: false,
      stage: "source",
      code: "original-format-mismatch",
    };
  }

  const rendered = await renderEditedImageRendition(
    original.bytes,
    request.state,
    policy.value.canvas,
    policy.value.renditionLimits,
    { blurSigma: request.blurSigma },
  );
  if (!rendered.ok) {
    return { ...rendered, stage: "rendition" };
  }

  const persisted = await updateMediaVaultAsset(
    request.vaultDirectory,
    {
      expectedRecord: original.record,
      expectedRenditionSha256: original.renditionSha256,
      record: record.value,
      renditionFormat: rendered.value.format,
      renditionBytes: rendered.value.bytes,
    },
  );
  if (!persisted.ok) {
    return { ...persisted, stage: "vault" };
  }
  return { ok: true, record: persisted.record };
}
