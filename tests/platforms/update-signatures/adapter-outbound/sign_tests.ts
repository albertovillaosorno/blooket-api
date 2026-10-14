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
//   - Publisher signing and receiver-compatibility regression checks.
// - Must-Not:
//   - Persist private keys, provision production trust, or publish releases.
// - Allows:
//   - Inputs: Ephemeral in-memory keys and fictional public manifests.
//   - Outputs: Signing, tampering, key-admission and secrecy assertions.
//   - Side effects: In-memory cryptographic operations only.
// - Split-When:
//   - Another admitted signing algorithm needs independent fixtures.
// - Merge-When:
//   - Publisher manifests no longer require signatures.
// - Summary:
//   - Verifies producer output through the existing receiver contract.
// - Description:
//   - Test keys never establish a production publisher.
// - Usage:
//   - Run with the ordinary repository test runner.
// - Defaults:
//   - Invalid publishers and malformed manifests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, createSecretKey } from "node:crypto";
import { signUpdateManifest } from
  "../../../../src/platforms/update-signatures/adapter-outbound/sign.ts";
import { verifySignedUpdateManifest } from
  "../../../../src/platforms/update-signatures/adapter-outbound/verify.ts";
import { RELEASE_REPOSITORY, releaseAssetUrl } from
  "../../../../src/ir/application-updates/contract/releases.ts";
import { UPDATE_BUNDLE_ID } from
  "../../../../src/ir/update-manifests/contract/manifest.ts";

const manifest = {
  schemaVersion: 1, repository: RELEASE_REPOSITORY, bundleId: UPDATE_BUNDLE_ID,
  version: "26.4.1", tag: "v26.4.1", sourceCommit: "a".repeat(40),
  minimumMacos: "13.5", assets: [{ target: "darwin-arm64",
    name: "darwin-arm64.zip",
    url: releaseAssetUrl("v26.4.1", "darwin-arm64.zip"),
    size: 10, sha256: "b".repeat(64) }],
};
const source = JSON.stringify(manifest);

test("release signatures verify independently without exporting private keys",
  () => {
    const keys = generateKeyPairSync("ed25519");
    const signed = signUpdateManifest(source, keys.privateKey,
      [keys.publicKey]);
    assert.ok(signed.ok);
    const result = verifySignedUpdateManifest({ document: signed.document,
      trustedKeys: [keys.publicKey], release: { version: "26.4.1",
        tag: "v26.4.1", target: "darwin-arm64",
        asset: { ...manifest.assets[0]!, id: 1, state: "uploaded" } },
    });
    assert.ok(result.ok);
    assert.equal(result.requiresAppleVerification, true);
    const privatePem = keys.privateKey.export({ format: "pem", type: "pkcs8" });
    assert.equal(JSON.stringify(signed.document).includes(String(privatePem)),
      false);
    const altered = { ...signed.document, manifest: {
      ...signed.document.manifest, sourceCommit: "c".repeat(40),
    } };
    assert.deepEqual(verifySignedUpdateManifest({ document: altered,
      trustedKeys: [keys.publicKey], release: { version: "26.4.1",
        tag: "v26.4.1", target: "darwin-arm64",
        asset: { ...manifest.assets[0]!, id: 1, state: "uploaded" } },
    }), { ok: false, reason: "invalid-signature" });
  });

test("signing cannot introduce its own publisher or use another algorithm",
  () => {
    const keys = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519");
    for (const roots of [[], [other.publicKey],
      Array(9).fill(keys.publicKey)]) {
      assert.deepEqual(signUpdateManifest(source, keys.privateKey, roots),
        { ok: false, reason: "publisher" });
    }
    for (const key of [keys.publicKey, createSecretKey(Buffer.alloc(16)),
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey]) {
      assert.deepEqual(signUpdateManifest(source, key, [keys.publicKey]),
        { ok: false, reason: "key" });
    }
    assert.equal(signUpdateManifest(source, keys.privateKey,
      [other.publicKey, keys.publicKey]).ok, true);
  });

test("only bounded exact manifest JSON can be signed", () => {
  const keys = generateKeyPairSync("ed25519");
  for (const candidate of ["{", "null", source.padEnd(65_537, " "),
    JSON.stringify({ ...manifest, extra: true }),
    JSON.stringify({ ...manifest, tag: "v26.4.2" }),
    JSON.stringify({ ...manifest, assets: [{ ...manifest.assets[0],
      url: "https://example.test/foreign.zip" }] })]) {
    assert.deepEqual(signUpdateManifest(candidate, keys.privateKey,
      [keys.publicKey]), { ok: false, reason: "manifest" });
  }
});
