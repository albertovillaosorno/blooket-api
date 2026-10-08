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
//   - Bounded retrieval and authentication of signed update metadata.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Signed metadata, archive bytes, and admitted local public keys.
//   - Outputs: Verified metadata or bounded verification failures.
//   - Side effects: Network doubles and ephemeral fixture signing keys.
// - Split-When:
//   - Bundle replacement gains a separate transactional authority.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Authenticates fixed release metadata before any archive download.
// - Description:
//   - Rejects malformed metadata, foreign assets, and future releases.
// - Usage:
//   - Verify signed metadata before bounded streaming and final publication.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  fetchSignedUpdateManifest,
  UPDATE_MANIFEST_BYTES,
} from
  "../../../../src/platforms/update-downloads/adapter-outbound/manifest.ts";
import {
  decodeUpdateManifest, UPDATE_BUNDLE_ID,
} from "../../../../src/ir/update-manifests/contract/manifest.ts";
import { RELEASE_REPOSITORY, releaseAssetUrl } from
  "../../../../src/ir/application-updates/contract/releases.ts";
import { manifestSigningBytes, publisherFingerprint } from
  "../../../../src/platforms/update-signatures/adapter-outbound/verify.ts";
import { downloadSignedUpdate } from
  "../../../../src/platforms/update-downloads/adapter-outbound/download.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from("synthetic authenticated archive");
  const decoded = decodeUpdateManifest({
    schemaVersion: 1, repository: RELEASE_REPOSITORY,
    version: "26.4.1", tag: "v26.4.1", sourceCommit: "a".repeat(40),
    bundleId: UPDATE_BUNDLE_ID, minimumMacos: "13.5",
    assets: [{ target: "darwin-arm64", name: "darwin-arm64.zip",
      url: releaseAssetUrl("v26.4.1", "darwin-arm64.zip"), size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") }],
  });
  assert.ok(decoded.ok);
  const document = {
    schemaVersion: 1, algorithm: "ed25519",
    keyId: publisherFingerprint(publicKey), manifest: decoded.value,
    signature: sign(null, manifestSigningBytes(decoded.value), privateKey)
      .toString("base64url"),
  };
  const release = {
    version: "26.4.1", tag: "v26.4.1", target: "darwin-arm64" as const,
    asset: { id: 1, ...decoded.value.assets[0]!, state: "uploaded" as const },
  };
  return { document, release, trustedKeys: [publicKey], bytes };
}

test("public signed metadata authenticates before archive staging",
  async () => {
  const input = fixture();
  const result = await fetchSignedUpdateManifest({
    ...input, fetch: async (url, init) => {
      assert.equal(url, releaseAssetUrl("v26.4.1", "update-manifest.json"));
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "manual");
      assert.equal(init.referrerPolicy, "no-referrer");
      return new Response(JSON.stringify(input.document));
    },
  });
  assert.equal(result.status, "verified");
  if (result.status !== "verified") return;
  assert.equal(result.verification.requiresAppleVerification, true);
  const directory = await mkdtemp(join(tmpdir(), "manifest-staging-"));
  try {
    const staged = await downloadSignedUpdate({
      directory, verification: { ...input, document: result.document },
      fetch: async () => new Response(input.bytes),
    });
    assert.equal(staged.status, "downloaded");
    if (staged.status === "downloaded")
      assert.deepEqual(await readFile(staged.archivePath), input.bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("foreign or inconsistent release context performs no network requests",
  async () => {
    const input = fixture();
    const contexts = [
      { ...input.release, tag: "v26.4.2" },
      { ...input.release, version: "invalid" },
      { ...input.release, asset: { ...input.release.asset,
        url: "https://example.invalid/foreign.zip" } },
      { ...input.release, asset: { ...input.release.asset, size: 0 } },
    ];
    for (const release of contexts) {
      let calls = 0;
      assert.deepEqual(await fetchSignedUpdateManifest({
        ...input, release,
        fetch: async () => { calls++; return new Response(); },
      }), { status: "verification-failed", reason: "release-mismatch" });
      assert.equal(calls, 0);
    }
  });

test("missing local publisher keys never trust or contact remote metadata",
  async () => {
    const input = fixture();
    let calls = 0;
    assert.deepEqual(await fetchSignedUpdateManifest({
      ...input, trustedKeys: [],
      fetch: async () => { calls++; return new Response(); },
    }), { status: "verification-failed", reason: "unknown-publisher" });
    assert.equal(calls, 0);
  });

test("tampered and foreign-publisher manifests do not become verified",
  async () => {
    const input = fixture();
    const foreign = fixture();
    for (const [document, reason] of [
      [{ ...input.document, manifest: { ...input.document.manifest,
        minimumMacos: "14.0" } }, "invalid-signature"],
      [foreign.document, "unknown-publisher"],
      [{ ...input.document, extra: true }, "invalid-document"],
    ] as const) {
      assert.deepEqual(await fetchSignedUpdateManifest({
        ...input, fetch: async () => new Response(JSON.stringify(document)),
      }), { status: "verification-failed", reason });
    }
  });

test("manifest JSON and streamed byte limits release their response bodies",
  async () => {
    const input = fixture();
    for (const [response, reason] of [
      [new Response("{"), "json"],
      [new Response(new Uint8Array([0xff])), "json"],
      [new Response(new Uint8Array(UPDATE_MANIFEST_BYTES + 1)),
        "response-limit"],
    ] as const) {
      assert.deepEqual(await fetchSignedUpdateManifest({
        ...input, fetch: async () => response,
      }), { status: "manifest-failed", reason });
    }
    let cancelled = false;
    const response = new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { headers: { "Content-Length": String(UPDATE_MANIFEST_BYTES + 1) } });
    assert.deepEqual(await fetchSignedUpdateManifest({
      ...input, fetch: async () => response,
    }), { status: "manifest-failed", reason: "response-limit" });
    assert.equal(cancelled, true);
  });

test("manifest timeout bounds uncooperative fetch and response reads",
  async () => {
    const input = fixture();
    for (const fetch of [
      async () => new Promise<Response>(() => {}),
      async () => new Response(new ReadableStream({ start() {} })),
    ]) {
      assert.deepEqual(await fetchSignedUpdateManifest({
        ...input, fetch, timeoutMs: 20,
      }), { status: "manifest-failed", reason: "timeout" });
    }
  });

test("manifest requests admit the owned GitHub CDN and refuse foreign URLs",
  async () => {
    const input = fixture();
    let calls = 0;
    assert.equal((await fetchSignedUpdateManifest({
      ...input, fetch: async () => {
        if (++calls === 1) return new Response(null, { status: 302, headers: {
          Location: "https://release-assets.githubusercontent.com/manifest",
        } });
        return new Response(JSON.stringify(input.document));
      },
    })).status, "verified");
    assert.equal(calls, 2);
    calls = 0;
    assert.deepEqual(await fetchSignedUpdateManifest({
      ...input, fetch: async () => {
        calls++;
        return new Response(null, { status: 302, headers: {
          Location: "https://example.invalid/manifest",
        } });
      },
    }), { status: "manifest-failed", reason: "redirect" });
    assert.equal(calls, 1);
  });

test("HTTP and cancellation remain explicit failures rather than current",
  async () => {
    const input = fixture();
    assert.deepEqual(await fetchSignedUpdateManifest({
      ...input, fetch: async () => new Response(null, { status: 404 }),
    }), { status: "manifest-failed", reason: "http" });
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    assert.deepEqual(await fetchSignedUpdateManifest({
      ...input, signal: controller.signal,
      fetch: async () => { calls++; return new Response(); },
    }), { status: "manifest-failed", reason: "cancelled" });
    assert.equal(calls, 0);
  });


test("cancellation while discarding a redirect prevents the next request",
  async () => {
    const input = fixture();
    const controller = new AbortController();
    let calls = 0;
    const result = await fetchSignedUpdateManifest({
      ...input, signal: controller.signal,
      fetch: async () => {
        calls++;
        return new Response(new ReadableStream({
          cancel() { controller.abort(); },
        }), { status: 302, headers: {
          Location: "https://release-assets.githubusercontent.com/manifest",
        } });
      },
    });
    assert.deepEqual(result, {
      status: "manifest-failed", reason: "cancelled",
    });
    assert.equal(calls, 1);
  });
