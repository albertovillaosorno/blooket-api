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
//   - Immutable publication snapshot storage and owned path resolution.
// - Must-Not:
//   - Expose credentials, accept arbitrary paths, or infer remote success.
// - Allows:
//   - Inputs: Bounded logical requests and locally selected storage authority.
//   - Outputs: Bounded snapshot bytes or stable storage failures.
//   - Side effects: Exclusive durable snapshot creation and bounded file reads.
// - Split-When:
//   - One port family needs independent browser lifecycle management.
// - Merge-When:
//   - Application ports directly consume bridge commands.
// - Summary:
//   - Immutable publication snapshot storage and owned path resolution.
// - Description:
//   - Preserves the canonical runtime validation boundary.
// - Usage:
//   - Use through the owning validated command entrypoint.
// - Defaults:
//   - Invalid or unsupported inputs fail closed.
//
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, opendir, lstat } from "node:fs/promises";
import { safeLibraryPath } from "../../user-library/adapter-outbound/files.ts";
import { writeDurableFileIfAbsent } from
  "../../atomic-files/adapter-outbound/atomic-file.ts";

// The service root is local authority; external callers supply logical IDs.
export async function publicationFiles(root: string, draftId: string) {
  const folder = "publications/" +
    createHash("sha256").update(draftId).digest("hex");
  const path = (name: string) => safeLibraryPath(root, folder + "/" + name);
  return {
    snapshot: await path("snapshot.json"),
    checkpoint: await path("checkpoint.json"),
    attempt: await path("attempt.json"),
    budget: await path("budget.json"),
    lock: await path("command.lock"),
  };
}
export async function readPublicationSnapshot(
  path: string,
): Promise<unknown | undefined> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw new Error("publication-storage-unavailable");
  }
  try {
    const metadata = await handle.stat();
    // The snapshot is a write-ahead authority, not arbitrary JSON. Match
    // attempt and checkpoint ownership checks: a hard link would allow a
    // second path to mutate the same bytes outside the publication lock.
    if (!metadata.isFile() || metadata.nlink !== 1 ||
        (metadata.mode & 0o022) !== 0 ||
        !Number.isSafeInteger(metadata.size) ||
        metadata.size > 1_500_000)
      throw new Error("publication-snapshot-invalid");
    const bytes = Buffer.alloc(1_500_001);
    let size = 0;
    for (;;) {
      const part = await handle.read(bytes, size, bytes.length - size, null);
      if (!part.bytesRead) break;
      size += part.bytesRead;
      if (size > 1_500_000) throw new Error("publication-snapshot-invalid");
    }
    // A same-size replacement or permission change during read cannot
    // authorize a new remote write. Also reject a pathname swapped to a
    // different inode after opening the no-follow descriptor.
    const after = await handle.stat();
    const pathname = await lstat(path);
    if (size !== metadata.size || !after.isFile() ||
        after.nlink !== 1 || (after.mode & 0o022) !== 0 ||
        !pathname.isFile() || pathname.nlink !== 1 ||
        (pathname.mode & 0o022) !== 0 ||
        after.dev !== metadata.dev || after.ino !== metadata.ino ||
        after.size !== metadata.size ||
        after.mtimeMs !== metadata.mtimeMs ||
        after.ctimeMs !== metadata.ctimeMs ||
        pathname.dev !== metadata.dev || pathname.ino !== metadata.ino ||
        pathname.size !== metadata.size ||
        pathname.mtimeMs !== metadata.mtimeMs ||
        pathname.ctimeMs !== metadata.ctimeMs)
      throw new Error("publication-snapshot-invalid");
    return JSON.parse(bytes.subarray(0, size).toString("utf8")) as unknown;
  } finally { await handle.close(); }
}
export async function createPublicationSnapshot(path: string, value: unknown) {
  const source = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(source) > 1_500_000)
    throw new Error("publication-snapshot-invalid");
  if (await writeDurableFileIfAbsent(path, source) !== "created")
    throw new Error("publication-snapshot-conflict");
}


export async function readOtherPublicationSnapshots(
  root: string,
  excludedDraftId: string,
): Promise<readonly { readonly draftId: string; readonly data: unknown }[]> {
  // The global publication boundary must already be held by the caller.
  // Never trust directory aliases, symbolic entries, or a copied snapshot's
  // internal draft ID to authorize a new remote mutation.
  const folder = await safeLibraryPath(root, "publications");
  let directory;
  try { directory = await opendir(folder); }
  catch (error) {
    if (error instanceof Error && "code" in error &&
        error.code === "ENOENT") return [];
    throw new Error("publication-storage-unavailable");
  }
  const excluded = createHash("sha256").update(excludedDraftId)
    .digest("hex");
  const result: { draftId: string; data: unknown }[] = [];
  let totalBytes = 0;
  let visited = 0;
  for await (const entry of directory) {
    if (++visited > 4_096)
      throw new Error("publication-snapshot-limit");
    if (entry.isSymbolicLink())
      throw new Error("publication-storage-unavailable");
    if (!/^[a-f0-9]{64}$/u.test(entry.name)) {
      // Unrelated Finder metadata is not a publication; never descend it.
      continue;
    }
    if (!entry.isDirectory())
      throw new Error("publication-storage-unavailable");
    if (entry.name === excluded) continue;
    const source = await safeLibraryPath(
      root, "publications/" + entry.name + "/snapshot.json",
    );
    const bytes = await lstat(source).catch((error: unknown) => {
      if (error instanceof Error && "code" in error &&
          error.code === "ENOENT") return undefined;
      throw new Error("publication-storage-unavailable");
    });
    if (bytes === undefined) {
      // An interrupted snapshot creation can leave an empty directory, but
      // never ignore a directory holding write-attempt or budget evidence.
      for (const evidence of ["attempt.json", "checkpoint.json",
        "budget.json"]) {
        const path = await safeLibraryPath(root,
          "publications/" + entry.name + "/" + evidence);
        const present = await lstat(path).catch((error: unknown) => {
          if (error instanceof Error && "code" in error &&
              error.code === "ENOENT") return undefined;
          throw new Error("publication-storage-unavailable");
        });
        if (present !== undefined)
          throw new Error("publication-storage-unavailable");
      }
      continue;
    }
    totalBytes += bytes.size;
    if (!bytes.isFile() || bytes.size > 1_500_000 ||
        totalBytes > 24_000_000)
      throw new Error("publication-storage-unavailable");
    const data = await readPublicationSnapshot(source);
    if (!data || typeof data !== "object" ||
        !("draftId" in data) ||
        typeof data.draftId !== "string" ||
        createHash("sha256").update(data.draftId).digest("hex") !==
          entry.name) throw new Error("publication-storage-unavailable");
    result.push({ draftId: data.draftId, data });
  }
  return result.sort((a, b) => a.draftId.localeCompare(b.draftId));
}
