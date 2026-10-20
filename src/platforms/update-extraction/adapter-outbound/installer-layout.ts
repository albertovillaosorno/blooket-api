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
//   - Independent, verified installer program copies before bundle exchange.
// - Must-Not:
//   - Install, launch, consume secrets, or invent publisher trust.
// - Allows:
//   - Inputs: Captured installation authority and admitted Apple publisher.
//   - Outputs: Verified program copy or a bounded preparation failure.
//   - Side effects: Private program copies and owned tree permission changes.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Installer lifetime no longer crosses application replacement.
// - Summary:
//   - Independent, verified installer program copies before bundle exchange.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import { lstat, readdir, readlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashFile } from "./files.ts";
import { archivePath, buildArchiveLayout, MAX_ENTRY_BYTES,
  MAX_EXPANDED_BYTES, MAX_ZIP_ENTRIES, type ArchiveRecord } from "./layout.ts";

// Capture bounded regular bytes and internal links without following them.
// Apple reassessment of the eventual frozen copy remains mandatory.
export async function inspectInstallerProgramLayout(bundlePath: string,
  signal: AbortSignal) {
  const records: ArchiveRecord[] = [];
  let expanded = 0;
  async function visit(relative: string): Promise<void> {
    signal.throwIfAborted();
    if (records.length >= MAX_ZIP_ENTRIES) throw Error("installer-limit");
    const path = join(dirname(bundlePath), relative);
    const info = await lstat(path);
    const kind = info.isDirectory() ? "directory" : info.isSymbolicLink()
      ? "symlink" : info.isFile() ? "file" : undefined;
    if (!kind || (info.mode & 0o7000) !== 0 ||
        (kind === "file" && info.nlink !== 1))
      throw Error("installer-layout");
    archivePath(relative, kind === "directory");
    const size = kind === "directory" ? 0 : info.size;
    expanded += size;
    if (!Number.isSafeInteger(size) || size > MAX_ENTRY_BYTES ||
        expanded > MAX_EXPANDED_BYTES) throw Error("installer-limit");
    records.push({ path: relative, kind, size,
      executable: kind === "file" ? info.mode & 0o111 : 0,
      ...(kind === "file" ? { hash: await hashFile(path, signal) } : {}),
      ...(kind === "symlink" ? { target: await readlink(path) } : {}),
    });
    if (kind === "directory") {
      const entries = await readdir(path);
      if (entries.length + records.length > MAX_ZIP_ENTRIES)
        throw Error("installer-limit");
      for (const entry of entries) await visit(relative + "/" + entry);
    }
  }
  await visit("Blooket API.app");
  return buildArchiveLayout(records);
}
