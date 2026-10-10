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
//   - Canonical user-data command admission and retained writer leases.
// - Must-Not:
//   - Install apps, read lesson content, or reclaim uncertain writer leases.
// - Allows:
//   - Inputs: The trusted local user-data root.
//   - Outputs: Held command ownership or exclusive update admission.
//   - Side effects: Private lease/lock files and bounded directory iteration.
// - Split-When:
//   - Another persistent writer needs an independent update boundary.
// - Merge-When:
//   - Canonical user-data writes no longer cross process boundaries.
// - Summary:
//   - Keeps admitted command writers excluded from application replacement.
// - Description:
//   - Unknown storage and symbolic paths fail closed without reading content.
// - Usage:
//   - Hold the boundary through observation and the entire safe restart.
// - Defaults:
//   - At most 1,024 simultaneous retained command leases.
//
import { randomUUID } from "node:crypto";
import { lstat, mkdir, opendir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { safeLibraryPath } from "../../user-library/adapter-outbound/files.ts";
import { tryAcquireFileLock, type FileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";

export type CanonicalDataBoundary =
  | { readonly ok: true; release(): Promise<void> }
  | { readonly ok: false; readonly reason: "busy" | "writer-active"
      | "storage" };
const MAX_WRITERS = 1_024;
const INSTALLATION_MARKER = ".canonical-installation.lock";
const leaseName = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-" +
  "[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.lock$", "u");

async function admission(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  return tryAcquireFileLock(await safeLibraryPath(root,
    ".canonical-admission.lock"));
}
async function registrationAdmission(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 16; attempt++) {
    if (await installationPresent(root))
      return { ok: false as const, reason: "busy" as const };
    const acquired = await admission(root);
    if (acquired.ok || acquired.reason !== "busy" || attempt === 15)
      return acquired;
    // Bounded metadata contention only; no command/native writer starts yet.
    await pause(10);
  }
  return { ok: false as const, reason: "busy" as const };
}
async function installationPresent(root: string): Promise<boolean> {
  try {
    await lstat(await safeLibraryPath(root, INSTALLATION_MARKER));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
async function catalog(root: string): Promise<string> {
  const directory = await safeLibraryPath(root, ".canonical-writers");
  await mkdir(directory, { mode: 0o700 }).catch(error => {
    if (!(error instanceof Error && "code" in error &&
        error.code === "EEXIST")) throw error;
  });
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || (info.mode & 0o077n) !== 0n ||
      (process.getuid && info.uid !== BigInt(process.getuid())))
    throw new Error("canonical-writer-storage-unavailable");
  return directory;
}
async function count(directory: string): Promise<number> {
  const before = await lstat(directory, { bigint: true });
  let writers = 0, visited = 0;
  for await (const entry of await opendir(directory, { bufferSize: 16 })) {
    if (++visited > MAX_WRITERS || !entry.isFile() ||
        !leaseName.test(entry.name))
      throw new Error("canonical-writer-storage-unavailable");
    const info = await lstat(join(directory, entry.name), { bigint: true })
      .catch(error => {
        // Completed writers may remove only their own lease during scanning.
        if (error instanceof Error && "code" in error &&
            error.code === "ENOENT") return undefined;
        throw error;
      });
    if (!info) continue;
    writers++;
    if (!info.isFile() || (info.mode & 0o077n) !== 0n || info.nlink !== 1n ||
        info.uid !== before.uid || info.size > 256n)
      throw new Error("canonical-writer-storage-unavailable");
  }
  const after = await lstat(directory, { bigint: true });
  if (!before.isDirectory() || !after.isDirectory() ||
      before.dev !== after.dev || before.ino !== after.ino)
    throw new Error("canonical-writer-storage-unavailable");
  return writers;
}

// Registration holds admission only briefly; already-admitted independent
// commands keep separate leases and may complete concurrently. Lease removal
// follows actual command/native-worker completion, never socket closure.
export async function acquireCanonicalDataWriter(root: string):
  Promise<CanonicalDataBoundary> {
  let guard: FileLock | undefined, lease: FileLock | undefined;
  try {
    const acquired = await registrationAdmission(root);
    if (!acquired.ok) return { ok: false,
      reason: acquired.reason === "busy" ? "busy" : "storage" };
    guard = acquired.lock;
    if (await installationPresent(root)) {
      await guard.release();
      return { ok: false, reason: "busy" };
    }
    const directory = await catalog(root);
    if (await count(directory) >= MAX_WRITERS)
      throw new Error("canonical-writer-storage-unavailable");
    const registered = await tryAcquireFileLock(join(directory,
      randomUUID() + ".lock"));
    if (!registered.ok) throw new Error("canonical-writer-storage-unavailable");
    lease = registered.lock;
    await guard.release();
    guard = undefined;
    const owned = lease;
    return { ok: true, release: () => owned.release() };
  } catch {
    // Only this registration's exact lease is eligible for cleanup. Existing
    // stale/unknown leases are never inferred safe from a dead parent PID.
    try { await lease?.release(); } catch { /* Retain uncertain ownership. */ }
    try { await guard?.release(); } catch { /* Retain uncertain ownership. */ }
    return { ok: false, reason: "storage" };
  }
}

// Retain the installation marker throughout recovery; this excludes new
// canonical commands, even while the old service is offline. Existing or
// orphaned leases refuse admission; an independent PID never proves drainage.
// This does not fence noncanonical UI/settings/startup writers or publication.
export async function acquireCanonicalDataUpdateBoundary(root: string):
  Promise<CanonicalDataBoundary> {
  let guard: FileLock | undefined, marker: FileLock | undefined;
  try {
    const acquired = await admission(root);
    if (!acquired.ok) return { ok: false,
      reason: acquired.reason === "busy" ? "busy" : "storage" };
    guard = acquired.lock;
    if (await count(await catalog(root))) {
      await guard.release();
      return { ok: false, reason: "writer-active" };
    }
    const installation = await tryAcquireFileLock(
      await safeLibraryPath(root, INSTALLATION_MARKER),
      { reclaimDeadOwner: false },
    );
    if (!installation.ok) {
      await guard.release();
      return { ok: false, reason: installation.reason === "busy"
        ? "busy" : "storage" };
    }
    marker = installation.lock;
    await guard.release();
    guard = undefined;
    const owned = marker;
    return { ok: true, release: () => owned.release() };
  } catch {
    try { await marker?.release(); } catch { /* Retain uncertain ownership. */ }
    try { await guard?.release(); } catch { /* Retain uncertain ownership. */ }
    return { ok: false, reason: "storage" };
  }
}

export async function withCanonicalDataWriter<T>(root: string,
  work: () => Promise<T>): Promise<T> {
  const acquired = await acquireCanonicalDataWriter(root);
  if (!acquired.ok) throw new Error(acquired.reason === "busy"
    ? "canonical-data-busy" : "canonical-data-storage-unavailable");
  try { return await work(); }
  finally {
    try { await acquired.release(); }
    catch { throw new Error("canonical-data-storage-unavailable"); }
  }
}
