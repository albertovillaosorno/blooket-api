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
//   - Local user-data command/request admission and retained writer leases.
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
//   - Keeps admitted local data writers excluded from application replacement.
// - Description:
//   - Unknown storage and symbolic paths fail closed without reading content.
// - Usage:
//   - Hold the boundary through observation and the entire safe restart.
// - Defaults:
//   - At most 1,024 simultaneous retained command leases.
//
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { safeLibraryPath } from "../../user-library/adapter-outbound/files.ts";
import { tryAcquireFileLock, type FileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";
import { exactOwnData } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";
import { decodeUpdateStartupRequest, type UpdateStartupRequest } from
  "../../../ir/application-updates/contract/startup.ts";

export type CanonicalDataBoundary =
  | { readonly ok: true; release(): Promise<void> }
  | { readonly ok: false; readonly reason: "busy" | "writer-active"
      | "storage" };
const MAX_WRITERS = 1_024;
const INSTALLATION_MARKER = ".canonical-installation.lock";
const ownerToken = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-" +
  "[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "u");
interface InstallationOwner {
  readonly root: string;
  readonly pid: number;
  readonly token: string;
  readonly dev: bigint;
  readonly ino: bigint;
}
const installationOwners = new WeakMap<object, InstallationOwner>();
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

async function registerWriter(root: string): Promise<FileLock> {
  const directory = await catalog(root);
  if (await count(directory) >= MAX_WRITERS)
    throw new Error("canonical-writer-storage-unavailable");
  const registered = await tryAcquireFileLock(join(directory,
    randomUUID() + ".lock"));
  if (!registered.ok) throw new Error("canonical-writer-storage-unavailable");
  return registered.lock;
}

async function installationOwner(root: string): Promise<InstallationOwner> {
  const handle = await open(await safeLibraryPath(root, INSTALLATION_MARKER),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.nlink !== 1n || info.size > 256n ||
        (info.mode & 0o077n) !== 0n ||
        (process.getuid && info.uid !== BigInt(process.getuid())))
      throw new Error("canonical-installation-unavailable");
    const bytes = Buffer.alloc(257);
    let size = 0;
    for (;;) {
      const part = await handle.read(bytes, size, bytes.length - size, null);
      if (!part.bytesRead) break;
      size += part.bytesRead;
      if (size === bytes.length)
        throw new Error("canonical-installation-unavailable");
    }
    const owner = exactOwnData(JSON.parse(bytes.subarray(0, size)
      .toString("utf8")), ["version", "pid", "token"]);
    if (!owner || owner["version"] !== 1 ||
        typeof owner["pid"] !== "number" ||
        !Number.isSafeInteger(owner["pid"]) || owner["pid"] < 1 ||
        typeof owner["token"] !== "string" || !ownerToken.test(owner["token"]))
      throw new Error("canonical-installation-unavailable");
    return { root, pid: owner["pid"], token: owner["token"],
      dev: info.dev, ino: info.ino };
  } finally { await handle.close(); }
}

// Only a live capability returned by this process's update acquisition can
// issue this confidential message for an actual connected child it owns.
// Send it only over that child's private IPC; never publish it in diagnostics.
export async function authorizeCanonicalServiceStartup(
  boundary: CanonicalDataBoundary, child: ChildProcess,
): Promise<UpdateStartupRequest | undefined> {
  const owned = installationOwners.get(boundary);
  if (!owned || !child.connected || child.exitCode !== null ||
      child.signalCode !== null || child.pid === undefined) return undefined;
  try {
    const current = await installationOwner(owned.root);
    if (current.pid !== process.pid || current.pid !== owned.pid ||
        current.token !== owned.token || current.dev !== owned.dev ||
        current.ino !== owned.ino || installationOwners.get(boundary) !== owned)
      return undefined;
    return decodeUpdateStartupRequest({ kind: "update-startup-request",
      version: 1, ownerPid: process.pid, childPid: child.pid,
      token: current.token });
  } catch { return undefined; }
}

// This exception admits only the owned installer child, not ordinary writers.
// Register its lifetime lease while admission is held and the exact parent's
// installation marker remains present. Releasing the marker never admits a
// second installation while the candidate/rollback service is still running.
export async function acquireCanonicalInstallerServiceWriter(root: string,
  value: unknown): Promise<CanonicalDataBoundary> {
  const request = decodeUpdateStartupRequest(value);
  if (!request || !process.connected || typeof process.send !== "function" ||
      request.ownerPid !== process.ppid || request.childPid !== process.pid)
    return { ok: false, reason: "busy" };
  let guard: FileLock | undefined, lease: FileLock | undefined;
  try {
    const acquired = await admission(root);
    if (!acquired.ok) return { ok: false,
      reason: acquired.reason === "busy" ? "busy" : "storage" };
    guard = acquired.lock;
    const owner = await installationOwner(root);
    if (owner.pid !== request.ownerPid || owner.token !== request.token ||
        !process.connected || process.ppid !== request.ownerPid) {
      await guard.release();
      return { ok: false, reason: "busy" };
    }
    lease = await registerWriter(root);
    await guard.release();
    guard = undefined;
    const owned = lease;
    return { ok: true, release: () => owned.release() };
  } catch {
    try { await lease?.release(); } catch { /* Retain uncertain ownership. */ }
    try { await guard?.release(); } catch { /* Retain uncertain ownership. */ }
    return { ok: false, reason: "storage" };
  }
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
    lease = await registerWriter(root);
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
// Ordinary managed services and direct local HTTP handlers share these leases.
// Installer-owned startup and publication retain their private admission.
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
    const owner = await installationOwner(root);
    if (owner.pid !== process.pid)
      throw new Error("canonical-installation-unavailable");
    await guard.release();
    guard = undefined;
    const owned = marker;
    const result: CanonicalDataBoundary = { ok: true, release: () => {
      installationOwners.delete(result);
      return owned.release();
    } };
    installationOwners.set(result, owner);
    return result;
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
