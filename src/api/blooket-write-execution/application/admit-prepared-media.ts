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
  for (const mediaId of required) {
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
    let owned: BlooketPreparedMedia;
    try {
      const envelope = exactData(read, ["ok", "value"]) ??
        exactData(read, ["code", "ok"]);
      if (!envelope) return invalidMedia(mediaId);
      if (envelope["ok"] === false) {
        const code = envelope["code"];
        if (typeof code !== "string" ||
            (code !== "blooket-media-not-prepared" &&
             code !== "blooket-media-stale" &&
             code !== "blooket-media-invalid" &&
             code !== "blooket-media-unavailable"))
          return invalidMedia(mediaId);
        return { ok: false, code, mediaId };
      }
      if (envelope["ok"] !== true ||
          !Object.hasOwn(envelope, "value")) return invalidMedia(mediaId);
      const data = exactData(envelope["value"],
        ["bytes", "format", "mediaId", "revision"]);
      if (!data || !validPreparedMedia(data, mediaId))
        return invalidMedia(mediaId);
      // Copy from the built-in typed-array slots, not its inherited
      // iterator: an untrusted subclass cannot run custom code here.
      const input = data["bytes"] as Uint8Array;
      const byteCount = typedBytes(input);
      if (byteCount === undefined) return invalidMedia(mediaId);
      const copied = new Uint8Array(byteCount);
      Uint8Array.prototype.set.call(copied, input);
      owned = Object.freeze({
        mediaId: data["mediaId"] as string,
        revision: data["revision"] as number,
        format: data["format"] as "png" | "jpeg" | "gif",
        bytes: copied,
      });
      if (!validPreparedMedia(owned, mediaId))
        return invalidMedia(mediaId);
    } catch {
      return invalidMedia(mediaId);
    }
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

function invalidMedia(mediaId: string): AdmitBlooketPreparedMediaResult {
  return { ok: false, code: "blooket-media-invalid", mediaId };
}

function exactData(value: unknown, names: readonly string[]):
  Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key =>
      typeof key !== "string" || !names.includes(key))) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const owned: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor || !Object.hasOwn(descriptor, "value") ||
        !descriptor.enumerable) return undefined;
    Object.defineProperty(owned, name, {
      value: descriptor.value, enumerable: true, writable: true,
      configurable: true,
    });
  }
  return owned;
}

function typedBytes(value: Uint8Array): number | undefined {
  // Use the platform typed-array slot rather than a subclassed or own
  // byteLength accessor. Never invoke an untrusted media buffer getter.
  const getter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype), "byteLength",
  )?.get;
  const count = getter?.call(value);
  return typeof count === "number" ? count : undefined;
}

function validPreparedMedia(
  value: unknown,
  expectedMediaId: string,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const media = value as BlooketPreparedMedia;
  return (
    decodeMediaId(media.mediaId).ok
    && media.mediaId === expectedMediaId
    && Number.isSafeInteger(media.revision)
    && media.revision >= 1
    && (
      media.format === "gif"
      || media.format === "jpeg"
      || media.format === "png"
    )
    && media.bytes instanceof Uint8Array
    && preparedMediaBytesAdmitted(typedBytes(media.bytes) ?? 0)
  );
}
