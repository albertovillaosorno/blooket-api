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
//   - Durable loading, replacement, and crash recovery for project directories.
// - Must-Not:
//   - Change project semantics, migrate schemas, or accept symbolic file
//     targets.
// - Allows:
//   - Inputs: Trusted project directory paths and validated project bundles.
//   - Outputs: Loaded bundles or stable I/O and validation failures.
//   - Side effects: Reads and atomically replaces local project files and
//     backups.
// - Split-When:
//   - Host-specific filesystem semantics require distinct implementations.
// - Merge-When:
//   - Project persistence no longer spans multiple local files.
// - Summary:
//   - Protects project.json and media.jsonl with a recoverable write
//     transaction.
// - Description:
//   - A marker keeps interrupted two-file replacements rollback-safe.
// - Usage:
//   - Use this adapter instead of editing durable project files directly.
// - Defaults:
//   - Backups are retained after successful replacement for manual recovery.
//
import {
  lstat,
  readFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";

import {
  decodeProjectBundle,
  serializeProjectBundle,
  type ProjectBundle,
} from "../../../projects/project-bundles/domain/project-bundle.ts";
import { writeAtomicFile } from
  "../../atomic-files/adapter-outbound/atomic-file.ts";

const PROJECT_FILE = "project.json";
const MEDIA_FILE = "media.jsonl";
const PROJECT_BACKUP = "project.json.bak";
const MEDIA_BACKUP = "media.jsonl.bak";
const WRITE_MARKER = ".blooket-api-project-write.json";

export type ProjectDirectoryLoadResult =
  | { readonly ok: true; readonly bundle: ProjectBundle }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code: ProjectDirectoryIoCode;
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: ReturnType<typeof decodeProjectBundle> extends infer R
        ? R extends { readonly ok: false; readonly issues: infer I }
          ? I
          : never
        : never;
    };

export type ProjectDirectorySaveResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code: ProjectDirectoryIoCode;
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly {
        readonly path: string;
        readonly code: string;
        readonly message: string;
      }[];
    };

export type ProjectDirectoryIoCode =
  | "project-directory-unsafe"
  | "project-files-missing"
  | "project-files-unreadable"
  | "project-write-failed"
  | "project-recovery-failed";

interface WriteMarker {
  readonly version: 1;
  readonly hadProject: boolean;
  readonly hadMedia: boolean;
}

export async function loadProjectDirectory(
  directory: string,
): Promise<ProjectDirectoryLoadResult> {
  if (!await isSafeDirectory(directory)) {
    return ioFailure("project-directory-unsafe");
  }

  const recovered = await recoverInterruptedWrite(directory);
  if (!recovered) {
    return ioFailure("project-recovery-failed");
  }

  const project = await readOwnedTextFile(join(directory, PROJECT_FILE));
  const media = await readOwnedTextFile(join(directory, MEDIA_FILE));
  if (project.kind === "missing" || media.kind === "missing") {
    return ioFailure("project-files-missing");
  }
  if (project.kind !== "text" || media.kind !== "text") {
    return ioFailure("project-files-unreadable");
  }

  const bundle = decodeProjectBundle(project.value, media.value);
  if (!bundle.ok) {
    return { ok: false, kind: "invalid", issues: bundle.issues };
  }
  return { ok: true, bundle: bundle.value };
}

export async function saveProjectDirectory(
  directory: string,
  bundle: ProjectBundle,
): Promise<ProjectDirectorySaveResult> {
  if (!await isSafeDirectory(directory)) {
    return ioFailure("project-directory-unsafe");
  }

  if (!await recoverInterruptedWrite(directory)) {
    return ioFailure("project-recovery-failed");
  }

  const serialized = serializeProjectBundle(bundle);
  const validated = decodeProjectBundle(
    serialized.projectJson,
    serialized.mediaJsonl,
  );
  if (!validated.ok) {
    return { ok: false, kind: "invalid", issues: validated.issues };
  }

  const paths = projectPaths(directory);
  const hadProject = await ownedFileExists(paths.project);
  const hadMedia = await ownedFileExists(paths.media);
  const projectBackupSafe = await isOwnedRegularOrMissing(paths.projectBackup);
  const mediaBackupSafe = await isOwnedRegularOrMissing(paths.mediaBackup);
  if (
    hadProject === "unsafe"
    || hadMedia === "unsafe"
    || !projectBackupSafe
    || !mediaBackupSafe
  ) {
    return ioFailure("project-directory-unsafe");
  }

  const marker: WriteMarker = {
    version: 1,
    hadProject: hadProject === true,
    hadMedia: hadMedia === true,
  };

  try {
    if (!await snapshotForRecovery(
      paths.project,
      paths.projectBackup,
      marker.hadProject,
    )) {
      return ioFailure("project-write-failed");
    }
    if (!await snapshotForRecovery(
      paths.media,
      paths.mediaBackup,
      marker.hadMedia,
    )) {
      return ioFailure("project-write-failed");
    }

    await writeAtomicFile(paths.marker, `${JSON.stringify(marker)}\n`);
    await writeAtomicFile(paths.media, serialized.mediaJsonl);
    await writeAtomicFile(paths.project, serialized.projectJson);
    await rm(paths.marker, { force: true });
    return { ok: true };
  } catch {
    const recovered = await recoverInterruptedWrite(directory);
    return recovered
      ? ioFailure("project-write-failed")
      : ioFailure("project-recovery-failed");
  }
}

async function snapshotForRecovery(
  target: string,
  backup: string,
  existedBefore: boolean,
): Promise<boolean> {
  if (!existedBefore) {
    return true;
  }

  const current = await readOwnedTextFile(target);
  if (current.kind !== "text") {
    return false;
  }
  await writeAtomicFile(backup, current.value);
  return true;
}

async function recoverInterruptedWrite(directory: string): Promise<boolean> {
  const paths = projectPaths(directory);
  const markerText = await readOwnedTextFile(paths.marker);
  if (markerText.kind === "missing") {
    return true;
  }
  if (markerText.kind !== "text") {
    return false;
  }

  const marker = decodeWriteMarker(markerText.value);
  if (marker === undefined) {
    return false;
  }

  try {
    if (!await restoreFile(
      paths.project,
      paths.projectBackup,
      marker.hadProject,
    )) {
      return false;
    }
    if (!await restoreFile(paths.media, paths.mediaBackup, marker.hadMedia)) {
      return false;
    }
    await rm(paths.marker, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function restoreFile(
  target: string,
  backup: string,
  existedBefore: boolean,
): Promise<boolean> {
  if (!existedBefore) {
    await rm(target, { force: true });
    return true;
  }

  const backupText = await readOwnedTextFile(backup);
  if (backupText.kind === "missing") {
    return false;
  }
  if (backupText.kind !== "text") {
    return false;
  }
  await writeAtomicFile(target, backupText.value);
  return true;
}

function decodeWriteMarker(source: string): WriteMarker | undefined {
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
  if (
    Object.keys(record).sort().join(",") !== "hadMedia,hadProject,version"
    || record["version"] !== 1
    || typeof record["hadProject"] !== "boolean"
    || typeof record["hadMedia"] !== "boolean"
  ) {
    return undefined;
  }
  return {
    version: 1,
    hadProject: record["hadProject"],
    hadMedia: record["hadMedia"],
  };
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

async function ownedFileExists(
  path: string,
): Promise<boolean | "unsafe"> {
  const value = await readOwnedTextFile(path);
  if (value.kind === "unsafe" || value.kind === "unreadable") {
    return "unsafe";
  }
  return value.kind === "text";
}

async function isOwnedRegularOrMissing(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch (error: unknown) {
    return isMissingPathError(error);
  }
}

async function isSafeDirectory(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch (error: unknown) {
    return isMissingPathError(error);
  }
}

function projectPaths(directory: string): {
  readonly project: string;
  readonly media: string;
  readonly projectBackup: string;
  readonly mediaBackup: string;
  readonly marker: string;
} {
  return {
    project: join(directory, PROJECT_FILE),
    media: join(directory, MEDIA_FILE),
    projectBackup: join(directory, PROJECT_BACKUP),
    mediaBackup: join(directory, MEDIA_BACKUP),
    marker: join(directory, WRITE_MARKER),
  };
}

function ioFailure(code: ProjectDirectoryIoCode): {
  readonly ok: false;
  readonly kind: "io";
  readonly code: ProjectDirectoryIoCode;
} {
  return { ok: false, kind: "io", code };
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}
