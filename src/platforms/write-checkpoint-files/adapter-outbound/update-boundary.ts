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
//   - Shared publication ownership and bounded attempt-file observation.
// - Must-Not:
//   - Install apps, inspect lesson content, reconcile, or delete journals.
// - Allows:
//   - Inputs: The trusted local user-data root.
//   - Outputs: An exclusive lock and attempt presence or storage failure.
//   - Side effects: Owned lock files and read-only directory iteration.
// - Split-When:
//   - Another persistent writer needs an independent update boundary.
// - Merge-When:
//   - Publication storage no longer crosses process boundaries.
// - Summary:
//   - Prevents new publication work while update composition inspects attempts.
// - Description:
//   - Unknown storage and symbolic paths fail closed without reading content.
// - Usage:
//   - Hold the boundary through observation and the entire safe restart.
// - Defaults:
//   - At most ten thousand publication folders and eight entries per folder.
//
import { lstat, opendir } from "node:fs/promises";
import { safeLibraryPath } from "../../user-library/adapter-outbound/files.ts";
import { tryAcquireFileLock, type FileLockAcquireResult } from
  "../../file-locks/adapter-outbound/file-lock.ts";

export async function acquirePublicationBoundary(root: string):
  Promise<FileLockAcquireResult> {
  try {
    return await tryAcquireFileLock(
      await safeLibraryPath(root, "publication-boundary.lock"),
    );
  } catch { return { ok: false, reason: "unsafe" }; }
}

// Caller must hold the shared boundary. Presence alone is enough to stop an
// update. Confirmed, invalid, and uncertain journals all need owning recovery.
export async function publicationAttemptPresent(root: string):
  Promise<boolean> {
  const path = await safeLibraryPath(root, "publications");
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
  if (!metadata.isDirectory()) throw new Error("publication-storage-unsafe");
  const admitted = new Set(["snapshot.json", "checkpoint.json", "budget.json"]);
  let folders = 0;
  for await (const entry of await opendir(path, { bufferSize: 32 })) {
    if (++folders > 10_000 || !entry.isDirectory() ||
        !/^[a-f0-9]{64}$/u.test(entry.name))
      throw new Error("publication-storage-unsafe");
    const directory = await safeLibraryPath(root, "publications/" + entry.name);
    const before = await lstat(directory);
    if (!before.isDirectory()) throw new Error("publication-storage-unsafe");
    let files = 0;
    for await (const file of await opendir(directory, { bufferSize: 8 })) {
      if (++files > 8 || !file.isFile())
        throw new Error("publication-storage-unsafe");
      if (file.name === "attempt.json") return true;
      if (!admitted.has(file.name))
        throw new Error("publication-storage-unsafe");
    }
    const after = await lstat(directory);
    if (!after.isDirectory() || before.dev !== after.dev ||
        before.ino !== after.ino)
      throw new Error("publication-storage-unsafe");
  }
  const after = await lstat(path);
  if (!after.isDirectory() || metadata.dev !== after.dev ||
      metadata.ino !== after.ino)
    throw new Error("publication-storage-unsafe");
  return false;
}
