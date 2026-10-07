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
//   - Publisher-signature and archive-byte verification.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Signed metadata, archive bytes, and admitted local public keys.
//   - Outputs: Verified metadata or bounded verification failures.
//   - Side effects: None.
// - Split-When:
//   - Bundle replacement gains a separate transactional authority.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Authenticates manifests while keeping Apple validation independent.
// - Description:
//   - Rejects malformed metadata, foreign assets, and future releases.
// - Usage:
//   - Verify the manifest first, then size and SHA-256 of selected bytes.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import { createHash, verify, type KeyObject } from "node:crypto";
import {
  canonicalUpdateManifest,
  decodeSignedUpdateManifest,
  type UpdateManifest,
  type ManifestAsset,
} from "../../../ir/update-manifests/contract/manifest.ts";
import { MAX_UPDATE_ARCHIVE_BYTES, type UpdateAsset } from
  "../../../ir/application-updates/contract/releases.ts";
import type { MacUpdateTarget } from
  "../../../ir/application-updates/domain/select.ts";

export const MANIFEST_SIGNING_CONTEXT = "blooket-api:update-manifest:v1\n";
export type ManifestVerification =
  | {
      readonly ok: true;
      readonly manifest: UpdateManifest;
      readonly asset: ManifestAsset;
      readonly requiresAppleVerification: true;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid-document"
        | "unknown-publisher"
        | "invalid-signature"
        | "release-mismatch";
    };

// Keys come only from the admitted application publisher trust roots. An
// envelope may name a key but cannot introduce one, including during rotation.
export function publisherFingerprint(key: KeyObject): string {
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519")
    throw new Error("invalid-update-publisher-key");
  return createHash("sha256")
    .update(
      key.export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("hex");
}
export function manifestSigningBytes(manifest: UpdateManifest): Buffer {
  return Buffer.from(
    MANIFEST_SIGNING_CONTEXT + canonicalUpdateManifest(manifest),
  );
}

export function verifySignedUpdateManifest(options: {
  readonly document: unknown;
  readonly trustedKeys: readonly KeyObject[];
  readonly release: {
    readonly version: string;
    readonly tag: string;
    readonly target: MacUpdateTarget;
    readonly asset: UpdateAsset;
  };
}): ManifestVerification {
  const decoded = decodeSignedUpdateManifest(options.document);
  if (!decoded.ok) return { ok: false, reason: "invalid-document" };
  const envelope = decoded.value;
  if (options.trustedKeys.length > 8)
    return { ok: false, reason: "unknown-publisher" };
  let key: KeyObject | undefined;
  for (const candidate of options.trustedKeys) {
    try {
      if (publisherFingerprint(candidate) === envelope.keyId) key = candidate;
    } catch {
      /* An invalid local key never admits remote replacement. */
    }
  }
  if (!key) return { ok: false, reason: "unknown-publisher" };
  const signature = Buffer.from(envelope.signature, "base64url");
  if (
    signature.length !== 64 ||
    signature.toString("base64url") !== envelope.signature
  )
    return { ok: false, reason: "invalid-signature" };
  try {
    if (!verify(null, manifestSigningBytes(envelope.manifest), key, signature))
      return { ok: false, reason: "invalid-signature" };
  } catch {
    return { ok: false, reason: "invalid-signature" };
  }
  const manifest = envelope.manifest;
  const expected = options.release;
  const asset = manifest.assets.find(
    (entry) => entry.target === expected.target,
  );
  if (
    manifest.version !== expected.version ||
    manifest.tag !== expected.tag ||
    !asset ||
    asset.name !== expected.asset.name ||
    asset.url !== expected.asset.url ||
    asset.size !== expected.asset.size
  )
    return { ok: false, reason: "release-mismatch" };
  return { ok: true, manifest, asset, requiresAppleVerification: true };
}

// This verifies bounded bytes only. It neither extracts a ZIP nor substitutes
// for signature, Apple publisher identity, Gatekeeper, or notarization checks.
export function verifyUpdateArchiveBytes(
  asset: ManifestAsset,
  bytes: Uint8Array,
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "size-mismatch" | "hash-mismatch";
    } {
  if (
    !Number.isSafeInteger(asset.size) || asset.size < 1 ||
    asset.size > MAX_UPDATE_ARCHIVE_BYTES || bytes.byteLength !== asset.size
  )
    return { ok: false, reason: "size-mismatch" };
  const hash = createHash("sha256").update(bytes).digest("hex");
  return hash === asset.sha256
    ? { ok: true }
    : { ok: false, reason: "hash-mismatch" };
}
