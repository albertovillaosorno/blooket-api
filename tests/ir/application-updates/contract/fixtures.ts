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
//   - Exact local installation facts and admitted journal transitions.
// - Must-Not:
//   - Grant publisher trust, inspect files, launch apps, or install bundles.
// - Allows:
//   - Inputs: Unknown journal records and caller-selected next phases.
//   - Outputs: Exact decoded facts or bounded validation failures.
//   - Side effects: Ephemeral signing keys and synthetic journal values.
// - Split-When:
//   - Another installation target needs a distinct persistence contract.
// - Merge-When:
//   - Installation facts no longer need durable recovery.
// - Summary:
//   - Records intent and observation without inferring installed health.
// - Description:
//   - Paths and signed envelopes cannot grant filesystem or trust authority.
// - Usage:
//   - Reassess local publisher trust, ownership, and health before any action.
// - Defaults:
//   - Invalid or contradictory records cannot authorize recovery.
//
import { generateKeyPairSync, sign } from "node:crypto";
import { manifestSigningBytes, publisherFingerprint } from
  "../../../../src/platforms/update-signatures/adapter-outbound/verify.ts";
import { releaseAssetUrl, RELEASE_REPOSITORY } from
  "../../../../src/ir/application-updates/contract/releases.ts";
import { UPDATE_BUNDLE_ID, type UpdateManifest } from
  "../../../../src/ir/update-manifests/contract/manifest.ts";
import type { UpdateInstallationJournal } from
  "../../../../src/ir/application-updates/contract/installation.ts";

export function journalFixture(): UpdateInstallationJournal {
  const keys = generateKeyPairSync("ed25519");
  const manifest: UpdateManifest = { schemaVersion: 1,
    repository: RELEASE_REPOSITORY, bundleId: UPDATE_BUNDLE_ID,
    version: "26.4.1", tag: "v26.4.1", sourceCommit: "a".repeat(40),
    minimumMacos: "13.5", assets: [{ target: "darwin-arm64",
      name: "darwin-arm64.zip", size: 100, sha256: "a".repeat(64),
      url: releaseAssetUrl("v26.4.1", "darwin-arm64.zip") }] };
  const installationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  return { schemaVersion: 1, installationId, installedVersion: "26.4.0",
    document: { schemaVersion: 1, algorithm: "ed25519",
      keyId: publisherFingerprint(keys.publicKey), manifest,
      signature: sign(null, manifestSigningBytes(manifest), keys.privateKey)
        .toString("base64url") },
    installedPath: "/Applications/Blooket API.app",
    candidatePath: "/Applications/.blooket-api.update-" + installationId +
      "/Blooket API.app",
    installedIdentity: { device: "1", inode: "2" },
    candidateIdentity: { device: "1", inode: "3" }, phase: "prepared" };
}
