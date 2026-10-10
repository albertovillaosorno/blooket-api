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
    if (!metadata.isFile() || metadata.size > 1_500_000)
      throw new Error("publication-snapshot-invalid");
    const bytes = Buffer.alloc(1_500_001);
    let size = 0;
    for (;;) {
      const part = await handle.read(bytes, size, bytes.length - size, null);
      if (!part.bytesRead) break;
      size += part.bytesRead;
      if (size > 1_500_000) throw new Error("publication-snapshot-invalid");
    }
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
