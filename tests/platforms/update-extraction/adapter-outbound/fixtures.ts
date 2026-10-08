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
//   - Portable signed-ZIP staging regressions and owned fixtures.
// - Must-Not:
//   - Install, launch, consume secrets, or infer Apple trust.
// - Allows:
//   - Inputs: Ephemeral fixture keys and bounded synthetic ZIP records.
//   - Outputs: Bounded staging results still requiring Apple assessment.
//   - Side effects: Test-owned temporary files and native extraction doubles.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Native extraction no longer needs independent physical validation.
// - Summary:
//   - Portable signed-ZIP staging regressions and owned fixtures.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { publisherFingerprint, manifestSigningBytes } from
  "../../../../src/platforms/update-signatures/adapter-outbound/verify.ts";
import { RELEASE_REPOSITORY, releaseAssetUrl } from
  "../../../../src/ir/application-updates/contract/releases.ts";
import { UPDATE_BUNDLE_ID, type UpdateManifest } from
  "../../../../src/ir/update-manifests/contract/manifest.ts";
import { removeCreatedStage } from
  "../../../../src/platforms/update-extraction/adapter-outbound/files.ts";
import type { ArchiveExtractionCommand } from
  "../../../../src/platforms/update-extraction/adapter-outbound/stage.ts";

export interface ZipEntryFixture {
  readonly name: string;
  readonly data?: Buffer;
  readonly mode?: number;
  readonly localName?: string;
  readonly checksum?: number;
  readonly declaredSize?: number;
  readonly compressed?: boolean;
  readonly extra?: Buffer;
  readonly localExtra?: Buffer;
}
// A small stored/deflated ZIP producer is test data, never an updater parser.
// Both redundant headers are independently controllable for adversarial inputs.
export function zipBytes(entries: readonly ZipEntryFixture[]) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const localName = Buffer.from(entry.localName ?? entry.name);
    const bytes = entry.data ?? Buffer.alloc(0);
    const compressed = entry.compressed ? deflateRawSync(bytes) : bytes;
    const checksum = entry.checksum ?? crc32(bytes);
    const method = entry.compressed ? 8 : 0;
    const extra = entry.extra ?? Buffer.alloc(0);
    const localExtra = entry.localExtra ?? extra;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x5d48, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.declaredSize ?? bytes.length, 22);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0x5d48, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, localName, localExtra, compressed);
    centrals.push(central, name, extra);
    offset += local.length + localName.length + localExtra.length +
      compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export function baseEntries(): ZipEntryFixture[] {
  const prefix = "Blooket API.app/Contents/";
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(2, 12);
  return [
    { name: prefix + "Info.plist", data: Buffer.from("synthetic plist") },
    { name: prefix + "MacOS/Blooket API", mode: 0o100755,
      data: Buffer.from("synthetic native app") },
    { name: prefix + "Resources/runtime/node", mode: 0o100755, data: header },
  ];
}
const execute = promisify(execFile);
export const portableExtract: ArchiveExtractionCommand =
  async (file, args, signal) => {
    if (file !== "/usr/bin/ditto" || args[0] !== "-x" || args[1] !== "-k" ||
        args.length !== 4) throw new Error("unexpected-native-command");
    // Actual portable decompression stands in for the native command only.
    // No Apple signing, attributes, or macOS execution is inferred.
    await execute("unzip", ["-q", args[2]!, "-d", args[3]!], {
      signal, timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 4_096,
    });
  };

export async function fixture(entries = baseEntries()) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "update-extract-")));
  const archivePath = join(root, "darwin-arm64.zip");
  const bytes = zipBytes(entries);
  await writeFile(archivePath, bytes, { mode: 0o600 });
  const keys = generateKeyPairSync("ed25519");
  const manifest: UpdateManifest = { schemaVersion: 1,
    repository: RELEASE_REPOSITORY, bundleId: UPDATE_BUNDLE_ID,
    version: "26.4.1", tag: "v26.4.1", sourceCommit: "a".repeat(40),
    minimumMacos: "13.5", assets: [{ target: "darwin-arm64",
      name: "darwin-arm64.zip",
      url: releaseAssetUrl("v26.4.1", "darwin-arm64.zip"), size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") }],
  };
  const verification = {
    document: { schemaVersion: 1, algorithm: "ed25519",
      keyId: publisherFingerprint(keys.publicKey), manifest,
      signature: sign(null, manifestSigningBytes(manifest), keys.privateKey)
        .toString("base64url") },
    trustedKeys: [keys.publicKey],
    release: { version: manifest.version, tag: manifest.tag,
      target: "darwin-arm64" as const,
      asset: { id: 1, ...manifest.assets[0]!, state: "uploaded" as const } },
  };
  return { root, bytes, entries, options: { archivePath,
    directory: join(root, "updates"), verification,
    host: { platform: "darwin", architecture: "arm64" },
    execute: portableExtract }, cleanup: () => removeCreatedStage(root) };
}
