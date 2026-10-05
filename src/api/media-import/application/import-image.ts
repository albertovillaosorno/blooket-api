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
//   - End-to-end preparation and durable import of one local image asset.
// - Must-Not:
//   - Invent Blooket limits, accept asset paths, or bypass vault locking.
// - Allows:
//   - Inputs: Trusted vault root, metadata, source bytes, and explicit limits.
//   - Outputs: One durable media record/original path or staged failures.
//   - Side effects: Native image work and transactional local vault writes.
// - Split-When:
//   - Batch import needs an independently resumable transaction contract.
// - Merge-When:
//   - Intake surfaces no longer share one durable image-import operation.
// - Summary:
//   - Composes metadata validation, preparation, layout, and vault publication.
// - Description:
//   - Ensures malformed metadata fails before native image processing.
// - Usage:
//   - Desktop, file, paste, drag/drop, and extension intake call this.
// - Defaults:
//   - New descriptions default English verification to false.
//
import {
  prepareImage,
  type PrepareImageResult,
  type PrepareImageRequest,
} from "../../media-preparation/application/prepare-image.ts";
import {
  createMediaRecord,
  type MediaRecord,
} from "../../../media/media-records/domain/media-record.ts";
import { mediaVaultPaths } from
  "../../../media/vault-layout/domain/layout.ts";
import {
  importMediaVaultAsset,
  type MediaVaultImportResult,
} from
  "../../../platforms/media-vault-files/adapter-outbound/directory.ts";
import { type ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";

export interface ImportImageRequest extends PrepareImageRequest {
  readonly vaultDirectory: string;
  readonly id: string;
  readonly description: string;
  readonly english?: boolean;
}

type PreparationFailure = Extract<
  PrepareImageResult,
  { readonly ok: false }
>;

type VaultFailure = Extract<
  MediaVaultImportResult,
  { readonly ok: false }
>;

export type ImportImageResult =
  | {
      readonly ok: true;
      readonly record: MediaRecord;
      readonly originalPath: string;
    }
  | PreparationFailure
  | {
      readonly ok: false;
      readonly stage: "metadata";
      readonly issues: readonly ValidationIssue[];
    }
  | (VaultFailure & {
      readonly stage: "vault";
    });

export async function importImage(
  request: ImportImageRequest,
): Promise<ImportImageResult> {
  const preliminaryPaths = mediaVaultPaths(
    request.id,
    "png",
    "png",
  );
  if (preliminaryPaths === undefined) {
    return metadataFailure(createMediaRecord({
      id: request.id,
      path: "media/invalid.png",
      description: request.description,
      ...(request.english === undefined
        ? {}
        : { english: request.english }),
    }));
  }

  const preliminaryRecord = createMediaRecord({
    id: request.id,
    path: preliminaryPaths.rendition,
    description: request.description,
    ...(request.english === undefined
      ? {}
      : { english: request.english }),
  });
  if (!preliminaryRecord.ok) {
    return { ok: false, stage: "metadata", issues: preliminaryRecord.issues };
  }

  const prepared = await prepareImage(request);
  if (!prepared.ok) {
    return prepared;
  }

  const paths = mediaVaultPaths(
    preliminaryRecord.value.id,
    prepared.value.source.format.format,
    prepared.value.rendition.format,
  );
  if (paths === undefined) {
    return {
      ok: false,
      stage: "metadata",
      issues: [{
        path: "$.id",
        code: "media-layout-invariant",
        message: "Validated media ID could not produce a vault path.",
      }],
    };
  }

  const record = createMediaRecord({
    ...preliminaryRecord.value,
    path: paths.rendition,
  });
  if (!record.ok) {
    return { ok: false, stage: "metadata", issues: record.issues };
  }

  const persisted = await importMediaVaultAsset(
    request.vaultDirectory,
    {
      record: record.value,
      sourceFormat: prepared.value.source.format.format,
      renditionFormat: prepared.value.rendition.format,
      originalBytes: request.bytes,
      renditionBytes: prepared.value.rendition.bytes,
    },
  );
  if (!persisted.ok) {
    return { ...persisted, stage: "vault" };
  }

  return {
    ok: true,
    record: persisted.record,
    originalPath: persisted.originalPath,
  };
}

function metadataFailure(
  result: ReturnType<typeof createMediaRecord>,
): ImportImageResult {
  if (!result.ok) {
    return { ok: false, stage: "metadata", issues: result.issues };
  }
  return {
    ok: false,
    stage: "metadata",
    issues: [{
      path: "$.id",
      code: "media-layout-invariant",
      message: "Invalid media ID unexpectedly passed record validation.",
    }],
  };
}
