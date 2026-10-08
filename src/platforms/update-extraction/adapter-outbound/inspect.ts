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
//   - Bounded ZIP inventory, redundant-header checks, and payload hashes.
// - Must-Not:
//   - Install, launch, consume secrets, or infer Apple trust.
// - Allows:
//   - Inputs: Authenticated archive facts and trusted local staging authority.
//   - Outputs: Bounded staging results still requiring Apple assessment.
//   - Side effects: Read-only inspection of a private staged ZIP.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Native extraction no longer needs independent physical validation.
// - Summary:
//   - Bounded ZIP inventory, redundant-header checks, and payload hashes.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
// jig-ignore-next-line: Preserve the repository-owned dependency type path.
import type * as ZipTypes from "../../../../.dependencies/pnpm/node_modules/@types/yauzl/index.d.ts";
import { abortable } from "../../update-downloads/adapter-outbound/response.ts";
import { archivePath, buildArchiveLayout, MAX_ENTRY_BYTES,
  MAX_EXPANDED_BYTES, MAX_ZIP_ENTRIES, type ArchiveRecord } from "./layout.ts";

const library: typeof ZipTypes = await import(new URL(
  "../../../../.dependencies/pnpm/node_modules/yauzl/index.js", import.meta.url,
).href);
// ASCII names need no alternate Unicode path authority in either header.
const EXTRA_FIELDS = new Set([0x5455, 0x7875]);

export async function inspectUpdateArchive(path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const pending = library.openPromise(path, { autoClose: false,
    strictFileNames: true, validateEntrySizes: true });
  void pending.then(zip => { if (signal.aborted) zip.close(); }, () => {});
  const zip = await abortable(pending, signal);
  const iterator = zip.eachEntry();
  // Keep close/read failures handled after the iterator releases its listeners.
  zip.on("error", () => {});
  const records: ArchiveRecord[] = [];
  let expanded = 0;
  try {
    if (zip.entryCount < 1 || zip.entryCount > MAX_ZIP_ENTRIES)
      throw new Error("archive-limit");
    for (;;) {
      const next = await abortable(iterator.next(), signal);
      if (next.done) break;
      const entry = next.value;
      const unix = entry.externalFileAttributes >>> 16;
      const fileType = unix & 0o170000;
      const directory = entry.fileName.endsWith("/");
      const kind = fileType === 0o120000 ? "symlink"
        : directory ? "directory" : "file";
      if (entry.isEncrypted() ||
          (entry.generalPurposeBitFlag & ~0x80e) !== 0 ||
          ![0, 8].includes(entry.compressionMethod) ||
          ![0, 0o100000, 0o040000, 0o120000].includes(fileType) ||
          (directory && kind === "symlink") ||
          (fileType === 0o040000 && !directory) ||
          (fileType === 0o100000 && directory) || (unix & 0o7000) !== 0)
        throw new Error("archive-layout");
      const name = archivePath(entry.fileName, directory);
      if (!Number.isSafeInteger(entry.uncompressedSize) ||
          entry.uncompressedSize < 0 ||
          entry.uncompressedSize > MAX_ENTRY_BYTES ||
          (directory && entry.uncompressedSize !== 0) ||
          (kind === "symlink" && entry.uncompressedSize > 4_096))
        throw new Error("archive-limit");
      expanded += entry.uncompressedSize;
      if (expanded > MAX_EXPANDED_BYTES) throw new Error("archive-limit");
      const local = await abortable(zip.readLocalFileHeaderPromise(entry),
        signal);
      // Native extraction must see the same name/method/flags as our reader.
      // Data-descriptor sizes may be deferred, but names cannot be aliases.
      if (!local.fileName.equals(entry.fileNameRaw) ||
          !entry.fileNameRaw.equals(Buffer.from(entry.fileName, "ascii")) ||
          local.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
          local.compressionMethod !== entry.compressionMethod ||
          ((entry.generalPurposeBitFlag & 8) === 0 &&
            (local.crc32 !== entry.crc32 ||
             local.compressedSize !== entry.compressedSize ||
             local.uncompressedSize !== entry.uncompressedSize)) ||
          entry.extraFields.some(field => !EXTRA_FIELDS.has(field.id)) ||
          library.parseExtraFields(local.extraField).some(field =>
            !EXTRA_FIELDS.has(field.id))) throw new Error("archive-layout");
      const content = directory ? {} : await inspectContent(zip, entry,
        kind === "symlink", name.startsWith("__MACOSX/"), signal);
      records.push({ path: name, kind, size: entry.uncompressedSize,
        executable: kind === "file" ? unix & 0o111 : 0, ...content });
    }
    signal.throwIfAborted();
    return buildArchiveLayout(records);
  } finally {
    await iterator.return?.();
    zip.close();
  }
}

async function inspectContent(zip: ZipTypes.ZipFile, entry: ZipTypes.Entry,
  symbolic: boolean, metadata: boolean, signal: AbortSignal) {
  const pending = zip.openReadStreamPromise(entry);
  void pending.then(stream => { if (signal.aborted) stream.destroy(); },
    () => {});
  const stream = await abortable(pending, signal);
  const cancel = () => stream.destroy(new Error("cancelled"));
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const hash = createHash("sha256");
  let checksum = 0, count = 0;
  const target: Buffer[] = [];
  let prefix = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      signal.throwIfAborted();
      if (!Buffer.isBuffer(chunk)) throw new Error("archive-layout");
      count += chunk.length;
      if (count > entry.uncompressedSize ||
          (symbolic && count > 4_096) || (metadata && count > 4_194_304))
        throw new Error("archive-limit");
      hash.update(chunk);
      checksum = crc32(chunk, checksum);
      if (symbolic) target.push(chunk);
      if (metadata && prefix.length < 26)
        prefix = Buffer.concat([prefix, chunk.subarray(0, 26-prefix.length)]);
    }
    if (count !== entry.uncompressedSize || checksum !== entry.crc32)
      throw new Error("archive-bytes");
    if (metadata && (prefix.length < 26 ||
        prefix.readUInt32BE(0) !== 0x00051607 ||
        prefix.readUInt32BE(4) !== 0x00020000))
      throw new Error("archive-layout");
    return symbolic ? { target: new TextDecoder("utf-8", { fatal: true })
      .decode(Buffer.concat(target)) } : { hash: hash.digest("hex") };
  } finally {
    signal.removeEventListener("abort", cancel);
    stream.destroy();
  }
}
