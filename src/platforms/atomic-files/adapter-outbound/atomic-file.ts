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
//   - Crash-resistant publication, replacement, and removal of local files.
// - Must-Not:
//   - Choose product paths, serialize domain values, or accept LLM path text.
// - Allows:
//   - Inputs: Trusted target paths, validated bytes, and backup preferences.
//   - Outputs: Durable published/replaced files and previous-value backups.
//   - Side effects: Local filesystem writes, publication, syncs, and cleanup.
// - Split-When:
//   - Windows replacement semantics need a distinct host implementation.
// - Merge-When:
//   - All supported hosts share one proven replacement primitive.
// - Summary:
//   - Implements durable same-directory file publication and replacement.
// - Description:
//   - Syncs new bytes before publication and the containing directory after.
// - Usage:
//   - Call only after the owning domain validates content and selects the path.
// - Defaults:
//   - New files use owner-only permissions and symbolic targets are refused.
//
import { randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteOptions {
  readonly backupPath?: string;
  readonly mode?: number;
}

export type DurableCreateResult = "created" | "exists";

export async function writeDurableFileIfAbsent(
  targetPath: string,
  contents: string | Uint8Array,
  mode = 0o600,
): Promise<DurableCreateResult> {
  const directory = dirname(targetPath);
  const targetName = basename(targetPath);
  const token = randomUUID();
  const temporaryPath = join(
    directory,
    "." + targetName + "." + token + ".tmp",
  );

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const existing = await regularFileState(targetPath);
  if (existing === "file") {
    return "exists";
  }

  try {
    await writeSyncedFile(temporaryPath, contents, mode);
    try {
      await link(temporaryPath, targetPath);
    } catch (error: unknown) {
      if (!isCode(error, "EEXIST")) {
        throw error;
      }
      if (await regularFileState(targetPath) === "file") {
        return "exists";
      }
      throw error;
    }
    await syncDirectory(directory);
    return "created";
  } finally {
    await removeIfPresent(temporaryPath);
  }
}

export async function removeDurableFile(targetPath: string): Promise<void> {
  const directory = dirname(targetPath);
  await refuseSymbolicTarget(targetPath);
  if (!await pathExists(targetPath)) {
    return;
  }

  await rm(targetPath, { force: true });
  await syncDirectory(directory);
}

export async function writeAtomicFile(
  targetPath: string,
  contents: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = dirname(targetPath);
  const targetName = basename(targetPath);
  const token = randomUUID();
  const temporaryPath = join(directory, `.${targetName}.${token}.tmp`);
  const backupTemporaryPath = options.backupPath === undefined
    ? undefined
    : `${options.backupPath}.${token}.tmp`;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await refuseSymbolicTarget(targetPath);

  try {
    await writeSyncedFile(
      temporaryPath,
      contents,
      options.mode ?? 0o600,
    );

    if (options.backupPath !== undefined && await pathExists(targetPath)) {
      await createBackup(
        targetPath,
        options.backupPath,
        backupTemporaryPath,
      );
    }

    await rename(temporaryPath, targetPath);
    await syncDirectory(directory);
  } finally {
    await removeIfPresent(temporaryPath);
    if (backupTemporaryPath !== undefined) {
      await removeIfPresent(backupTemporaryPath);
    }
  }
}

async function writeSyncedFile(
  path: string,
  contents: string | Uint8Array,
  mode: number,
): Promise<void> {
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function createBackup(
  targetPath: string,
  backupPath: string,
  backupTemporaryPath: string | undefined,
): Promise<void> {
  if (backupTemporaryPath === undefined) {
    return;
  }

  await refuseSymbolicTarget(backupPath);
  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  await copyFile(targetPath, backupTemporaryPath);
  const handle = await open(backupTemporaryPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(backupTemporaryPath, backupPath);
  await syncDirectory(dirname(backupPath));
}

async function refuseSymbolicTarget(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing symbolic file target: ${path}`);
    }
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return;
    }
    throw error;
  }
}

async function regularFileState(
  path: string,
): Promise<"file" | "missing"> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("Refusing non-regular file target: " + path);
    }
    return "file";
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return "missing";
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeIfPresent(path: string): Promise<void> {
  await rm(path, { force: true });
}

function isMissingPathError(error: unknown): boolean {
  return isCode(error, "ENOENT");
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === code;
}
