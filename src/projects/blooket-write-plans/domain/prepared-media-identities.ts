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
//   - Exact prepared-media identities for resumable write verification.
// - Must-Not:
//   - Store bytes, paths, URLs, credentials, or infer provider identity.
// - Allows:
//   - Inputs: Exact versioned media ID/revision/format/size/digest candidates.
//   - Outputs: Immutable validated media identity snapshots.
//   - Side effects: None.
// - Split-When:
//   - Providers require incompatible baseline families.
// - Merge-When:
//   - Write recovery no longer compares pre/post provider collections.
// - Summary:
//   - Binds current prepared bytes to bounded durable identity facts.
// - Description:
//   - Copies facts before asynchronous work; hashing does not grant trust.
// - Usage:
//   - Capture prepared byte identity and preserve it through recovery.
// - Defaults:
//   - Unknown fields, duplicate IDs, and malformed identities fail closed.
//
import { createHash } from "node:crypto";
import { decodeMediaId } from
  "../../../media/media-identifiers/domain/media-id.ts";
import { exactOwnData, isExactDenseArray } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";

export interface PreparedMediaIdentity {
  readonly mediaId: string;
  readonly revision: number;
  readonly format: "png" | "jpeg" | "gif";
  readonly byteLength: number;
  readonly sha256: string;
}
export interface PreparedMediaIdentities {
  readonly schemaVersion: 1;
  readonly items: readonly PreparedMediaIdentity[];
}

export function decodePreparedMediaIdentities(value: unknown):
  PreparedMediaIdentities | undefined {
  try {
    const envelope = exactOwnData(value, ["items", "schemaVersion"]);
    const list = envelope?.["items"];
    if (envelope?.["schemaVersion"] !== 1 || !isExactDenseArray(list) ||
        list.length > 10_000) return undefined;
    const items: PreparedMediaIdentity[] = [];
    const ids = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const slot = Object.getOwnPropertyDescriptor(list, String(i));
      if (!slot || !slot.enumerable || !Object.hasOwn(slot, "value"))
        return undefined;
      const candidate = exactOwnData(slot.value,
        ["byteLength", "format", "mediaId", "revision", "sha256"]);
      if (!candidate || typeof candidate["mediaId"] !== "string" ||
          !decodeMediaId(candidate["mediaId"]).ok ||
          ids.has(candidate["mediaId"]) ||
          typeof candidate["revision"] !== "number" ||
          !Number.isSafeInteger(candidate["revision"]) ||
          candidate["revision"] < 1 ||
          (candidate["format"] !== "png" && candidate["format"] !== "jpeg" &&
            candidate["format"] !== "gif") ||
          typeof candidate["byteLength"] !== "number" ||
          !Number.isSafeInteger(candidate["byteLength"]) ||
          candidate["byteLength"] < 1 || candidate["byteLength"] >= 2_500_000 ||
          typeof candidate["sha256"] !== "string" ||
          !/^[a-f0-9]{64}$/u.test(candidate["sha256"])) return undefined;
      ids.add(candidate["mediaId"]);
      items.push(Object.freeze({
        mediaId: candidate["mediaId"], revision: candidate["revision"],
        format: candidate["format"] as PreparedMediaIdentity["format"],
        byteLength: candidate["byteLength"], sha256: candidate["sha256"],
      }));
    }
    return Object.freeze({ schemaVersion: 1, items: Object.freeze(items) });
  } catch { return undefined; }
}

export function identifyPreparedMedia(value: {
  readonly mediaId: string; readonly revision: number;
  readonly format: "png" | "jpeg" | "gif"; readonly bytes: Uint8Array;
}): PreparedMediaIdentity | undefined {
  try {
    // The caller may be a typed-array subclass with an overridden iterator
    // or length accessor. Own metadata before hashing the native byte slots.
    const fields = Object.getOwnPropertyDescriptors(value);
    const data = (name: string) => {
      const descriptor = fields[name];
      return descriptor && Object.hasOwn(descriptor, "value") &&
        descriptor.enumerable ? descriptor.value : undefined;
    };
    const bytes: unknown = data("bytes");
    if (!(bytes instanceof Uint8Array)) return undefined;
    const getter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype), "byteLength",
    )?.get;
    const length: unknown = getter?.call(bytes);
    if (typeof length !== "number" || length < 1 ||
        length >= 2_500_000) return undefined;
    const owned = new Uint8Array(length);
    Uint8Array.prototype.set.call(owned, bytes);
    return decodePreparedMediaIdentities({ schemaVersion: 1, items: [{
      mediaId: data("mediaId"), revision: data("revision"),
      format: data("format"), byteLength: length,
      sha256: createHash("sha256").update(owned).digest("hex"),
    }] })?.items[0];
  } catch { return undefined; }
}

export function samePreparedMediaIdentity(left: PreparedMediaIdentity,
  right: PreparedMediaIdentity): boolean {
  const decodedLeft = decodePreparedMediaIdentities({
    schemaVersion: 1, items: [left],
  })?.items[0];
  const decodedRight = decodePreparedMediaIdentities({
    schemaVersion: 1, items: [right],
  })?.items[0];
  return !!decodedLeft && !!decodedRight &&
    decodedLeft.mediaId === decodedRight.mediaId &&
    decodedLeft.revision === decodedRight.revision &&
    decodedLeft.format === decodedRight.format &&
    decodedLeft.byteLength === decodedRight.byteLength &&
    decodedLeft.sha256 === decodedRight.sha256;
}
