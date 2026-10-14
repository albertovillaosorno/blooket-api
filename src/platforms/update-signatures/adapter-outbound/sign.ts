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
//   - Release-only signing of exact canonical update manifests.
// - Must-Not:
//   - Generate trust roots, persist/export private keys, install, or publish.
// - Allows:
//   - Inputs: Bounded JSON and trusted local publisher key capabilities.
//   - Outputs: Public signed metadata or stable signing failures.
//   - Side effects: In-memory cryptographic signing only.
// - Split-When:
//   - Another publisher algorithm is explicitly admitted.
// - Merge-When:
//   - Release metadata no longer needs publisher signatures.
// - Summary:
//   - Signs only with an explicitly admitted Ed25519 publisher.
// - Description:
//   - Preserves the receiver's canonical bytes and independent Apple checks.
// - Usage:
//   - Use in trusted release composition after final archive validation.
// - Defaults:
//   - Missing trust roots and unsupported private keys refuse signing.
//
import { createPublicKey, sign, type KeyObject } from "node:crypto";
import { decodeUpdateManifest, decodeSignedUpdateManifest,
  type SignedUpdateManifest } from
  "../../../ir/update-manifests/contract/manifest.ts";
import { manifestSigningBytes, publisherFingerprint } from "./verify.ts";

export type ManifestSigningResult =
  | { readonly ok: true; readonly document: SignedUpdateManifest }
  | { readonly ok: false;
      readonly reason: "manifest" | "key" | "publisher" | "signature" };

// Plain JSON prevents a caller's object getters from executing during signing.
// Keys are local capabilities, never teacher commands or manifest fields.
export function signUpdateManifest(source: string, privateKey: KeyObject,
  trustedKeys: readonly KeyObject[]): ManifestSigningResult {
  let manifest;
  try {
    if (typeof source !== "string" || Buffer.byteLength(source) > 65_536)
      return { ok: false, reason: "manifest" };
    const decoded = decodeUpdateManifest(JSON.parse(source));
    if (!decoded.ok) return { ok: false, reason: "manifest" };
    manifest = decoded.value;
  } catch { return { ok: false, reason: "manifest" }; }
  let keyId: string;
  try {
    if (privateKey.type !== "private" ||
        privateKey.asymmetricKeyType !== "ed25519")
      return { ok: false, reason: "key" };
    if (trustedKeys.length < 1 || trustedKeys.length > 8)
      return { ok: false, reason: "publisher" };
    keyId = publisherFingerprint(createPublicKey(privateKey));
    if (!trustedKeys.some(key => key.type === "public" &&
        key.asymmetricKeyType === "ed25519" &&
        publisherFingerprint(key) === keyId))
      return { ok: false, reason: "publisher" };
  } catch { return { ok: false, reason: "key" }; }
  try {
    const decoded = decodeSignedUpdateManifest({
      schemaVersion: 1, algorithm: "ed25519", keyId, manifest,
      signature: sign(null, manifestSigningBytes(manifest), privateKey)
        .toString("base64url"),
    });
    return decoded.ok ? { ok: true, document: decoded.value }
      : { ok: false, reason: "signature" };
  } catch { return { ok: false, reason: "signature" }; }
}
