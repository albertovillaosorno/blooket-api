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
//   - Fail-closed admission of prepared media referenced by one write
//     operation.
// - Must-Not:
//   - Read project paths, prepare images, upload, mutate, or infer media facts.
// - Allows:
//   - Inputs: One canonical operation and a prepared-media read port.
//   - Outputs: Ordered deduplicated prepared media or one stable refusal.
//   - Side effects: Bounded read-only stable-ID lookups through the supplied
//     port.
// - Split-When:
//   - Set/question media need independently versioned admission policies.
// - Merge-When:
//   - The browser write surface consumes prepared media directly.
// - Summary:
//   - Resolves current stable-ID media before any remote write can begin.
// - Description:
//   - Rechecks ID, revision, byte count, format, and the exclusive byte
//     ceiling.
// - Usage:
//   - Run after session/conflict admission and before journaling a media write.
// - Defaults:
//   - Port exceptions and malformed successful values fail closed.
//
import { decodeMediaId } from
  "../../../media/media-identifiers/domain/media-id.ts";
import { preparedMediaBytesAdmitted } from
  "../../../media/rendition-optimization/domain/limits.ts";
import type { BlooketWriteOperation } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type {
  BlooketPreparedMedia,
  BlooketPreparedMediaReadPort,
} from "../contract/prepared-media.ts";

import {
  decodePreparedMediaIdentities, identifyPreparedMedia,
  samePreparedMediaIdentity, type PreparedMediaIdentities,
} from
  "../../../projects/blooket-write-plans/domain/prepared-media-identities.ts";

export type AdmitBlooketPreparedMediaResult =
  | {
      readonly ok: true;
      readonly media: readonly BlooketPreparedMedia[];
    }
  | {
      readonly ok: false;
      readonly code:
        | "blooket-media-not-prepared"
        | "blooket-media-stale"
        | "blooket-media-invalid"
        | "blooket-media-unavailable";
      readonly mediaId: string;
    };

export async function admitBlooketPreparedMedia(
  operation: BlooketWriteOperation,
  media: BlooketPreparedMediaReadPort,
  expected?: PreparedMediaIdentities,
): Promise<AdmitBlooketPreparedMediaResult> {
  const required = operationMediaIds(operation);
  const snapshot = expected === undefined ? undefined
    : decodePreparedMediaIdentities(expected);
  if (expected !== undefined && snapshot === undefined)
    return { ok: false, code: "blooket-media-invalid",
      mediaId: required[0] ?? "snapshot" };
  if (snapshot && required.some(id =>
      !snapshot.items.some(item => item.mediaId === id)))
    return { ok: false, code: "blooket-media-stale",
      mediaId: required.find(id =>
        !snapshot.items.some(item => item.mediaId === id))! };
  const admitted: BlooketPreparedMedia[] = [];
  for (const mediaId of operationMediaIds(operation)) {
    let read: Awaited<ReturnType<BlooketPreparedMediaReadPort["read"]>>;
    try {
      read = await media.read(mediaId);
    } catch {
      return {
        ok: false,
        code: "blooket-media-unavailable",
        mediaId,
      };
    }
    if (!read.ok) {
      return { ...read, mediaId };
    }
    if (!validPreparedMedia(read.value, mediaId)) {
      return {
        ok: false,
        code: "blooket-media-invalid",
        mediaId,
      };
    }
    // The port can reuse its buffers while another stable-ID read awaits.
    // Own both bytes and scalar facts before yielding or opening a journal.
    const owned: BlooketPreparedMedia = Object.freeze({
      mediaId: read.value.mediaId, revision: read.value.revision,
      format: read.value.format, bytes: new Uint8Array(read.value.bytes),
    });
    if (!validPreparedMedia(owned, mediaId))
      return { ok: false, code: "blooket-media-invalid", mediaId };
    if (snapshot) {
      const expectedIdentity = snapshot.items.find(item =>
        item.mediaId === mediaId);
      const actual = identifyPreparedMedia(owned);
      if (!expectedIdentity || !actual ||
          !samePreparedMediaIdentity(actual, expectedIdentity))
        return { ok: false, code: "blooket-media-stale", mediaId };
    }
    admitted.push(owned);
  }
  return { ok: true, media: admitted };
}

export function blooketWriteOperationMediaIds(
  operation: BlooketWriteOperation,
): readonly string[] {
  return operationMediaIds(operation);
}

function operationMediaIds(
  operation: BlooketWriteOperation,
): readonly string[] {
  const candidates = operation.kind === "set"
    ? [operation.coverMediaId]
    : operation.question.type === "typing-answer"
      ? [operation.question.imageMediaId]
      : [
          operation.question.imageMediaId,
          ...operation.question.answers.map((answer) => answer.imageMediaId),
        ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    if (candidate === null || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

function validPreparedMedia(
  value: BlooketPreparedMedia,
  expectedMediaId: string,
): boolean {
  return (
    decodeMediaId(value.mediaId).ok
    && value.mediaId === expectedMediaId
    && Number.isSafeInteger(value.revision)
    && value.revision >= 1
    && (
      value.format === "gif"
      || value.format === "jpeg"
      || value.format === "png"
    )
    && value.bytes instanceof Uint8Array
    && preparedMediaBytesAdmitted(value.bytes.byteLength)
  );
}
