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
//   - Exclusive bounded durable storage of admitted installation records.
// - Must-Not:
//   - Grant trust, select update phases, launch apps, or replace bundles.
// - Allows:
//   - Inputs: Local directory authority and selected journal transitions.
//   - Outputs: Durable journal facts or stable ownership/storage refusals.
//   - Side effects: Local locks, bounded reads, and atomic journal writes.
// - Split-When:
//   - Another installation target needs a distinct persistence contract.
// - Merge-When:
//   - Installation facts no longer need durable recovery.
// - Summary:
//   - Records intent and observation without inferring installed health.
// - Description:
//   - Paths and signed envelopes cannot grant filesystem or trust authority.
// - Usage:
//   - Reassess local publisher trust, ownership, and health before any action.
// - Defaults:
//   - Invalid or contradictory records cannot authorize recovery.
//
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decodeUpdateInstallationJournal, advanceUpdateInstallationJournal,
  pathAdmitted, type UpdateInstallationJournal } from
  "../../../ir/application-updates/contract/installation.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";
import { writeAtomicFile, writeDurableFileIfAbsent } from
  "../../atomic-files/adapter-outbound/atomic-file.ts";

const MAX_JOURNAL_BYTES = 16_384;
export interface UpdateInstallationStore {
  read(): Promise<UpdateInstallationJournal | undefined>;
  create(value: unknown): Promise<"created" | "exists">;
  replace(expected: unknown, next: unknown): Promise<void>;
  close(): Promise<void>;
}
export type UpdateInstallationStoreResult =
  | { readonly ok: true; readonly store: UpdateInstallationStore }
  | { readonly ok: false; readonly reason: "busy" | "storage" };
const unavailable = () => new Error("update-journal-storage-unavailable");
const missing = (error: unknown) => error instanceof Error &&
  "code" in error && error.code === "ENOENT";
function decode(value: unknown): UpdateInstallationJournal {
  const decoded = decodeUpdateInstallationJournal(value);
  if (!decoded.ok) throw new Error("update-journal-invalid");
  return decoded.value;
}
function bytes(value: UpdateInstallationJournal): string {
  const source = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(source) > MAX_JOURNAL_BYTES)
    throw new Error("update-journal-invalid");
  return source;
}

// Directory authority is local composition only, never an HTTP/MCP argument.
// Retain this store until any writer has stopped; close drains admitted I/O.
export async function openUpdateInstallationStore(directory: string):
  Promise<UpdateInstallationStoreResult> {
  if (!pathAdmitted(directory) || dirname(directory) === directory)
    return { ok: false, reason: "storage" };
  let identity: BigIntStats;
  try {
    if (await realpath(dirname(directory)) !== dirname(directory))
      return { ok: false, reason: "storage" };
    await mkdir(directory, { mode: 0o700 }).catch(error => {
      if (!(error instanceof Error && "code" in error &&
          error.code === "EEXIST")) throw error;
    });
    identity = await lstat(directory, { bigint: true });
    if (!identity.isDirectory() || (identity.mode & 0o077n) !== 0n ||
        await realpath(directory) !== directory ||
        (process.getuid && identity.uid !== BigInt(process.getuid())))
      return { ok: false, reason: "storage" };
  } catch { return { ok: false, reason: "storage" }; }
  const acquired = await tryAcquireFileLock(join(directory,
    ".installation.lock"));
  if (!acquired.ok) return { ok: false,
    reason: acquired.reason === "busy" ? "busy" : "storage" };
  const path = join(directory, "installation.json");
  let pending = Promise.resolve();
  let closing: Promise<void> | undefined;
  let closed = false;
  function admit<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error("update-journal-closed"));
    const next = pending.then(async () => {
      const current = await lstat(directory, { bigint: true }).catch(() => {
        throw unavailable();
      });
      if (!current.isDirectory() || current.dev !== identity.dev ||
          current.ino !== identity.ino || (current.mode & 0o077n) !== 0n ||
          current.uid !== identity.uid ||
          await realpath(directory) !== directory)
        throw unavailable();
      return operation();
    });
    pending = next.then(() => {}, () => {});
    return next;
  }
  async function read(): Promise<UpdateInstallationJournal | undefined> {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW |
        constants.O_NONBLOCK);
    }
    catch (error) {
      if (missing(error)) return undefined;
      throw unavailable();
    }
    try {
      const info = await handle.stat({ bigint: true });
      if (!info.isFile() || info.size > BigInt(MAX_JOURNAL_BYTES) ||
          info.nlink !== 1n ||
          (info.mode & 0o077n) !== 0n || info.uid !== identity.uid)
        throw unavailable();
      const buffer = Buffer.alloc(MAX_JOURNAL_BYTES + 1);
      let size = 0;
      for (;;) {
        const part = await handle.read(buffer, size,
          buffer.length - size, null);
        size += part.bytesRead;
        if (size > MAX_JOURNAL_BYTES) throw unavailable();
        if (!part.bytesRead) break;
      }
      const after = await handle.stat({ bigint: true });
      if (after.size !== info.size || after.mtimeNs !== info.mtimeNs ||
          after.ctimeNs !== info.ctimeNs) throw unavailable();
      try {
        return decode(JSON.parse(new TextDecoder("utf-8", { fatal: true })
          .decode(buffer.subarray(0, size))));
      } catch { throw new Error("update-journal-invalid"); }
    } finally { await handle.close(); }
  }
  return { ok: true, store: {
    read: () => admit(read),
    create: value => admit(async () => {
      const journal = decode(value);
      if (journal.phase !== "prepared")
        throw new Error("update-journal-invalid");
      // Even malformed existing work is preserved; only exclusive creation
      // may start a new installation record.
      await read();
      return writeDurableFileIfAbsent(path, bytes(journal));
    }),
    replace: (expected, next) => admit(async () => {
      const previous = decode(expected), journal = decode(next);
      const advanced = advanceUpdateInstallationJournal(previous,
        journal.phase);
      if (!advanced.ok || bytes(advanced.value) !== bytes(journal))
        throw new Error("update-journal-transition-invalid");
      const current = await read();
      if (!current || bytes(current) !== bytes(previous))
        throw new Error("update-journal-conflict");
      await writeAtomicFile(path, bytes(journal));
    }),
    close() {
      closed = true;
      closing ??= pending.then(() => acquired.lock.release()).catch(() => {
        closing = undefined;
        throw new Error("update-journal-close-failed");
      });
      return closing;
    },
  } };
}
