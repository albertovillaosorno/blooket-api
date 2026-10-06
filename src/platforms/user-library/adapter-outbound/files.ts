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
//   - Bounded YAML library reads and atomic metadata persistence.
// - Must-Not:
//   - Choose image edits or accept arbitrary remote filesystem paths.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Bounded YAML library reads and atomic metadata persistence.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  writeAtomicFile,
  removeDurableFile,
  writeDurableFileIfAbsent,
} from "../../atomic-files/adapter-outbound/atomic-file.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";
import {
  decodeLibraryMetadata,
  safeRelativeImage,
  object,
  exact,
  type LibraryMetadata,
} from "../../../media/library-metadata/domain/metadata.ts";

import { withLegacyMediaVaultLock } from
  "../../media-vault-files/adapter-outbound/directory.ts";

interface YamlRuntime {
  parse(
    source: string,
    options: { maxAliasCount: number; uniqueKeys: boolean; schema: string },
  ): unknown;
  stringify(value: unknown, options: { lineWidth: number }): string;
}
async function yaml(): Promise<YamlRuntime> {
  return (await import(
    new URL(
      "../../../../.dependencies/pnpm/node_modules/yaml/dist/index.js",
      import.meta.url,
    ).href
  )) as YamlRuntime;
}
export async function safeLibraryPath(
  root: string,
  relative: string,
  create = false,
): Promise<string> {
  if (
    !relative ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("invalid-library-path");
  const base = await realpath(root);
  const path = resolve(base, relative);
  if (!path.startsWith(base + sep)) throw new Error("invalid-library-path");
  let current = base;
  for (const part of relative.split("/")) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("symbolic-library-path");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  if (create) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return path;
}
export async function initializeLibrary(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const folder of ["photos", "metadata", "renditions"])
    await mkdir(await safeLibraryPath(root, folder), {
      recursive: true,
      mode: 0o700,
    });
}
export function metadataPath(asset: string): string {
  return "metadata/" + asset.slice("photos/".length) + ".yaml";
}
export async function listLibrary(root: string): Promise<LibraryMetadata[]> {
  if (await exists(await safeLibraryPath(root, TRANSACTION_FILE)))
    throw new Error("library-recovery-required");
  const runtime = await yaml();
  const records: LibraryMetadata[] = [];
  const ids = new Set<string>();
  let visited = 0,
    metadataBytes = 0;
  async function walk(relative: string, depth = 0): Promise<void> {
    if (depth > 32) throw new Error("library-depth-limit");
    for await (const entry of await opendir(
      await safeLibraryPath(root, relative),
    )) {
      visited++;
      if (visited > 30_000) throw new Error("library-entry-limit");
      if (records.length >= 10_000) throw new Error("library-record-limit");
      if (entry.isSymbolicLink()) throw new Error("symbolic-library-path");
      const next = relative + "/" + entry.name;
      if (entry.isDirectory()) await walk(next, depth + 1);
      else if (entry.name.endsWith(".yaml")) {
        const path = await safeLibraryPath(root, next);
        const size = (await lstat(path)).size;
        metadataBytes += size;
        if (size > 100_000) throw new Error("metadata-too-large");
        if (metadataBytes > 32_000_000)
          throw new Error("library-metadata-byte-limit");
        const record = decodeLibraryMetadata(
          runtime.parse(await readFile(path, "utf8"), {
            maxAliasCount: 0,
            uniqueKeys: true,
            schema: "core",
          }),
        );
        if (metadataPath(record.asset) !== next || ids.has(record.id))
          throw new Error("metadata-identity-conflict");
        records.push(record);
        ids.add(record.id);
      }
    }
  }
  await walk("metadata");
  return records;
}
export async function saveMetadata(
  root: string,
  record: LibraryMetadata,
  create = false,
): Promise<void> {
  decodeLibraryMetadata(record);
  const source = (await yaml()).stringify(record, { lineWidth: 80 });
  const path = await safeLibraryPath(root, metadataPath(record.asset), true);
  if (create) {
    if ((await writeDurableFileIfAbsent(path, source)) !== "created")
      throw new Error("filename-already-exists");
  } else
    await writeAtomicFile(path, source, { backupPath: path + ".previous" });
}
export async function withLibraryLock<T>(
  root: string,
  work: () => Promise<T>,
): Promise<T> {
  const lock = await tryAcquireFileLock(
    await safeLibraryPath(root, ".library.lock"),
  );
  if (!lock.ok) throw new Error("library-busy");
  try {
    await recoverLibraryTransaction(root);
    return await work();
  } finally {
    await lock.lock.release();
  }
}
function isMissing(value: unknown): boolean {
  return value instanceof Error && "code" in value && value.code === "ENOENT";
}

const TRANSACTION_FILE = ".library-transaction.json";
export interface LibraryTransfer {
  readonly source: string;
  readonly digest: string;
  readonly bytes: number;
  readonly before: LibraryMetadata | null;
  readonly after: LibraryMetadata;
}
export interface LibraryTransaction {
  readonly version: 1;
  readonly kind: "migrate" | "rename";
  readonly indexDigest: string | null;
  readonly transfers: readonly LibraryTransfer[];
}

// The application holds .library.lock before planning or replaying a transfer.
export async function commitLibraryTransaction(
  root: string,
  candidate: LibraryTransaction,
  legacyLockHeld = false,
): Promise<void> {
  const transaction = decodeTransaction(candidate);
  const source = JSON.stringify(transaction) + "\n";
  if (Buffer.byteLength(source) > 32_000_000)
    throw new Error("library-transaction-too-large");
  if (
    (await writeDurableFileIfAbsent(
      await safeLibraryPath(root, TRANSACTION_FILE),
      source,
    )) !== "created"
  )
    throw new Error("library-recovery-required");
  await recoverLibraryTransaction(root, legacyLockHeld);
}
async function recoverLibraryTransaction(
  root: string,
  legacyLockHeld = false,
): Promise<void> {
  const journal = await safeLibraryPath(root, TRANSACTION_FILE);
  if (!(await exists(journal))) return;
  const transaction = decodeTransaction(
    JSON.parse((await boundedBytes(journal, 32_000_000)).toString("utf8")),
  );
  const replay = async () => {
    if (transaction.kind === "migrate") {
      const index = await safeLibraryPath(root, "media.jsonl");
      const archive = await safeLibraryPath(root, "media.jsonl.migrated");
      const existing = (await exists(index)) ? index : archive;
      if (
        digest(await boundedBytes(existing, 16_000_000)) !==
        transaction.indexDigest
      )
        throw new Error("legacy-index-changed");
    }
    for (const transfer of transaction.transfers) {
      const source = await safeLibraryPath(root, transfer.source);
      const target = await safeLibraryPath(root, transfer.after.asset, true);
      if (await exists(source)) {
        const bytes = await boundedBytes(source, 25_000_000);
        if (
          bytes.length !== transfer.bytes ||
          digest(bytes) !== transfer.digest
        )
          throw new Error("source-changed-during-transfer");
        await writeDurableFileIfAbsent(target, bytes);
      }
      const targetBytes = await boundedBytes(target, 25_000_000);
      if (
        targetBytes.length !== transfer.bytes ||
        digest(targetBytes) !== transfer.digest
      )
        throw new Error("transfer-destination-conflict");
      const metadata = await safeLibraryPath(
        root,
        metadataPath(transfer.after.asset),
        true,
      );
      if (await exists(metadata)) {
        const current = decodeLibraryMetadata(
          (await yaml()).parse(
            (await boundedBytes(metadata, 100_000)).toString("utf8"),
            { maxAliasCount: 0, uniqueKeys: true, schema: "core" },
          ),
        );
        if (JSON.stringify(current) !== JSON.stringify(transfer.after))
          throw new Error("transfer-metadata-conflict");
      } else await saveMetadata(root, transfer.after, true);
      if (transfer.before !== null) {
        const oldMetadata = await safeLibraryPath(
          root,
          metadataPath(transfer.before.asset),
        );
        if (await exists(oldMetadata)) {
          const current = decodeLibraryMetadata(
            (await yaml()).parse(
              (await boundedBytes(oldMetadata, 100_000)).toString("utf8"),
              { maxAliasCount: 0, uniqueKeys: true, schema: "core" },
            ),
          );
          if (JSON.stringify(current) !== JSON.stringify(transfer.before))
            throw new Error("transfer-metadata-conflict");
          await removeDurableFile(oldMetadata);
        }
        if (await exists(source)) await removeDurableFile(source);
      }
    }
    if (transaction.kind === "migrate") {
      const index = await safeLibraryPath(root, "media.jsonl");
      const archive = await safeLibraryPath(root, "media.jsonl.migrated");
      if (await exists(index)) {
        const bytes = await boundedBytes(index, 16_000_000);
        if (digest(bytes) !== transaction.indexDigest)
          throw new Error("legacy-index-changed");
        await writeDurableFileIfAbsent(archive, bytes);
        if (
          digest(await boundedBytes(archive, 16_000_000)) !==
          transaction.indexDigest
        )
          throw new Error("legacy-archive-conflict");
        await removeDurableFile(index);
      }
    }
    await removeDurableFile(journal);
  };
  if (transaction.kind === "migrate" && !legacyLockHeld)
    await withLegacyMediaVaultLock(root, replay);
  else await replay();
}
function decodeTransaction(value: unknown): LibraryTransaction {
  const transaction = object(value);
  exact(transaction, ["version", "kind", "indexDigest", "transfers"]);
  const kind = transaction["kind"];
  const indexDigest = transaction["indexDigest"];
  const transfers = transaction["transfers"];
  if (
    transaction["version"] !== 1 ||
    (kind !== "migrate" && kind !== "rename") ||
    (kind === "migrate"
      ? typeof indexDigest !== "string" || !/^[a-f0-9]{64}$/u.test(indexDigest)
      : indexDigest !== null) ||
    !Array.isArray(transfers) ||
    transfers.length > 10_000 ||
    (kind === "rename" && transfers.length !== 1)
  )
    throw new Error("invalid-library-transaction");
  const ids = new Set<string>(),
    assets = new Set<string>();
  let bytes = 0;
  for (const item of transfers) {
    const transfer = object(item);
    exact(transfer, ["source", "digest", "bytes", "before", "after"]);
    const after = decodeLibraryMetadata(transfer["after"]);
    const source = transfer["source"];
    const hash = transfer["digest"];
    const size = transfer["bytes"];
    if (
      typeof source !== "string" ||
      !safeRelativeImage(source) ||
      !safeRelativeImage(after.asset) ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(hash) ||
      typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > 25_000_000 ||
      ids.has(after.id) ||
      assets.has(after.asset)
    )
      throw new Error("invalid-library-transfer");
    if (kind === "rename") {
      const before = decodeLibraryMetadata(transfer["before"]);
      if (
        source !== before.asset ||
        source === after.asset ||
        before.id !== after.id ||
        after.revision !== before.revision + 1 ||
        JSON.stringify({
          ...before,
          asset: after.asset,
          revision: after.revision,
          prepared: null,
        }) !== JSON.stringify(after)
      )
        throw new Error("invalid-library-transfer");
    } else if (
      transfer["before"] !== null ||
      after.schemaVersion !== 2 ||
      after.legacy?.sourcePath !== source ||
      after.legacy.indexDigest !== indexDigest
    )
      throw new Error("invalid-library-transfer");
    bytes += size;
    if (bytes > 256_000_000) throw new Error("library-transfer-byte-limit");
    ids.add(after.id);
    assets.add(after.asset);
  }
  return value as LibraryTransaction;
}
export async function boundedBytes(path: string, limit: number) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new Error("invalid-or-oversized-library-file");
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error("library-file-changed");
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
