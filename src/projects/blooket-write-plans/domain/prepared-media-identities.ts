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
import { isRecord } from
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
  if (!isRecord(value) || Object.keys(value).sort().join() !==
      "items,schemaVersion" || value["schemaVersion"] !== 1 ||
      !Array.isArray(value["items"]) || value["items"].length > 10_000)
    return undefined;
  const items: PreparedMediaIdentity[] = [];
  const ids = new Set<string>();
  for (const candidate of value["items"]) {
    if (!isRecord(candidate) || Object.keys(candidate).sort().join() !==
        "byteLength,format,mediaId,revision,sha256" ||
        typeof candidate["mediaId"] !== "string" ||
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
      format: candidate["format"], byteLength: candidate["byteLength"],
      sha256: candidate["sha256"],
    }));
  }
  return Object.freeze({ schemaVersion: 1, items: Object.freeze(items) });
}

export function identifyPreparedMedia(value: {
  readonly mediaId: string; readonly revision: number;
  readonly format: "png" | "jpeg" | "gif"; readonly bytes: Uint8Array;
}): PreparedMediaIdentity | undefined {
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength < 1 ||
      value.bytes.byteLength >= 2_500_000) return undefined;
  return decodePreparedMediaIdentities({ schemaVersion: 1, items: [{
    mediaId: value.mediaId, revision: value.revision, format: value.format,
    byteLength: value.bytes.byteLength,
    sha256: createHash("sha256").update(value.bytes).digest("hex"),
  }] })?.items[0];
}

export function samePreparedMediaIdentity(left: PreparedMediaIdentity,
  right: PreparedMediaIdentity): boolean {
  return left.mediaId === right.mediaId && left.revision === right.revision &&
    left.format === right.format && left.byteLength === right.byteLength &&
    left.sha256 === right.sha256;
}
