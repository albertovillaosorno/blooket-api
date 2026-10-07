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
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  manifestSigningBytes,
  publisherFingerprint,
  verifySignedUpdateManifest,
  verifyUpdateArchiveBytes,
} from "../../../../src/platforms/update-signatures/adapter-outbound/verify.ts";
import {
  decodeUpdateManifest,
  UPDATE_BUNDLE_ID,
} from "../../../../src/ir/update-manifests/contract/manifest.ts";
import {
  RELEASE_REPOSITORY,
  releaseAssetUrl,
} from "../../../../src/ir/application-updates/contract/releases.ts";

// Ephemeral test keys are not a publisher trust root or production credential.
function fixture() {
  const keys = generateKeyPairSync("ed25519");
  const bytes = Buffer.from("synthetic archive bytes");
  const decoded = decodeUpdateManifest({
    schemaVersion: 1,
    repository: RELEASE_REPOSITORY,
    bundleId: UPDATE_BUNDLE_ID,
    version: "26.4.1",
    tag: "v26.4.1",
    sourceCommit: "a".repeat(40),
    minimumMacos: "13.5",
    assets: ["darwin-arm64", "darwin-x64"].map((target) => ({
      target,
      name: target + ".zip",
      url: releaseAssetUrl("v26.4.1", target + ".zip"),
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
  });
  assert.ok(decoded.ok);
  const manifest = decoded.value;
  const document = {
    schemaVersion: 1,
    algorithm: "ed25519",
    keyId: publisherFingerprint(keys.publicKey),
    manifest,
    signature: sign(
      null,
      manifestSigningBytes(manifest),
      keys.privateKey,
    ).toString("base64url"),
  };
  const options = {
    document,
    trustedKeys: [keys.publicKey],
    release: {
      version: manifest.version,
      tag: manifest.tag,
      target: "darwin-arm64" as const,
      asset: { id: 1, ...manifest.assets[0]!, state: "uploaded" as const },
    },
  };
  return { options, keys, bytes };
}

test(
  "publisher signature binds both archives and preserves Apple trust boundary",
  () => {
  const { options, bytes } = fixture();
  const verified = verifySignedUpdateManifest(options);
  assert.ok(verified.ok);
  assert.equal(verified.requiresAppleVerification, true);
  assert.equal(verified.asset.target, "darwin-arm64");
  assert.deepEqual(verifyUpdateArchiveBytes(verified.asset, bytes), {
    ok: true,
  });
  const intel = verifySignedUpdateManifest({
    ...options,
    release: {
      ...options.release,
      target: "darwin-x64",
      asset: {
        id: 2,
        ...options.document.manifest.assets[1]!,
        state: "uploaded",
      },
    },
  });
  assert.ok(intel.ok);
  assert.equal(intel.asset.target, "darwin-x64");
});

test("signed fields and context resist tampering and reserialization", () => {
  const { options, keys } = fixture();
  const manifest = options.document.manifest;
  const reordered = {
    ...options.document,
    manifest: {
      ...manifest,
      assets: manifest.assets.toReversed(),
    },
  };
  assert.ok(verifySignedUpdateManifest({ ...options, document: reordered }).ok);
  for (const changed of [
    { ...manifest, sourceCommit: "b".repeat(40) },
    { ...manifest, minimumMacos: "14.0" },
    {
      ...manifest,
      assets: manifest.assets.map((asset) => ({
        ...asset,
        sha256: "b".repeat(64),
      })),
    },
  ])
    assert.deepEqual(
      verifySignedUpdateManifest({
        ...options,
        document: { ...options.document, manifest: changed },
      }),
      { ok: false, reason: "invalid-signature" },
    );
  const wrongContext = sign(
    null,
    Buffer.from(JSON.stringify(manifest)),
    keys.privateKey,
  ).toString("base64url");
  assert.deepEqual(
    verifySignedUpdateManifest({
      ...options,
      document: { ...options.document, signature: wrongContext },
    }),
    { ok: false, reason: "invalid-signature" },
  );
  const signature = options.document.signature;
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const noncanonical = signature.slice(0, -1) +
    alphabet[alphabet.indexOf(signature.at(-1)!) + 1];
  assert.deepEqual(
    verifySignedUpdateManifest({
      ...options,
      document: { ...options.document, signature: noncanonical },
    }),
    { ok: false, reason: "invalid-signature" },
  );
});

test(
  "remote keys never become trusted and retired keys stop authenticating",
  () => {
  const { options, keys } = fixture();
  const rotated = generateKeyPairSync("ed25519");
  for (const trustedKeys of [[], [rotated.publicKey], [keys.privateKey]])
    assert.deepEqual(verifySignedUpdateManifest({ ...options, trustedKeys }), {
      ok: false,
      reason: "unknown-publisher",
    });
  assert.ok(
    verifySignedUpdateManifest({
      ...options,
      trustedKeys: [rotated.publicKey, keys.publicKey],
    }).ok,
  );
  assert.deepEqual(
    verifySignedUpdateManifest({
      ...options,
      document: { ...options.document, publicKey: "provided remotely" },
    }),
    { ok: false, reason: "invalid-document" },
  );
});

test(
  "valid signatures must match the selected release and actual asset metadata",
  () => {
  const { options } = fixture();
  for (const change of [
    { version: "26.4.2" },
    { tag: "v26.4.2" },
    { asset: { ...options.release.asset, name: "other.zip" } },
    {
      asset: { ...options.release.asset, url: "https://example.test/file.zip" },
    },
    {
      asset: { ...options.release.asset, size: options.release.asset.size + 1 },
    },
  ])
    assert.deepEqual(
      verifySignedUpdateManifest({
        ...options,
        release: { ...options.release, ...change },
      }),
      { ok: false, reason: "release-mismatch" },
    );
});

test("archive verification rejects changed and interrupted bytes", () => {
  const { options, bytes } = fixture();
  const result = verifySignedUpdateManifest(options);
  assert.ok(result.ok);
  assert.deepEqual(verifyUpdateArchiveBytes(result.asset, bytes.subarray(1)), {
    ok: false,
    reason: "size-mismatch",
  });
  assert.deepEqual(verifyUpdateArchiveBytes({ ...result.asset, size: 0 },
    Buffer.alloc(0)), { ok: false, reason: "size-mismatch" });
  const changed = Buffer.from(bytes);
  changed[0] ^= 1;
  assert.deepEqual(verifyUpdateArchiveBytes(result.asset, changed), {
    ok: false,
    reason: "hash-mismatch",
  });
  assert.equal(bytes.toString(), "synthetic archive bytes");
});
