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
  compareProductVersions,
  decodeProductVersion,
} from "../../product-version/contract/version.ts";
import {
  decodeUpdateRelease,
  MAX_RELEASES,
  type UpdateRelease,
  type UpdateAsset,
} from "../contract/releases.ts";

export const MAC_UPDATE_TARGET = "darwin-arm64" as const;
export const MAC_UPDATE_ARCHIVE = "darwin-arm64.zip" as const;
export const MAC_APPLICATION_BUNDLE = "Blooket API.app" as const;
export type MacUpdateTarget = typeof MAC_UPDATE_TARGET;
export type UpdateSelection =
  | { readonly status: "current"; readonly skippedTags: number }
  | {
      readonly status: "available";
      readonly version: string;
      readonly tag: string;
      readonly releaseUrl: string;
      readonly asset: UpdateAsset;
      readonly verificationRequired: true;
      readonly skippedTags: number;
    }
  | {
      readonly status: "incompatible-asset";
      readonly version: string;
      readonly reason: "missing" | "duplicate";
    }
  | { readonly status: "unsupported-platform" }
  | {
      readonly status: "untrusted-metadata";
      readonly reason: "malformed" | "future" | "duplicate" | "no-valid-tags";
    };

// Catalog entries remain unknown even when a caller bypasses the HTTP adapter.
export function selectPublicUpdate(
  entries: unknown,
  currentVersion: string,
  target: string,
  now: Date,
): UpdateSelection {
  const current = decodeProductVersion(currentVersion);
  if (!Number.isFinite(now.getTime())) throw new Error("invalid-update-clock");
  if (target !== MAC_UPDATE_TARGET)
    return { status: "unsupported-platform" };
  if (!Array.isArray(entries) || entries.length > MAX_RELEASES)
    return { status: "untrusted-metadata", reason: "malformed" };
  const final: UpdateRelease[] = [];
  const ids = new Set<number>();
  const tags = new Set<string>();
  let skippedTags = 0;
  let validTags = 0;
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
  for (const entry of entries) {
    const decoded = decodeUpdateRelease(entry);
    if (!decoded.ok)
      return { status: "untrusted-metadata", reason: "malformed" };
    const release = decoded.value;
    if (ids.has(release.id))
      return { status: "untrusted-metadata", reason: "duplicate" };
    ids.add(release.id);
    if (release.draft || release.prerelease) continue;
    let version;
    try {
      if (!release.tag.startsWith("v")) throw new Error("invalid-tag");
      version = decodeProductVersion(release.tag.slice(1));
    } catch {
      skippedTags++;
      continue;
    }
    if (tags.has(release.tag))
      return { status: "untrusted-metadata", reason: "duplicate" };
    tags.add(release.tag);
    validTags++;
    if (
      version.year > now.getUTCFullYear() ||
      (version.year === now.getUTCFullYear() &&
        version.quarter > currentQuarter) ||
      Date.parse(release.publishedAt!) > now.getTime() + 5 * 60_000
    )
      return { status: "untrusted-metadata", reason: "future" };
    if (compareProductVersions(version.version, current.version) > 0)
      final.push(release);
  }
  if (skippedTags > 0 && validTags === 0)
    return { status: "untrusted-metadata", reason: "no-valid-tags" };
  final.sort((a, b) => compareProductVersions(b.tag.slice(1), a.tag.slice(1)));
  const newest = final[0];
  if (!newest) return { status: "current", skippedTags };
  const version = newest.tag.slice(1);
  const matching = newest.assets.filter(
    (asset) => asset.name === MAC_UPDATE_ARCHIVE,
  );
  if (matching.length !== 1)
    return {
      status: "incompatible-asset",
      version,
      reason: matching.length === 0 ? "missing" : "duplicate",
    };
  return {
    status: "available",
    version,
    tag: newest.tag,
    releaseUrl: newest.url,
    asset: matching[0]!,
    verificationRequired: true,
    skippedTags,
  };
}
