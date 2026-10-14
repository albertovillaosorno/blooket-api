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
//   - Real-file release metadata production regressions.
// - Must-Not:
//   - Provision production keys, publish, or infer native Apple acceptance.
// - Allows:
//   - Inputs: Owned small synthetic ZIPs and ephemeral in-memory keys.
//   - Outputs: Signature/byte verification and preservation assertions.
//   - Side effects: Temporary files removed after each test.
// - Split-When:
//   - Release transport needs independent publication fixtures.
// - Merge-When:
//   - Distribution no longer produces signed metadata.
// - Summary:
//   - Proves actual archive bytes reach independently verified metadata.
// - Description:
//   - Existing artifacts and malformed ZIPs cannot be replaced or signed.
// - Usage:
//   - Run through the ordinary repository test runner.
// - Defaults:
//   - Missing authority, invalid archives and cancellation preserve files.
//
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile, open, mkdir } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSignedReleaseManifest } from
  "../../../../src/platforms/distribution/adapter-outbound/update-manifest.ts";
import { verifySignedUpdateManifest, verifyUpdateArchiveBytes } from
  "../../../../src/platforms/update-signatures/adapter-outbound/verify.ts";
import { MAX_UPDATE_ARCHIVE_BYTES } from
  "../../../../src/ir/application-updates/contract/releases.ts";
import { zipBytes, baseEntries } from
  "../../update-extraction/adapter-outbound/fixtures.ts";

const embedded = "Blooket API.app/Contents/Resources/distribution.json";
const distribution = { version: 1, productVersion: "26.4.1",
  target: "darwin-arm64", sourceRevision: "a".repeat(40), minimumMacOS: "13.5",
  signed: false, sourceDirty: false, artifacts: [{ name: "node",
    version: "24.21.0", sha256: "b".repeat(64), integrityScope: "archive" }],
};

async function fixture(work: (options: Parameters<
  typeof createSignedReleaseManifest>[0], bytes: Buffer) => Promise<void>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(),
    "release-manifest-")));
  const keys = generateKeyPairSync("ed25519");
  const metadata = Buffer.from(JSON.stringify(distribution));
  const bytes = zipBytes([...baseEntries(),
    { name: embedded, data: metadata }]);
  await writeFile(join(directory, "darwin-arm64.zip"), bytes);
  await mkdir(join(directory, "darwin-arm64", "Blooket API.app", "Contents",
    "Resources"), { recursive: true });
  await writeFile(join(directory, "darwin-arm64", embedded), metadata);
  try { await work({ directory, version: "26.4.1",
    sourceCommit: "a".repeat(40), privateKey: keys.privateKey,
    trustedKeys: [keys.publicKey] }, bytes); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("final archive metadata verifies through the actual update receiver",
  async () => { await fixture(async (options, bytes) => {
    const result = await createSignedReleaseManifest(options);
    assert.equal(result.status, "signed");
    const document = JSON.parse(await readFile(join(options.directory,
      "update-manifest.json"), "utf8"));
    const verified = verifySignedUpdateManifest({ document,
      trustedKeys: options.trustedKeys, release: { version: options.version,
        tag: "v" + options.version, target: "darwin-arm64",
        asset: { ...document.manifest.assets[0], id: 1, state: "uploaded" } },
    });
    assert.ok(verified.ok);
    assert.equal(verified.requiresAppleVerification, true);
    assert.deepEqual(verifyUpdateArchiveBytes(verified.asset, bytes),
      { ok: true });
    assert.deepEqual(verifyUpdateArchiveBytes(verified.asset,
      Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from("X")])),
    { ok: false, reason: "hash-mismatch" });
    assert.equal((await readFile(join(options.directory, "darwin-arm64.zip")))
      .equals(bytes), true);
    const source = await readFile(join(options.directory,
      "update-manifest.json"));
    assert.deepEqual(await createSignedReleaseManifest(options),
      { status: "manifest-failed", reason: "conflict" });
    assert.equal(source.equals(await readFile(join(options.directory,
      "update-manifest.json"))), true);
  }); });

test("missing trust and cancelled signing create no public artifact",
  async () => { await fixture(async options => {
    assert.deepEqual(await createSignedReleaseManifest({ ...options,
      trustedKeys: [] }), { status: "manifest-failed", reason: "signing" });
    assert.deepEqual(await createSignedReleaseManifest({ ...options,
      signal: AbortSignal.abort() }),
    { status: "manifest-failed", reason: "cancelled" });
    await assert.rejects(readFile(join(options.directory,
      "update-manifest.json")));
  }); });

test("invalid archives and aliases cannot receive publisher signatures",
  async () => { await fixture(async options => {
    const archive = join(options.directory, "darwin-arm64.zip");
    await writeFile(archive, "not an app ZIP");
    assert.deepEqual(await createSignedReleaseManifest(options),
      { status: "manifest-failed", reason: "archive" });
    await rm(archive);
    const target = join(options.directory, "original.zip");
    await writeFile(target, zipBytes(baseEntries()));
    await symlink(target, archive);
    assert.deepEqual(await createSignedReleaseManifest(options),
      { status: "manifest-failed", reason: "archive" });
    await rm(archive);
    const file = await open(archive, "wx");
    try { await file.truncate(MAX_UPDATE_ARCHIVE_BYTES + 1); }
    finally { await file.close(); }
    assert.deepEqual(await createSignedReleaseManifest(options),
      { status: "manifest-failed", reason: "archive" });
    await assert.rejects(readFile(join(options.directory,
      "update-manifest.json")));
  }); });

test("pre-existing public output remains unchanged on publication conflict",
  async () => { await fixture(async options => {
    const output = join(options.directory, "update-manifest.json");
    await writeFile(output, "owned existing release metadata");
    assert.deepEqual(await createSignedReleaseManifest(options),
      { status: "manifest-failed", reason: "conflict" });
    assert.equal(await readFile(output, "utf8"),
      "owned existing release metadata");
  }); });

test("source identity must match the actual embedded package metadata",
  async () => { await fixture(async options => {
    for (const changed of [{ version: "26.4.2" },
      { sourceCommit: "c".repeat(40) }]) {
      assert.deepEqual(await createSignedReleaseManifest({ ...options,
        ...changed }), { status: "manifest-failed", reason: "archive" });
    }
    const metadata = join(options.directory, "darwin-arm64", embedded);
    await writeFile(metadata, JSON.stringify({ ...distribution,
      sourceRevision: "c".repeat(40) }));
    assert.deepEqual(await createSignedReleaseManifest(options),
      { status: "manifest-failed", reason: "archive" });
    await assert.rejects(readFile(join(options.directory,
      "update-manifest.json")));
  }); });

test("dirty and foreign builds cannot produce release metadata",
  async () => { await fixture(async options => {
    for (const changed of [{ sourceDirty: true }, { target: "linux-x64" },
      { minimumMacOS: "13.4" }, { extra: true }]) {
      const metadata = Buffer.from(JSON.stringify({ ...distribution,
        ...changed }));
      await writeFile(join(options.directory, "darwin-arm64", embedded),
        metadata);
      await writeFile(join(options.directory, "darwin-arm64.zip"),
        zipBytes([...baseEntries(), { name: embedded, data: metadata }]));
      assert.deepEqual(await createSignedReleaseManifest(options),
        { status: "manifest-failed", reason: "archive" });
    }
    await assert.rejects(readFile(join(options.directory,
      "update-manifest.json")));
  }); });
