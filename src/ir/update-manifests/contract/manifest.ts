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
//   - Exact signed update-manifest data and canonical signing representation.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Untrusted manifest values.
//   - Outputs: Exact validated manifests and canonical JSON.
//   - Side effects: None.
// - Split-When:
//   - Bundle replacement gains a separate transactional authority.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Defines publisher-signed archive metadata without installation authority.
// - Description:
//   - Rejects malformed metadata, foreign assets, and future releases.
// - Usage:
//   - Validate manifest data before signature and archive verification.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import { decodeProductVersion } from
  "../../product-version/contract/version.ts";
import {
  isRecord,
  unknownFieldIssues,
} from "../../runtime-decoding/domain/exact-object.ts";
import {
  decodeFailure,
  type DecodeResult,
} from "../../runtime-decoding/domain/decode-result.ts";
import {
  RELEASE_REPOSITORY,
  MAX_UPDATE_ARCHIVE_BYTES,
  releaseAssetUrl,
} from "../../application-updates/contract/releases.ts";
import type { MacUpdateTarget } from
  "../../application-updates/domain/select.ts";

export const UPDATE_BUNDLE_ID = "com.albertovilla.blooket-studio";
export interface ManifestAsset {
  readonly target: MacUpdateTarget;
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}
export interface UpdateManifest {
  readonly schemaVersion: 1;
  readonly repository: typeof RELEASE_REPOSITORY;
  readonly version: string;
  readonly tag: string;
  readonly sourceCommit: string;
  readonly bundleId: typeof UPDATE_BUNDLE_ID;
  readonly minimumMacos: string;
  readonly assets: readonly ManifestAsset[];
}
const KEYS = new Set([
  "schemaVersion",
  "repository",
  "version",
  "tag",
  "sourceCommit",
  "bundleId",
  "minimumMacos",
  "assets",
]);
const ASSET_KEYS = new Set(["target", "name", "url", "size", "sha256"]);

export function decodeUpdateManifest(
  value: unknown,
): DecodeResult<UpdateManifest> {
  const failure = () =>
    decodeFailure(
      "$",
      "invalid-update-manifest",
      "The update manifest does not match the admitted archive contract.",
    );
  if (!isRecord(value)) return failure();
  const unknown = unknownFieldIssues(value, KEYS, "$");
  if (unknown.length) return { ok: false, issues: unknown };
  if (
    value["schemaVersion"] !== 1 ||
    value["repository"] !== RELEASE_REPOSITORY ||
    value["bundleId"] !== UPDATE_BUNDLE_ID ||
    typeof value["version"] !== "string" ||
    value["tag"] !== "v" + value["version"] ||
    typeof value["sourceCommit"] !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value["sourceCommit"]) ||
    typeof value["minimumMacos"] !== "string" ||
    !/^(?:1[3-9]|[2-9][0-9])\.(?:0|[1-9][0-9]?)(?:\.(?:0|[1-9][0-9]?))?$/u.test(
      value["minimumMacos"],
    ) ||
    !Array.isArray(value["assets"]) ||
    value["assets"].length !== 2
  )
    return failure();
  try {
    decodeProductVersion(value["version"]);
  } catch {
    return failure();
  }
  const [major, minor] = value["minimumMacos"].split(".").map(Number);
  if (major === 13 && minor! < 5) return failure();
  const assets: ManifestAsset[] = [];
  const targets = new Set<string>();
  for (const [index, entry] of value["assets"].entries()) {
    if (!isRecord(entry)) return failure();
    const extra = unknownFieldIssues(entry, ASSET_KEYS, `$.assets[${index}]`);
    if (extra.length) return { ok: false, issues: extra };
    const target = entry["target"];
    if (
      (target !== "darwin-arm64" && target !== "darwin-x64") ||
      targets.has(target) ||
      entry["name"] !== target + ".zip" ||
      entry["url"] !==
        releaseAssetUrl(value["tag"] as string, target + ".zip") ||
      typeof entry["size"] !== "number" ||
      !Number.isSafeInteger(entry["size"]) ||
      entry["size"] < 1 ||
      entry["size"] > MAX_UPDATE_ARCHIVE_BYTES ||
      typeof entry["sha256"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry["sha256"])
    )
      return failure();
    targets.add(target);
    assets.push({
      target,
      name: target + ".zip",
      url: entry["url"] as string,
      size: entry["size"],
      sha256: entry["sha256"],
    });
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      repository: RELEASE_REPOSITORY,
      version: value["version"],
      tag: value["tag"] as string,
      sourceCommit: value["sourceCommit"],
      bundleId: UPDATE_BUNDLE_ID,
      minimumMacos: value["minimumMacos"],
      assets,
    },
  };
}

// Signing fixes field and target order independently of JSON layout.
// Callers must decode the manifest before using its canonical representation.
export function canonicalUpdateManifest(value: UpdateManifest): string {
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    repository: value.repository,
    version: value.version,
    tag: value.tag,
    sourceCommit: value.sourceCommit,
    bundleId: value.bundleId,
    minimumMacos: value.minimumMacos,
    assets: [...value.assets]
      .sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
      .map((asset) => ({
        target: asset.target,
        name: asset.name,
        url: asset.url,
        size: asset.size,
        sha256: asset.sha256,
      })),
  });
}

export interface SignedUpdateManifest {
  readonly schemaVersion: 1;
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly signature: string;
  readonly manifest: UpdateManifest;
}
const SIGNED_KEYS = new Set([
  "schemaVersion",
  "algorithm",
  "keyId",
  "signature",
  "manifest",
]);
export function decodeSignedUpdateManifest(
  value: unknown,
): DecodeResult<SignedUpdateManifest> {
  const failure = () =>
    decodeFailure(
      "$",
      "invalid-signed-update-manifest",
      "The signed manifest envelope does not match the admitted contract.",
    );
  if (!isRecord(value)) return failure();
  const unknown = unknownFieldIssues(value, SIGNED_KEYS, "$");
  if (unknown.length) return { ok: false, issues: unknown };
  if (
    value["schemaVersion"] !== 1 ||
    value["algorithm"] !== "ed25519" ||
    typeof value["keyId"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value["keyId"]) ||
    typeof value["signature"] !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/u.test(value["signature"])
  )
    return failure();
  const manifest = decodeUpdateManifest(value["manifest"]);
  if (!manifest.ok)
    return {
      ok: false,
      issues: manifest.issues.map((issue) => ({
        ...issue,
        path: "$.manifest" + issue.path.slice(1),
      })),
    };
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      algorithm: "ed25519",
      keyId: value["keyId"],
      signature: value["signature"],
      manifest: manifest.value,
    },
  };
}
