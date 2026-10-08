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
import { open } from "node:fs/promises";
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
