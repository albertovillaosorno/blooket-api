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
//   - Authenticated archive snapshots and extracted-tree byte validation.
// - Must-Not:
//   - Install, launch, consume secrets, or infer Apple trust.
// - Allows:
//   - Inputs: Authenticated archive facts and trusted local staging authority.
//   - Outputs: Bounded staging results still requiring Apple assessment.
//   - Side effects: Private snapshot copies and owned tree permission changes.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Native extraction no longer needs independent physical validation.
// - Summary:
//   - Authenticated archive snapshots and extracted-tree byte validation.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import { constants } from "node:fs";
import { chmod, lstat, open, readdir, readlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ManifestAsset } from
  "../../../ir/update-manifests/contract/manifest.ts";
import type { ArchiveLayout } from "./layout.ts";

export async function snapshotArchive(source: string, destination: string,
  asset: ManifestAsset, signal: AbortSignal) {
  signal.throwIfAborted();
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const original = await input.stat();
    if (!original.isFile() || original.size !== asset.size)
      throw new Error("archive-bytes");
    const output = await open(destination, "wx", 0o600);
    try {
      const hash = createHash("sha256");
      let count = 0;
      const stream = input.createReadStream({ autoClose: false });
      const cancel = () => stream.destroy(new Error("cancelled"));
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      try {
        for await (const chunk of stream) {
          signal.throwIfAborted();
          if (!Buffer.isBuffer(chunk)) throw new Error("archive-bytes");
          count += chunk.length;
          if (count > asset.size) throw new Error("archive-bytes");
          hash.update(chunk);
          await output.writeFile(chunk);
        }
        if (count !== asset.size || hash.digest("hex") !== asset.sha256)
          throw new Error("archive-bytes");
        signal.throwIfAborted();
        await output.sync();
      } finally {
        signal.removeEventListener("abort", cancel);
        stream.destroy();
      }
    } finally { await output.close(); }
  } finally { await input.close(); }
  await chmod(destination, 0o400);
}

async function hashFile(path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const hash = createHash("sha256");
    const stream = file.createReadStream({ autoClose: false });
    const cancel = () => stream.destroy(new Error("cancelled"));
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      for await (const chunk of stream) {
        signal.throwIfAborted();
        if (!Buffer.isBuffer(chunk)) throw new Error("extracted-bytes");
        hash.update(chunk);
      }
      return hash.digest("hex");
    } finally {
      signal.removeEventListener("abort", cancel);
      stream.destroy();
    }
  } finally { await file.close(); }
}

export async function validateAndFreezeTree(directory: string,
  layout: ArchiveLayout, signal: AbortSignal) {
  const seen = new Set<string>();
  async function visit(relative: string) {
    signal.throwIfAborted();
    const path = join(directory, relative);
    const expected = layout.bundle.get(relative);
    if (!expected || seen.has(relative)) throw new Error("extracted-layout");
    seen.add(relative);
    const info = await lstat(path);
    if (expected.kind === "directory") {
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("extracted-layout");
      for (const entry of await readdir(path)) await visit(relative + "/" +
        entry);
    } else if (expected.kind === "symlink") {
      if (!info.isSymbolicLink() ||
          await readlink(path) !== expected.target)
        throw new Error("extracted-layout");
    } else {
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
          info.size !== expected.size ||
          (info.mode & 0o111) !== expected.executable)
        throw new Error("extracted-layout");
      if (await hashFile(path, signal) !== expected.hash)
        throw new Error("extracted-bytes");
    }
  }
  for (const entry of await readdir(directory)) await visit(entry);
  if (seen.size !== layout.bundle.size) throw new Error("extracted-layout");
  // Once validated, sync and freeze only this generated candidate's entries.
  for (const record of layout.bundle.values()) {
    signal.throwIfAborted();
    if (record.kind !== "file") continue;
    const path = join(directory, record.path);
    await chmod(path, 0o600 | record.executable);
    const file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
    try { await file.sync(); }
    finally { await file.close(); }
    await chmod(path, 0o444 | record.executable);
    const frozen = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await frozen.sync(); }
    finally { await frozen.close(); }
  }
  const directories = [...layout.bundle.values()]
    .filter(record => record.kind === "directory")
    .sort((left, right) => right.path.length-left.path.length);
  for (const record of directories) {
    signal.throwIfAborted();
    await chmod(join(directory, record.path), 0o555);
    await syncDirectory(join(directory, record.path));
  }
  await chmod(directory, 0o500);
  await syncDirectory(directory);
  signal.throwIfAborted();
}

export async function syncDirectory(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await file.sync(); }
  finally { await file.close(); }
}

// Only call with the directory this operation exclusively created. Never
// remove a caller-selected, discovered, or merely similarly named directory.
export async function removeCreatedStage(path: string) {
  async function writable(directory: string) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return;
    await chmod(directory, 0o700);
    for (const entry of await readdir(directory, { withFileTypes: true }))
      if (entry.isDirectory()) await writable(join(directory, entry.name));
  }
  await writable(path);
  await rm(path, { recursive: true });
}
