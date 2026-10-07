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
import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalUpdateManifest,
  decodeUpdateManifest,
  decodeSignedUpdateManifest,
  UPDATE_BUNDLE_ID,
} from "../../../../src/ir/update-manifests/contract/manifest.ts";
import {
  RELEASE_REPOSITORY,
  releaseAssetUrl,
  MAX_UPDATE_ARCHIVE_BYTES,
} from "../../../../src/ir/application-updates/contract/releases.ts";

const manifest = () => ({
  schemaVersion: 1,
  repository: RELEASE_REPOSITORY,
  version: "26.4.1",
  tag: "v26.4.1",
  sourceCommit: "a".repeat(40),
  bundleId: UPDATE_BUNDLE_ID,
  minimumMacos: "13.5",
  assets: ["darwin-arm64", "darwin-x64"].map((target) => ({
    target,
    name: target + ".zip",
    size: 1000,
    sha256: "a".repeat(64),
    url: releaseAssetUrl("v26.4.1", target + ".zip"),
  })),
});

test(
  "manifest canonicalization is independent of field and asset order", () => {
  const value = manifest();
  const first = decodeUpdateManifest(value);
  const reversed = decodeUpdateManifest(
    Object.fromEntries(
      Object.entries({
        ...value,
        assets: value.assets.toReversed(),
      }).toReversed(),
    ),
  );
  assert.ok(first.ok && reversed.ok);
  assert.equal(
    canonicalUpdateManifest(first.value),
    canonicalUpdateManifest(reversed.value),
  );
  value.assets[0]!.sha256 = "b".repeat(64);
  assert.equal(first.value.assets[0]!.sha256, "a".repeat(64));
});

test(
  "manifest rejects conflicting product, source, identity and OS metadata",
  () => {
  for (const invalid of [
    { schemaVersion: 2 },
    { schemaVersion: "1" },
    { repository: "other/repo" },
    { bundleId: "other.bundle" },
    { version: "2026.4.1" },
    { version: "26.5.1", tag: "v26.5.1" },
    { tag: "26.4.1" },
    { tag: "v26.4.2" },
    { sourceCommit: "b".repeat(39) },
    { sourceCommit: "A".repeat(40) },
    { root: "/some/user/data" },
    { minimumMacos: "13.4.9" },
    { minimumMacos: "13.05" },
    { minimumMacos: 14 },
    { minimumMacos: "13.5.x" },
  ])
    assert.equal(decodeUpdateManifest({ ...manifest(), ...invalid }).ok, false);
  for (const minimumMacos of ["13.5", "13.5.0", "13.6.2", "14.0"])
    assert.equal(
      decodeUpdateManifest({ ...manifest(), minimumMacos }).ok,
      true,
    );
});

test(
  "both exact Mac archives are required with bounded trusted-address hashes",
  () => {
  const value = manifest();
  for (const assets of [
    [],
    [value.assets[0]],
    [value.assets[0], value.assets[0]],
    [...value.assets, value.assets[0]],
  ])
    assert.equal(decodeUpdateManifest({ ...value, assets }).ok, false);
  for (const change of [
    { target: "linux-x64" },
    { name: "../darwin-arm64.zip" },
    { url: "https://example.test/file.zip" },
    { size: 0 },
    { size: 0.5 },
    { size: MAX_UPDATE_ARCHIVE_BYTES + 1 },
    { sha256: "A".repeat(64) },
    { sha256: "a".repeat(63) },
    { sha256: null },
    { installScript: "anything" },
  ]) {
    assert.equal(
      decodeUpdateManifest({
        ...value,
        assets: [{ ...value.assets[0], ...change }, value.assets[1]],
      }).ok,
      false,
    );
  }
});

test(
  "signature envelope admits one algorithm and cannot provide a public key",
  () => {
  const envelope = {
    schemaVersion: 1,
    algorithm: "ed25519",
    keyId: "a".repeat(64),
    signature: "A".repeat(86),
    manifest: manifest(),
  };
  assert.ok(decodeSignedUpdateManifest(envelope).ok);
  for (const invalid of [
    null,
    [],
    { ...envelope, publicKey: "attacker key" },
    { ...envelope, algorithm: "none" },
    { ...envelope, schemaVersion: 2 },
    { ...envelope, keyId: "a".repeat(63) },
    { ...envelope, signature: "A=" },
    { ...envelope, manifest: { ...manifest(), secret: "unexpected" } },
  ])
    assert.equal(decodeSignedUpdateManifest(invalid).ok, false);
  const nested = decodeSignedUpdateManifest({
    ...envelope,
    manifest: { ...manifest(), secret: "unexpected" },
  });
  assert.ok(!nested.ok);
  assert.equal(nested.issues[0]?.path, "$.manifest.secret");
});
