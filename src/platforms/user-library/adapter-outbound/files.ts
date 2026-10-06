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
import { lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  writeAtomicFile,
  writeDurableFileIfAbsent,
} from "../../atomic-files/adapter-outbound/atomic-file.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";
import {
  decodeLibraryMetadata,
  type LibraryMetadata,
} from "../../../media/library-metadata/domain/metadata.ts";

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
  const runtime = await yaml();
  const records: LibraryMetadata[] = [];
  async function walk(relative: string): Promise<void> {
    for (const entry of await readdir(await safeLibraryPath(root, relative), {
      withFileTypes: true,
    })) {
      if (records.length >= 10_000) throw new Error("library-record-limit");
      if (entry.isSymbolicLink()) throw new Error("symbolic-library-path");
      const next = relative + "/" + entry.name;
      if (entry.isDirectory()) await walk(next);
      else if (entry.name.endsWith(".yaml")) {
        const path = await safeLibraryPath(root, next);
        if ((await lstat(path)).size > 100_000)
          throw new Error("metadata-too-large");
        const record = decodeLibraryMetadata(
          runtime.parse(await readFile(path, "utf8"), {
            maxAliasCount: 0,
            uniqueKeys: true,
            schema: "core",
          }),
        );
        if (
          metadataPath(record.asset) !== next ||
          records.some((m) => m.id === record.id)
        )
          throw new Error("metadata-identity-conflict");
        records.push(record);
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
    return await work();
  } finally {
    await lock.lock.release();
  }
}
function isMissing(value: unknown): boolean {
  return value instanceof Error && "code" in value && value.code === "ENOENT";
}
