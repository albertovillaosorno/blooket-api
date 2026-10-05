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
//   - Durable media-vault loading, import publication, and crash recovery.
// - Must-Not:
//   - Decode images, choose product limits, or accept arbitrary asset paths.
// - Allows:
//   - Inputs: Trusted vault roots, records, formats, and prepared bytes.
//   - Outputs: Loaded records, durable imports, or stable failures.
//   - Side effects: Vault locks, staging files, hard links, index replacement.
// - Split-When:
//   - Host filesystem semantics require a non-POSIX vault implementation.
// - Merge-When:
//   - Media persistence no longer spans binary assets and shared metadata.
// - Summary:
//   - Publishes assets before metadata with inode-proven interrupted rollback.
// - Description:
//   - Keeps transaction staging links until media.jsonl becomes durable.
// - Usage:
//   - Call after image preparation and media-record validation.
// - Defaults:
//   - Originals are immutable; the index retains one previous-value backup.
//
import { randomUUID } from "node:crypto";
import {
  lstat,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  decodeMediaJsonLines,
  serializeMediaJsonLines,
} from "../../../media/media-index/domain/json-lines.ts";
import {
  decodeMediaRecord,
  type MediaRecord,
} from "../../../media/media-records/domain/media-record.ts";
import {
  mediaVaultPaths,
  type RenditionImageFormat,
} from "../../../media/vault-layout/domain/layout.ts";
import { type ImageFormat } from
  "../../../media/image-formats/domain/image-format.ts";
import {
  linkDurableFileIfAbsent,
  removeDurableFile,
  writeAtomicFile,
  writeDurableFileIfAbsent,
} from "../../atomic-files/adapter-outbound/atomic-file.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";

const INDEX_FILE = "media.jsonl";
const INDEX_BACKUP = "media.jsonl.bak";
const IMPORT_MARKER = ".blooket-api-media-import.json";
const VAULT_LOCK = ".blooket-api-media-vault.lock";
const UUID = new RegExp(
  "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-"
    + "[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
  "u",
);

export interface MediaVaultImport {
  readonly record: MediaRecord;
  readonly sourceFormat: ImageFormat;
  readonly renditionFormat: RenditionImageFormat;
  readonly originalBytes: Uint8Array;
  readonly renditionBytes: Uint8Array;
}

export type MediaVaultIoCode =
  | "media-vault-locked"
  | "media-vault-unsafe"
  | "media-vault-unreadable"
  | "media-vault-write-failed"
  | "media-vault-recovery-failed"
  | "media-vault-lock-failed";

export type MediaVaultInvalidCode =
  | "media-import-invalid"
  | "media-record-invalid"
  | "media-path-mismatch"
  | "media-index-invalid";

export type MediaVaultConflictCode =
  | "media-id-conflict"
  | "media-path-conflict"
  | "media-asset-conflict";

export type MediaVaultLoadResult =
  | {
      readonly ok: true;
      readonly records: readonly MediaRecord[];
    }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code: MediaVaultIoCode;
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly code: "media-index-invalid";
    };

export type MediaVaultImportResult =
  | {
      readonly ok: true;
      readonly record: MediaRecord;
      readonly originalPath: string;
    }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code: MediaVaultIoCode;
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly code: MediaVaultInvalidCode;
    }
  | {
      readonly ok: false;
      readonly kind: "conflict";
      readonly code: MediaVaultConflictCode;
    };

interface ImportMarker {
  readonly version: 1;
  readonly id: string;
  readonly description: string;
  readonly english: boolean;
  readonly sourceFormat: ImageFormat;
  readonly renditionFormat: RenditionImageFormat;
  readonly token: string;
}

type RecoveryOutcome = "none" | "committed" | "rolled-back" | "failed";

type IndexReadResult =
  | {
      readonly kind: "records";
      readonly records: readonly MediaRecord[];
    }
  | { readonly kind: "invalid" }
  | { readonly kind: "unsafe" }
  | { readonly kind: "unreadable" };

type FileState =
  | {
      readonly kind: "file";
      readonly dev: number;
      readonly ino: number;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "unsafe" };

export async function loadMediaVault(
  directory: string,
): Promise<MediaVaultLoadResult> {
  const root = await safeDirectoryState(directory);
  if (root === "unsafe") {
    return ioFailure("media-vault-unsafe");
  }
  if (root === "missing") {
    return { ok: true, records: [] };
  }

  const acquired = await tryAcquireFileLock(join(directory, VAULT_LOCK));
  if (!acquired.ok) {
    return ioFailure(lockFailureCode(acquired.reason));
  }

  let result: MediaVaultLoadResult;
  try {
    result = await loadMediaVaultLocked(directory);
  } catch {
    result = ioFailure("media-vault-unreadable");
  }

  try {
    await acquired.lock.release();
  } catch {
    return ioFailure("media-vault-lock-failed");
  }
  return result;
}

export async function importMediaVaultAsset(
  directory: string,
  input: MediaVaultImport,
): Promise<MediaVaultImportResult> {
  if (
    !isImageFormat(input.sourceFormat)
    || !isRenditionFormat(input.renditionFormat)
    || !(input.originalBytes instanceof Uint8Array)
    || !(input.renditionBytes instanceof Uint8Array)
  ) {
    return invalidFailure("media-import-invalid");
  }

  const validated = decodeMediaRecord(input.record);
  if (!validated.ok) {
    return invalidFailure("media-record-invalid");
  }
  const paths = mediaVaultPaths(
    validated.value.id,
    input.sourceFormat,
    input.renditionFormat,
  );
  if (paths === undefined || validated.value.path !== paths.rendition) {
    return invalidFailure("media-path-mismatch");
  }
  if (
    input.originalBytes.byteLength === 0
    || input.renditionBytes.byteLength === 0
  ) {
    return invalidFailure("media-record-invalid");
  }

  if (await safeDirectoryState(directory) === "unsafe") {
    return ioFailure("media-vault-unsafe");
  }

  const acquired = await tryAcquireFileLock(join(directory, VAULT_LOCK));
  if (!acquired.ok) {
    return ioFailure(lockFailureCode(acquired.reason));
  }

  let result: MediaVaultImportResult;
  try {
    result = await importMediaVaultAssetLocked(
      directory,
      { ...input, record: validated.value },
    );
  } catch {
    result = ioFailure("media-vault-write-failed");
  }

  try {
    await acquired.lock.release();
  } catch {
    return ioFailure("media-vault-lock-failed");
  }
  return result;
}

async function loadMediaVaultLocked(
  directory: string,
): Promise<MediaVaultLoadResult> {
  if (!await safeVaultDirectories(directory)) {
    return ioFailure("media-vault-unsafe");
  }

  const recovery = await recoverInterruptedImport(directory);
  if (recovery === "failed") {
    return ioFailure("media-vault-recovery-failed");
  }

  const index = await readIndex(directory);
  if (index.kind === "unsafe") {
    return ioFailure("media-vault-unsafe");
  }
  if (index.kind === "unreadable") {
    return ioFailure("media-vault-unreadable");
  }
  if (index.kind === "invalid") {
    return invalidFailure("media-index-invalid");
  }
  return { ok: true, records: index.records };
}

async function importMediaVaultAssetLocked(
  directory: string,
  input: MediaVaultImport,
): Promise<MediaVaultImportResult> {
  if (!await safeVaultDirectories(directory)) {
    return ioFailure("media-vault-unsafe");
  }
  if (!await isOwnedRegularOrMissing(join(directory, INDEX_BACKUP))) {
    return ioFailure("media-vault-unsafe");
  }

  const recovery = await recoverInterruptedImport(directory);
  if (recovery === "failed") {
    return ioFailure("media-vault-recovery-failed");
  }

  const index = await readIndex(directory);
  if (index.kind === "unsafe") {
    return ioFailure("media-vault-unsafe");
  }
  if (index.kind === "unreadable") {
    return ioFailure("media-vault-unreadable");
  }
  if (index.kind === "invalid") {
    return invalidFailure("media-index-invalid");
  }

  if (index.records.some((record) => record.id === input.record.id)) {
    return conflictFailure("media-id-conflict");
  }
  if (index.records.some((record) => record.path === input.record.path)) {
    return conflictFailure("media-path-conflict");
  }

  const relativePaths = mediaVaultPaths(
    input.record.id,
    input.sourceFormat,
    input.renditionFormat,
  );
  if (relativePaths === undefined) {
    return invalidFailure("media-record-invalid");
  }
  const marker = createImportMarker(input);
  const paths = transactionPaths(directory, marker);
  const candidateStates = await Promise.all([
    fileState(paths.original),
    fileState(paths.rendition),
    fileState(paths.originalStage),
    fileState(paths.renditionStage),
  ]);
  if (candidateStates.some((state) => state.kind === "unsafe")) {
    return ioFailure("media-vault-unsafe");
  }
  if (candidateStates.some((state) => state.kind === "file")) {
    return conflictFailure("media-asset-conflict");
  }

  try {
    await writeAtomicFile(
      join(directory, IMPORT_MARKER),
      JSON.stringify(marker) + "\n",
    );
    await expectCreated(
      paths.originalStage,
      input.originalBytes,
    );
    await expectCreated(
      paths.renditionStage,
      input.renditionBytes,
    );

    if (
      await linkDurableFileIfAbsent(
        paths.originalStage,
        paths.original,
      ) !== "created"
    ) {
      return await recoverConflict(directory, marker);
    }
    if (
      await linkDurableFileIfAbsent(
        paths.renditionStage,
        paths.rendition,
      ) !== "created"
    ) {
      return await recoverConflict(directory, marker);
    }

    const serialized = serializeMediaJsonLines([
      ...index.records,
      input.record,
    ]);
    const revalidated = decodeMediaJsonLines(serialized);
    if (!revalidated.ok) {
      const recovered = await recoverInterruptedImport(directory);
      return recovered === "rolled-back"
        ? invalidFailure("media-index-invalid")
        : ioFailure("media-vault-recovery-failed");
    }

    await writeAtomicFile(
      join(directory, INDEX_FILE),
      serialized,
      { backupPath: join(directory, INDEX_BACKUP) },
    );
    await cleanupCommittedTransaction(directory, marker);
    return {
      ok: true,
      record: input.record,
      originalPath: relativePaths.original,
    };
  } catch {
    const recovered = await recoverInterruptedImport(directory);
    if (recovered === "committed") {
      return {
        ok: true,
        record: input.record,
        originalPath: relativePaths.original,
      };
    }
    return recovered === "rolled-back" || recovered === "none"
      ? ioFailure("media-vault-write-failed")
      : ioFailure("media-vault-recovery-failed");
  }
}

async function recoverConflict(
  directory: string,
  marker: ImportMarker,
): Promise<MediaVaultImportResult> {
  const cleaned = await cleanupUncommittedTransaction(directory, marker);
  if (!cleaned) {
    return ioFailure("media-vault-recovery-failed");
  }
  await removeDurableFile(join(directory, IMPORT_MARKER));
  return conflictFailure("media-asset-conflict");
}

async function recoverInterruptedImport(
  directory: string,
): Promise<RecoveryOutcome> {
  const markerFile = await readOwnedTextFile(
    join(directory, IMPORT_MARKER),
  );
  if (markerFile.kind === "missing") {
    return "none";
  }
  if (markerFile.kind !== "text") {
    return "failed";
  }

  const marker = decodeImportMarker(markerFile.value);
  if (marker === undefined) {
    return "failed";
  }

  const index = await readIndex(directory);
  if (index.kind !== "records") {
    return "failed";
  }

  const expected = expectedRecord(marker);
  const indexed = index.records.find((record) => record.id === marker.id);
  if (indexed !== undefined) {
    if (!sameRecord(indexed, expected)) {
      return "failed";
    }
    const paths = transactionPaths(directory, marker);
    if (
      (await fileState(paths.original)).kind !== "file"
      || (await fileState(paths.rendition)).kind !== "file"
    ) {
      return "failed";
    }
    try {
      await cleanupCommittedTransaction(directory, marker);
      return "committed";
    } catch {
      return "failed";
    }
  }

  if (index.records.some((record) => record.path === expected.path)) {
    return "failed";
  }

  try {
    if (!await cleanupUncommittedTransaction(directory, marker)) {
      return "failed";
    }
    await removeDurableFile(join(directory, IMPORT_MARKER));
    return "rolled-back";
  } catch {
    return "failed";
  }
}

async function cleanupCommittedTransaction(
  directory: string,
  marker: ImportMarker,
): Promise<void> {
  const paths = transactionPaths(directory, marker);
  await cleanupCommittedStage(paths.originalStage, paths.original);
  await cleanupCommittedStage(paths.renditionStage, paths.rendition);
  await removeDurableFile(join(directory, IMPORT_MARKER));
}

async function cleanupCommittedStage(
  stagePath: string,
  finalPath: string,
): Promise<void> {
  const stage = await fileState(stagePath);
  const final = await fileState(finalPath);
  if (final.kind !== "file" || stage.kind === "unsafe") {
    throw new Error("Committed media-vault asset state is unsafe.");
  }
  if (stage.kind === "missing") {
    return;
  }
  if (!sameFileIdentity(stage, final)) {
    throw new Error("Committed media-vault staging inode changed.");
  }
  await removeDurableFile(stagePath);
}

async function cleanupUncommittedTransaction(
  directory: string,
  marker: ImportMarker,
): Promise<boolean> {
  const paths = transactionPaths(directory, marker);
  if (!await cleanupAssetPair(paths.originalStage, paths.original)) {
    return false;
  }
  return await cleanupAssetPair(paths.renditionStage, paths.rendition);
}

async function cleanupAssetPair(
  stagePath: string,
  finalPath: string,
): Promise<boolean> {
  const stage = await fileState(stagePath);
  const final = await fileState(finalPath);
  if (stage.kind === "unsafe" || final.kind === "unsafe") {
    return false;
  }
  if (stage.kind === "missing") {
    return final.kind === "missing";
  }

  if (
    final.kind === "file"
    && sameFileIdentity(stage, final)
  ) {
    await removeDurableFile(finalPath);
  }
  await removeDurableFile(stagePath);
  return true;
}

async function expectCreated(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  if (await writeDurableFileIfAbsent(path, bytes) !== "created") {
    throw new Error("Unexpected media-vault staging collision.");
  }
}

function createImportMarker(input: MediaVaultImport): ImportMarker {
  return {
    version: 1,
    id: input.record.id,
    description: input.record.description,
    english: input.record.english,
    sourceFormat: input.sourceFormat,
    renditionFormat: input.renditionFormat,
    token: randomUUID(),
  };
}

function decodeImportMarker(source: string): ImportMarker | undefined {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (
    keys !== "description,english,id,renditionFormat,sourceFormat,token,version"
    || record["version"] !== 1
    || typeof record["id"] !== "string"
    || typeof record["description"] !== "string"
    || typeof record["english"] !== "boolean"
    || !isImageFormat(record["sourceFormat"])
    || !isRenditionFormat(record["renditionFormat"])
    || typeof record["token"] !== "string"
    || !UUID.test(record["token"])
  ) {
    return undefined;
  }

  const paths = mediaVaultPaths(
    record["id"],
    record["sourceFormat"],
    record["renditionFormat"],
  );
  if (paths === undefined) {
    return undefined;
  }
  const decoded = decodeMediaRecord({
    id: record["id"],
    path: paths.rendition,
    description: record["description"],
    english: record["english"],
  });
  if (!decoded.ok) {
    return undefined;
  }

  return {
    version: 1,
    id: record["id"],
    description: record["description"],
    english: record["english"],
    sourceFormat: record["sourceFormat"],
    renditionFormat: record["renditionFormat"],
    token: record["token"],
  };
}

function expectedRecord(marker: ImportMarker): MediaRecord {
  const paths = mediaVaultPaths(
    marker.id,
    marker.sourceFormat,
    marker.renditionFormat,
  );
  if (paths === undefined) {
    throw new Error("Validated marker lost its media-vault path.");
  }
  return {
    id: marker.id,
    path: paths.rendition,
    description: marker.description,
    english: marker.english,
  };
}

function transactionPaths(
  directory: string,
  marker: ImportMarker,
): {
  readonly original: string;
  readonly rendition: string;
  readonly originalStage: string;
  readonly renditionStage: string;
} {
  const relative = mediaVaultPaths(
    marker.id,
    marker.sourceFormat,
    marker.renditionFormat,
  );
  if (relative === undefined) {
    throw new Error("Validated marker lost its media-vault path.");
  }
  return {
    original: join(directory, relative.original),
    rendition: join(directory, relative.rendition),
    originalStage: join(
      directory,
      "originals",
      "." + marker.id + "." + marker.token + ".original.staged",
    ),
    renditionStage: join(
      directory,
      "media",
      "." + marker.id + "." + marker.token + ".rendition.staged",
    ),
  };
}

async function readIndex(directory: string): Promise<IndexReadResult> {
  const source = await readOwnedTextFile(join(directory, INDEX_FILE));
  if (source.kind === "missing") {
    return { kind: "records", records: [] };
  }
  if (source.kind === "unsafe" || source.kind === "unreadable") {
    return source;
  }
  const decoded = decodeMediaJsonLines(source.value);
  return decoded.ok
    ? { kind: "records", records: decoded.value }
    : { kind: "invalid" };
}

async function readOwnedTextFile(path: string): Promise<
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unsafe" }
  | { readonly kind: "unreadable" }
> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return { kind: "unsafe" };
    }
    return { kind: "text", value: await readFile(path, "utf8") };
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return { kind: "missing" };
    }
    return { kind: "unreadable" };
  }
}

async function fileState(path: string): Promise<FileState> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return { kind: "unsafe" };
    }
    return {
      kind: "file",
      dev: metadata.dev,
      ino: metadata.ino,
    };
  } catch (error: unknown) {
    return isMissingPathError(error)
      ? { kind: "missing" }
      : { kind: "unsafe" };
  }
}

function sameFileIdentity(
  left: Extract<FileState, { readonly kind: "file" }>,
  right: Extract<FileState, { readonly kind: "file" }>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function safeVaultDirectories(directory: string): Promise<boolean> {
  if (await safeDirectoryState(directory) !== "directory") {
    return false;
  }
  for (const child of ["originals", "media"]) {
    if (await safeDirectoryState(join(directory, child)) === "unsafe") {
      return false;
    }
  }
  return true;
}

async function safeDirectoryState(
  path: string,
): Promise<"directory" | "missing" | "unsafe"> {
  try {
    const metadata = await lstat(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink()
      ? "directory"
      : "unsafe";
  } catch (error: unknown) {
    return isMissingPathError(error) ? "missing" : "unsafe";
  }
}

async function isOwnedRegularOrMissing(path: string): Promise<boolean> {
  const state = await fileState(path);
  return state.kind === "file" || state.kind === "missing";
}

function sameRecord(left: MediaRecord, right: MediaRecord): boolean {
  return left.id === right.id
    && left.path === right.path
    && left.description === right.description
    && left.english === right.english;
}

function isImageFormat(value: unknown): value is ImageFormat {
  return value === "jpeg"
    || value === "png"
    || value === "webp"
    || value === "avif"
    || value === "gif";
}

function isRenditionFormat(value: unknown): value is RenditionImageFormat {
  return value === "png" || value === "gif";
}

function lockFailureCode(
  reason: "busy" | "unsafe" | "io",
): MediaVaultIoCode {
  if (reason === "busy") {
    return "media-vault-locked";
  }
  return reason === "unsafe"
    ? "media-vault-unsafe"
    : "media-vault-lock-failed";
}

function ioFailure(code: MediaVaultIoCode): {
  readonly ok: false;
  readonly kind: "io";
  readonly code: MediaVaultIoCode;
} {
  return { ok: false, kind: "io", code };
}

function invalidFailure<T extends MediaVaultInvalidCode>(
  code: T,
): {
  readonly ok: false;
  readonly kind: "invalid";
  readonly code: T;
} {
  return { ok: false, kind: "invalid", code };
}

function conflictFailure(code: MediaVaultConflictCode): {
  readonly ok: false;
  readonly kind: "conflict";
  readonly code: MediaVaultConflictCode;
} {
  return { ok: false, kind: "conflict", code };
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}
