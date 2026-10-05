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
//   - Exclusive local writer locks for supported POSIX hosts.
// - Must-Not:
//   - Choose product paths, mutate durable content, or steal live locks.
// - Allows:
//   - Inputs: Trusted lock-file paths selected by persistence adapters.
//   - Outputs: An acquired lock handle or a stable refusal reason.
//   - Side effects: Same-directory owner files, hard links, and cleanup.
// - Split-When:
//   - Windows support requires a different native locking strategy.
// - Merge-When:
//   - Node exposes one portable crash-released exclusive locking primitive.
// - Summary:
//   - Serializes local persistence writers without third-party dependencies.
// - Description:
//   - Publishes complete owner metadata atomically and reclaims dead PID locks.
// - Usage:
//   - Hold one aggregate lock around recovery, snapshot, and replacement.
// - Defaults:
//   - Unknown or unverifiable lock owners fail closed as busy or unsafe.
//
import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

interface LockOwner {
  readonly version: 1;
  readonly pid: number;
  readonly token: string;
}

export interface FileLock {
  readonly path: string;
  release(): Promise<void>;
}

export type FileLockAcquireResult =
  | { readonly ok: true; readonly lock: FileLock }
  | {
      readonly ok: false;
      readonly reason: "busy" | "unsafe" | "io";
    };

export async function tryAcquireFileLock(
  lockPath: string,
): Promise<FileLockAcquireResult> {
  const directory = dirname(lockPath);
  const token = randomUUID();
  const owner: LockOwner = {
    version: 1,
    pid: process.pid,
    token,
  };
  const ownerPath = join(
    directory,
    "." + basename(lockPath) + "." + token + ".owner.tmp",
  );

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeOwnerFile(ownerPath, owner);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await link(ownerPath, lockPath);
        return {
          ok: true,
          lock: createFileLock(lockPath, owner),
        };
      } catch (error: unknown) {
        if (!isCode(error, "EEXIST")) {
          return { ok: false, reason: "io" };
        }
      }

      const existing = await readLockOwner(lockPath);
      if (existing.kind === "missing") {
        continue;
      }
      if (existing.kind === "unsafe") {
        return { ok: false, reason: "unsafe" };
      }
      if (existing.kind === "unreadable") {
        return { ok: false, reason: "io" };
      }
      if (isProcessAlive(existing.owner.pid)) {
        return { ok: false, reason: "busy" };
      }

      try {
        await rm(lockPath);
      } catch (error: unknown) {
        if (!isCode(error, "ENOENT")) {
          return { ok: false, reason: "io" };
        }
      }
    }

    return { ok: false, reason: "busy" };
  } catch {
    return { ok: false, reason: "io" };
  } finally {
    await rm(ownerPath, { force: true }).catch(() => undefined);
  }
}

async function writeOwnerFile(
  path: string,
  owner: LockOwner,
): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(owner) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function createFileLock(lockPath: string, owner: LockOwner): FileLock {
  let released = false;
  return {
    path: lockPath,
    async release(): Promise<void> {
      if (released) {
        return;
      }

      const current = await readLockOwner(lockPath);
      if (current.kind === "missing") {
        released = true;
        return;
      }
      if (
        current.kind !== "owner"
        || current.owner.pid !== owner.pid
        || current.owner.token !== owner.token
      ) {
        throw new Error("Refusing to release a lock owned by another writer.");
      }

      await rm(lockPath);
      released = true;
    },
  };
}

async function readLockOwner(path: string): Promise<
  | { readonly kind: "owner"; readonly owner: LockOwner }
  | { readonly kind: "missing" }
  | { readonly kind: "unsafe" }
  | { readonly kind: "unreadable" }
> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return { kind: "unsafe" };
    }
    const decoded = decodeLockOwner(await readFile(path, "utf8"));
    return decoded === undefined
      ? { kind: "unsafe" }
      : { kind: "owner", owner: decoded };
  } catch (error: unknown) {
    return isCode(error, "ENOENT")
      ? { kind: "missing" }
      : { kind: "unreadable" };
  }
}

function decodeLockOwner(source: string): LockOwner | undefined {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "pid,token,version"
    || record["version"] !== 1
    || !Number.isInteger(record["pid"])
    || (record["pid"] as number) <= 0
    || typeof record["token"] !== "string"
    || record["token"].length === 0
  ) {
    return undefined;
  }

  return {
    version: 1,
    pid: record["pid"] as number,
    token: record["token"],
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !isCode(error, "ESRCH");
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === code;
}
