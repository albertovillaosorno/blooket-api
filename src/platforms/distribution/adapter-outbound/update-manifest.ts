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
//   - Signed public metadata production for a final ARM64 release archive.
// - Must-Not:
//   - Provision publisher keys, replace artifacts, publish, or install updates.
// - Allows:
//   - Inputs: A trusted artifact directory, source identity and publisher keys.
//   - Outputs: Public manifest creation or bounded failure reasons.
//   - Side effects: Reads one archive and exclusively creates its manifest.
// - Split-When:
//   - Another target gains a separately admitted release artifact.
// - Merge-When:
//   - Package assembly itself owns final publisher signing.
// - Summary:
//   - Binds signed metadata to the actual final archive bytes.
// - Description:
//   - Never signs caller-supplied archive hashes or overwrites prior metadata.
// - Usage:
//   - Run after final signing/notarization and exact-source CI validation.
// - Defaults:
//   - Missing publisher authority, changed archives and existing output stop.
//
import { createHash, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { MAX_UPDATE_ARCHIVE_BYTES, RELEASE_REPOSITORY, releaseAssetUrl } from
  "../../../ir/application-updates/contract/releases.ts";
import { UPDATE_BUNDLE_ID } from
  "../../../ir/update-manifests/contract/manifest.ts";
import { decodeReleasePackageIdentity } from
  "../../../ir/update-manifests/contract/package-identity.ts";
import { signUpdateManifest } from
  "../../update-signatures/adapter-outbound/sign.ts";
import { writeDurableFileIfAbsent } from
  "../../atomic-files/adapter-outbound/atomic-file.ts";
import { inspectUpdateArchive } from
  "../../update-extraction/adapter-outbound/inspect.ts";

export interface ReleaseManifestOptions {
  readonly directory: string;
  readonly version: string;
  readonly sourceCommit: string;
  readonly privateKey: KeyObject;
  readonly trustedKeys: readonly KeyObject[];
  readonly signal?: AbortSignal;
}
export type ReleaseManifestResult =
  | { readonly status: "signed"; readonly manifestPath: string;
      readonly keyId: string; readonly archiveSha256: string }
  | { readonly status: "manifest-failed";
      readonly reason: "storage" | "archive" | "signing" | "conflict" |
        "cancelled" | "timeout" };

export async function createSignedReleaseManifest(
  options: ReleaseManifestOptions,
): Promise<ReleaseManifestResult> {
  const fail = (reason: Extract<ReleaseManifestResult,
    { status: "manifest-failed" }>["reason"]): ReleaseManifestResult =>
    ({ status: "manifest-failed", reason });
  const directory = options.directory;
  if (!isAbsolute(directory) || resolve(directory) !== directory ||
      directory.length > 4_096 || /[\x00-\x1f\x7f]/u.test(directory))
    return fail("storage");
  const version = options.version, sourceCommit = options.sourceCommit;
  if (options.trustedKeys.length < 1 || options.trustedKeys.length > 8)
    return fail("signing");
  const privateKey = options.privateKey, trustedKeys = [...options.trustedKeys];
  if (options.signal?.aborted) return fail("cancelled");
  const deadline = AbortSignal.timeout(120_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline]) : deadline;
  const stopped = () => fail(deadline.aborted ? "timeout" : "cancelled");
  const archivePath = join(directory, "darwin-arm64.zip");
  const manifestPath = join(directory, "update-manifest.json");
  let archive;
  let reason: "storage" | "archive" = "storage";
  try {
    const parent = await lstat(directory, { bigint: true });
    if (!parent.isDirectory() || await realpath(directory) !== directory ||
        (parent.mode & 0o022n) !== 0n ||
        (process.getuid && parent.uid !== BigInt(process.getuid())))
      return fail("storage");
    reason = "archive";
    archive = await open(archivePath,
      constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await archive.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n ||
        before.size > BigInt(MAX_UPDATE_ARCHIVE_BYTES) ||
        await realpath(archivePath) !== archivePath) return fail("archive");
    const hash = createHash("sha256"), buffer = Buffer.alloc(65_536);
    let size = 0;
    for (;;) {
      if (signal.aborted) return stopped();
      const read = await archive.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
      if (size > MAX_UPDATE_ARCHIVE_BYTES) return fail("archive");
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    // The publisher signs only the admitted app ZIP layout, not any regular
    // file renamed to .zip. Native signing/notarization remains independent.
    const layout = await inspectUpdateArchive(archivePath, signal);
    const embeddedPath = "Blooket API.app/Contents/Resources/distribution.json";
    const record = layout.bundle.get(embeddedPath);
    if (record?.kind !== "file" || record.size > 65_536 || !record.hash)
      return fail("archive");
    const metadataPath = join(directory, "darwin-arm64", embeddedPath);
    if (await realpath(metadataPath) !== metadataPath) return fail("archive");
    const metadata = await open(metadataPath,
      constants.O_RDONLY | constants.O_NOFOLLOW);
    let identity;
    try {
      const information = await metadata.stat();
      if (!information.isFile() || information.size !== record.size)
        return fail("archive");
      const bytes = Buffer.alloc(record.size + 1);
      let count = 0;
      for (;;) {
        if (signal.aborted) return stopped();
        const part = await metadata.read(bytes, count,
          bytes.length - count, null);
        if (!part.bytesRead) break;
        count += part.bytesRead;
        if (count > record.size) return fail("archive");
      }
      if (count !== record.size || createHash("sha256")
          .update(bytes.subarray(0, count)).digest("hex") !== record.hash)
        return fail("archive");
      identity = decodeReleasePackageIdentity(JSON.parse(
        new TextDecoder("utf-8", { fatal: true })
          .decode(bytes.subarray(0, count)),
      ));
    } finally { await metadata.close(); }
    if (!identity.ok || identity.value.version !== version ||
        identity.value.sourceCommit !== sourceCommit) return fail("archive");
    const after = await archive.stat({ bigint: true });
    const path = await lstat(archivePath, { bigint: true });
    if (size !== Number(before.size) || !path.isFile() ||
        path.dev !== before.dev || path.ino !== before.ino ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs || path.size !== after.size ||
        path.mtimeNs !== after.mtimeNs || path.ctimeNs !== after.ctimeNs)
      return fail("archive");
    if (signal.aborted) return stopped();
    const archiveSha256 = hash.digest("hex");
    const signed = signUpdateManifest(JSON.stringify({
      schemaVersion: 1, repository: RELEASE_REPOSITORY,
      version, tag: "v" + version, sourceCommit, bundleId: UPDATE_BUNDLE_ID,
      minimumMacos: identity.value.minimumMacos,
      assets: [{ target: "darwin-arm64",
        name: "darwin-arm64.zip",
        url: releaseAssetUrl("v" + version, "darwin-arm64.zip"),
        size, sha256: archiveSha256 }],
    }), privateKey, trustedKeys);
    if (!signed.ok) return fail("signing");
    if (signal.aborted) return stopped();
    reason = "storage";
    const current = await lstat(directory, { bigint: true });
    if (!current.isDirectory() || current.dev !== parent.dev ||
        current.ino !== parent.ino || await realpath(directory) !== directory)
      return fail("storage");
    const created = await writeDurableFileIfAbsent(manifestPath,
      JSON.stringify(signed.document, null, 2) + "\n");
    if (created !== "created") return fail("conflict");
    return { status: "signed", manifestPath,
      keyId: signed.document.keyId, archiveSha256 };
  } catch { return signal.aborted ? stopped() : fail(reason); }
  finally {
    try { await archive?.close(); }
    catch { return fail("storage"); }
  }
}
