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
//   - Bounded download staging of publisher-authenticated update archives.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Signed metadata, archive bytes, and admitted local public keys.
//   - Outputs: Verified metadata or bounded verification failures.
//   - Side effects: Disposable files and deterministic download doubles.
// - Split-When:
//   - Bundle replacement gains a separate transactional authority.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Stages signed archives without granting installation authority.
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
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadSignedUpdate,
  type UpdateArchiveFetch,
} from
  "../../../../src/platforms/update-downloads/adapter-outbound/download.ts";
import {
  manifestSigningBytes,
  publisherFingerprint,
} from "../../../../src/platforms/update-signatures/adapter-outbound/verify.ts";
import {
  decodeUpdateManifest,
  UPDATE_BUNDLE_ID,
} from "../../../../src/ir/update-manifests/contract/manifest.ts";
import { RELEASE_REPOSITORY, releaseAssetUrl } from
  "../../../../src/ir/application-updates/contract/releases.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";

function fixture(target: "darwin-arm64" = "darwin-arm64") {
  const keys = generateKeyPairSync("ed25519");
  const bytes = Buffer.from("synthetic signed archive payload");
  const decoded = decodeUpdateManifest({
    schemaVersion: 1, repository: RELEASE_REPOSITORY,
    bundleId: UPDATE_BUNDLE_ID,
    version: "26.4.1", tag: "v26.4.1", sourceCommit: "a".repeat(40),
    minimumMacos: "13.5",
    assets: ["darwin-arm64"].map(target => ({
      target, name: target + ".zip",
      url: releaseAssetUrl("v26.4.1", target + ".zip"),
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
  });
  assert.ok(decoded.ok);
  const manifest = decoded.value;
  const asset = manifest.assets.find(asset => asset.target === target)!;
  const verification = {
    document: {
      schemaVersion: 1, algorithm: "ed25519",
      keyId: publisherFingerprint(keys.publicKey), manifest,
      signature: sign(null, manifestSigningBytes(manifest), keys.privateKey)
        .toString("base64url"),
    },
    trustedKeys: [keys.publicKey],
    release: {
      version: manifest.version, tag: manifest.tag, target,
      asset: { id: 1, ...asset, state: "uploaded" as const },
    },
  };
  return { bytes, verification };
}
async function temporary(action: (directory: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "signed-update-download-"));
  try { await action(join(root, "updates")); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function stream(...chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }));
}

test("signed streaming stages the ARM64 Mac archive", async () => {
  const target = "darwin-arm64";
  await temporary(async directory => {
    const { bytes, verification } = fixture(target);
        const result = await downloadSignedUpdate({
          directory, verification,
          fetch: async (url, init) => {
            assert.equal(url, verification.release.asset.url);
            assert.deepEqual(init.headers, {
              Accept: "application/octet-stream",
            });
            assert.equal(init.credentials, "omit");
            assert.equal(init.redirect, "manual");
            assert.equal(init.referrerPolicy, "no-referrer");
            return stream(bytes.subarray(0, 3), bytes.subarray(3));
          },
        });
        assert.equal(result.status, "downloaded");
        if (result.status !== "downloaded") return;
        assert.equal(result.requiresAppleVerification, true);
        assert.ok(result.archivePath.endsWith(target + ".zip"));
        assert.deepEqual(await readFile(result.archivePath), bytes);
        assert.equal((await stat(result.archivePath)).mode & 0o777, 0o600);
        assert.equal((await readdir(directory)).length, 1);
  });
});

test("unknown publisher prevents disk staging and any network request",
  async () => {
    await temporary(async directory => {
      const { verification } = fixture();
      let calls = 0;
      const result = await downloadSignedUpdate({
        directory, verification: { ...verification, trustedKeys: [] },
        fetch: async () => { calls++; return new Response(); },
      });
      assert.deepEqual(result, {
        status: "verification-failed", reason: "unknown-publisher",
      });
      assert.equal(calls, 0);
      await assert.rejects(stat(directory), { code: "ENOENT" });
    });
  });

test("size and hash mismatches remove every owned partial download",
  async () => {
    const { bytes, verification } = fixture();
    for (const [response, reason] of [
      [stream(bytes.subarray(0, bytes.length - 1)), "size-mismatch"],
      [stream(bytes, new Uint8Array([0])), "size-mismatch"],
      [stream(new Uint8Array(bytes.length)), "hash-mismatch"],
      [new Response(bytes, {
        headers: { "Content-Length": String(bytes.length + 1) },
      }), "size-mismatch"],
    ] as const)
      await temporary(async directory => {
        const result = await downloadSignedUpdate({
          directory, verification, fetch: async () => response,
        });
        assert.deepEqual(result, { status: "verification-failed", reason });
        assert.deepEqual(await readdir(directory), []);
      });
  });

test("GitHub CDN redirect is bounded and foreign destinations are refused",
  async () => {
    const { bytes, verification } = fixture();
    await temporary(async directory => {
      let calls = 0;
      const cdn = "https://release-assets.githubusercontent.com/synthetic.zip";
      const result = await downloadSignedUpdate({
        directory, verification,
        fetch: async (url) => {
          calls++;
          if (calls === 1)
            return new Response(null, {
              status: 302, headers: { Location: cdn },
            });
          assert.equal(url, cdn);
          return stream(bytes);
        },
      });
      assert.equal(result.status, "downloaded");
      assert.equal(calls, 2);
    });
    for (const location of [
      "http://release-assets.githubusercontent.com/file",
      "https://example.test/file",
      "https://127.0.0.1/file",
      "https://user:password@release-assets.githubusercontent.com/file",
      "https://release-assets.githubusercontent.com:8443/file",
    ]) await temporary(async directory => {
      let calls = 0;
      const result = await downloadSignedUpdate({
        directory, verification,
        fetch: async () => {
          calls++;
          return new Response(null, {
            status: 302, headers: { Location: location },
          });
        },
      });
      assert.deepEqual(result, {
        status: "download-failed", reason: "redirect",
      });
      assert.equal(calls, 1);
      assert.deepEqual(await readdir(directory), []);
    });
    await temporary(async directory => {
      let calls = 0;
      const result = await downloadSignedUpdate({
        directory, verification,
        fetch: async () => {
          calls++;
          return new Response(null, { status: 302, headers: {
            Location: "https://release-assets.githubusercontent.com/loop",
          } });
        },
      });
      assert.deepEqual(result, {
        status: "download-failed", reason: "redirect",
      });
      assert.equal(calls, 4);
    });
  });

test("timeouts bound both uncooperative fetch and interrupted response bodies",
  async () => {
    const { verification } = fixture();
    const fetchers: UpdateArchiveFetch[] = [
      async () => new Promise<Response>(() => {}),
      async () => new Response(new ReadableStream({ start() {} })),
    ];
    for (const fetch of fetchers) await temporary(async directory => {
      const result = await downloadSignedUpdate({
        directory, verification, fetch, timeoutMs: 25,
      });
      assert.deepEqual(result, {
        status: "download-failed", reason: "timeout",
      });
      assert.deepEqual(await readdir(directory), []);
    });
  });

test("cancellation and download ownership never steal another writer's lock",
  async () => {
    const { verification } = fixture();
    await temporary(async directory => {
      const acquired = await tryAcquireFileLock(
        join(directory, ".download.lock"),
      );
      assert.ok(acquired.ok);
      try {
        assert.deepEqual(
          await downloadSignedUpdate({ directory, verification }),
          { status: "download-failed", reason: "busy" });
        assert.equal((await readdir(directory)).length, 1);
      } finally { await acquired.lock.release(); }
      const controller = new AbortController();
      const result = await downloadSignedUpdate({
        directory, verification, signal: controller.signal,
        fetch: async () => {
          controller.abort();
          return stream(new Uint8Array([1]));
        },
      });
      assert.deepEqual(result, {
        status: "download-failed", reason: "cancelled",
      });
      assert.deepEqual(await readdir(directory), []);
    });
  });

test("HTTP failures are download errors rather than no-update success",
  async () => {
    const { verification } = fixture();
    await temporary(async directory => {
      assert.deepEqual(await downloadSignedUpdate({
        directory, verification,
        fetch: async () => new Response(null, { status: 503 }),
      }), { status: "download-failed", reason: "http" });
      assert.deepEqual(await readdir(directory), []);
    });
  });
