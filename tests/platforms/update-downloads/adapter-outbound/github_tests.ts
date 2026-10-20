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
//   - Personal release download integrity and fail-closed regression tests.
// - Must-Not:
//   - Download live releases, install apps, or use teacher data.
// - Allows:
//   - Inputs: Synthetic GitHub release digests and bounded byte streams.
//   - Outputs: Verified staged archives and explicit refusals.
//   - Side effects: Isolated disposable temporary directories only.
// - Split-When:
//   - A native installer needs independent transactional acceptance.
// - Merge-When:
//   - Personal and signed downloads share an authenticated transport.
// - Summary:
//   - Tests the GitHub SHA-256 personal release path without Apple IDs.
// - Description:
//   - Ensures failed hashes and redirects never publish archive files.
// - Usage:
//   - Run through the normal Node test suite.
// - Defaults:
//   - No real network and no installation side effects.
//
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadGithubAsset } from
  "../../../../src/platforms/update-downloads/adapter-outbound/github.ts";
import { releaseAssetUrl, releasePageUrl } from
  "../../../../src/ir/application-updates/contract/releases.ts";
import type { UpdateSelection } from
  "../../../../src/ir/application-updates/domain/select.ts";

const bytes = Buffer.from("synthetic personal Linux update archive");
const digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
const selected: Extract<UpdateSelection, { status: "available" }> = {
  status: "available", version: "26.4.1", tag: "v26.4.1",
  releaseUrl: releasePageUrl("v26.4.1"),
  asset: { id: 1, name: "linux-x64.tar.gz", size: bytes.length,
    state: "uploaded", digest,
    url: releaseAssetUrl("v26.4.1", "linux-x64.tar.gz") },
  verificationRequired: true, skippedTags: 0,
};
const fetchArchive = async (url: string, init: RequestInit) => {
  assert.equal(url, selected.asset.url);
  assert.equal(init.redirect, "manual");
  assert.equal(init.credentials, "omit");
  return new Response(bytes);
};
async function temporary(run: (directory: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "github-release-archive-"));
  try { await run(join(root, "downloads")); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("Linux GitHub SHA-256 stages exact bytes without Apple signing",
  async () => {
  await temporary(async directory => {
    const result = await downloadGithubAsset({ directory,
      selection: selected, target: "linux-x64", fetch: fetchArchive });
    assert.equal(result.status, "downloaded");
    if (result.status !== "downloaded") return;
    assert.deepEqual(await readFile(result.archivePath), bytes);
    assert.equal((await stat(result.archivePath)).mode & 0o777, 0o600);
    assert.equal(result.version, "26.4.1");
    assert.equal((await readdir(directory)).length, 1);
  });
});

test("missing or malformed GitHub digest never starts a download", async () => {
  await temporary(async directory => {
    let calls = 0;
    for (const hash of [undefined, "sha256:WRONG",
      "sha256:" + "A".repeat(64)]) {
      const result = await downloadGithubAsset({ directory,
        selection: { ...selected, asset: { ...selected.asset,
          digest: hash } }, target: "linux-x64",
        fetch: async () => { calls++; return new Response(bytes); },
      });
      assert.deepEqual(result, { status: "verification-failed",
        reason: "missing-digest" });
    }
    assert.equal(calls, 0);
    await assert.rejects(readdir(directory), { code: "ENOENT" });
  });
});

test("bad hash, length, wrong target and foreign redirect fail closed",
  async () => {
  await temporary(async directory => {
    for (const changed of [bytes.subarray(0, -1),
      Buffer.alloc(bytes.length)]) {
      const result = await downloadGithubAsset({ directory,
        selection: selected, target: "linux-x64",
        fetch: async () => new Response(changed),
      });
      assert.equal(result.status, "verification-failed");
      assert.deepEqual(await readdir(directory), []);
    }
    assert.deepEqual(await downloadGithubAsset({ directory,
      selection: selected, target: "darwin-arm64", fetch: fetchArchive }),
    { status: "verification-failed", reason: "release-mismatch" });
    const redirected = await downloadGithubAsset({ directory,
      selection: selected, target: "linux-x64",
      fetch: async () => new Response(null, { status: 302,
        headers: { Location: "https://other.invalid/foreign.zip" } }),
    });
    assert.deepEqual(redirected,
      { status: "download-failed", reason: "redirect" });
    assert.deepEqual(await readdir(directory), []);
  });
});
