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
//   - Normalized public release metadata and bounded update selection.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Unknown release candidates and explicit current host/version.
//   - Outputs: Exact decoded metadata and local update status.
//   - Side effects: None.
// - Split-When:
//   - Trusted manifests add an independent installation contract.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Selects final public candidates without claiming installation trust.
// - Description:
//   - Rejects malformed metadata, foreign assets, and future releases.
// - Usage:
//   - Decode adapter projections before selecting an update candidate.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import {
  isRecord,
  unknownFieldIssues,
} from "../../runtime-decoding/domain/exact-object.ts";
import {
  decodeFailure,
  type DecodeResult,
} from "../../runtime-decoding/domain/decode-result.ts";

export const RELEASE_REPOSITORY = "albertovillaosorno/blooket-api";
export const PUBLIC_RELEASES_URL =
  `https://github.com/${RELEASE_REPOSITORY}/releases`;
export const PUBLIC_RELEASES_API =
  `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases`;
export const MAX_RELEASES = 100;
export const MAX_RELEASE_ASSETS = 50;
export const MAX_UPDATE_ARCHIVE_BYTES = 500_000_000;

export interface UpdateAsset {
  readonly id: number;
  readonly name: string;
  readonly size: number;
  readonly state: "uploaded";
  readonly url: string;
}
export interface UpdateRelease {
  readonly schemaVersion: 1;
  readonly id: number;
  readonly tag: string;
  readonly url: string;
  readonly publishedAt: string | null;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly assets: readonly UpdateAsset[];
}
const RELEASE_KEYS = new Set([
  "schemaVersion",
  "id",
  "tag",
  "url",
  "publishedAt",
  "draft",
  "prerelease",
  "assets",
]);
const ASSET_KEYS = new Set(["id", "name", "size", "state", "url"]);
const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function releaseAssetUrl(tag: string, name: string): string {
  return (
    `${PUBLIC_RELEASES_URL}/download/${encodeURIComponent(tag)}/` +
    encodeURIComponent(name)
  );
}
export function releasePageUrl(tag: string): string {
  return `${PUBLIC_RELEASES_URL}/tag/${encodeURIComponent(tag)}`;
}

export function decodeUpdateRelease(
  value: unknown,
): DecodeResult<UpdateRelease> {
  const failure = () =>
    decodeFailure(
      "$",
      "invalid-update-metadata",
      "Public release metadata does not match the admitted contract.",
    );
  if (!isRecord(value)) return failure();
  const unknown = unknownFieldIssues(value, RELEASE_KEYS, "$");
  if (unknown.length) return { ok: false, issues: unknown };
  if (
    value["schemaVersion"] !== 1 ||
    !positiveInteger(value["id"]) ||
    typeof value["draft"] !== "boolean" ||
    typeof value["prerelease"] !== "boolean" ||
    typeof value["tag"] !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/u.test(value["tag"]) ||
    value["url"] !== releasePageUrl(value["tag"]) ||
    !Array.isArray(value["assets"]) ||
    value["assets"].length > MAX_RELEASE_ASSETS
  )
    return failure();
  const publishedAt = value["publishedAt"];
  if (publishedAt === null) {
    if (!value["draft"]) return failure();
  } else if (
    typeof publishedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(publishedAt) ||
    !Number.isFinite(Date.parse(publishedAt)) ||
    new Date(publishedAt).toISOString().replace(".000Z", "Z") !== publishedAt
  )
    return failure();
  const assets: UpdateAsset[] = [];
  const ids = new Set<number>();
  for (const asset of value["assets"]) {
    if (
      !isRecord(asset) ||
      unknownFieldIssues(asset, ASSET_KEYS, "$.assets").length ||
      !positiveInteger(asset["id"]) ||
      ids.has(asset["id"]) ||
      typeof asset["name"] !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(asset["name"]) ||
      !positiveInteger(asset["size"]) ||
      asset["size"] > MAX_UPDATE_ARCHIVE_BYTES ||
      asset["state"] !== "uploaded" ||
      asset["url"] !== releaseAssetUrl(value["tag"], asset["name"])
    )
      return failure();
    ids.add(asset["id"]);
    assets.push({
      id: asset["id"],
      name: asset["name"],
      size: asset["size"],
      state: "uploaded",
      url: asset["url"],
    });
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      id: value["id"],
      tag: value["tag"],
      url: value["url"],
      publishedAt,
      draft: value["draft"],
      prerelease: value["prerelease"],
      assets,
    },
  };
}
