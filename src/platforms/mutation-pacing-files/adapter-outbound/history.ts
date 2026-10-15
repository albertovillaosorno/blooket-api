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
//   - Durable per-data-root admission for recent Blooket mutation starts.
// - Must-Not:
//   - Execute provider writes, retry attempts, or access credentials.
// - Allows:
//   - Inputs: An application-owned file path and bounded pacing policy.
//   - Outputs: A durably reserved start or conservative wait duration.
//   - Side effects: Exclusive lock and atomically stored timestamps.
// - Split-When:
//   - Independent Blooket account roots need separate pacing identities.
// - Merge-When:
//   - The application no longer needs pacing across service restarts.
// - Summary:
//   - Keeps rolling start history safe across restarts and concurrent writers.
// - Description:
//   - Unsafe, corrupt, and rolled-back clocks fail before remote mutation.
// - Usage:
//   - Reserve while holding the shared in-process pacer lease.
// - Defaults:
//   - A successful reservation counts even if the later mutation is stopped.
//
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";
import { writeAtomicFile } from
  "../../atomic-files/adapter-outbound/atomic-file.ts";
import { exactOwnData } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";

const MAX_FILE_BYTES = 4_096;
const WINDOW_MS = 60_000;
const FIELDS = ["schemaVersion", "lastStartMs", "starts"];

export interface DurableMutationStartPolicy {
  readonly minimumStartIntervalMs: number;
  readonly maximumStartsPerMinute: number;
}

export type DurableMutationStartAdmission =
  | { readonly kind: "admitted" }
  | { readonly kind: "wait"; readonly waitMs: number };

/** Reserve before opening a mutation journal. Refuse all uncertain storage. */
export async function reserveDurableMutationStart(
  path: string,
  policy: DurableMutationStartPolicy,
  now: () => number = Date.now,
): Promise<DurableMutationStartAdmission> {
  // Own the caller's policy before filesystem I/O. Never run getters or
  // allow a caller to mutate limits after the lock is acquired.
  const owned = exactOwnData(policy,
    ["minimumStartIntervalMs", "maximumStartsPerMinute"]);
  if (!owned) throw Error("mutation-pacing-history-unavailable");
  const fixed = {
    minimumStartIntervalMs: owned["minimumStartIntervalMs"] as number,
    maximumStartsPerMinute: owned["maximumStartsPerMinute"] as number,
  };
  const owner = await tryAcquireFileLock(path + ".lock");
  if (!owner.ok) throw Error("mutation-pacing-history-unavailable");
  try {
    return await reserveLocked(path, fixed, now);
  } finally {
    await owner.lock.release();
  }
}

async function reserveLocked(
  path: string, policy: DurableMutationStartPolicy,
  now: () => number,
): Promise<DurableMutationStartAdmission> {
  try {
    if (!Number.isSafeInteger(policy.minimumStartIntervalMs) ||
        policy.minimumStartIntervalMs < 2_000 ||
        policy.minimumStartIntervalMs > WINDOW_MS ||
        !Number.isSafeInteger(policy.maximumStartsPerMinute) ||
        policy.maximumStartsPerMinute < 1 ||
        policy.maximumStartsPerMinute > 20)
      throw Error("mutation-pacing-history-invalid");
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0)
      throw Error("mutation-pacing-history-clock-invalid");
    const history = await readHistory(path);
    if (history && timestamp < history.lastStartMs)
      throw Error("mutation-pacing-history-clock-invalid");
    const starts = (history?.starts ?? []).filter(start =>
      start > timestamp - WINDOW_MS);
    const last = starts.at(-1);
    const nextInterval = last === undefined
      ? timestamp : last + policy.minimumStartIntervalMs;
    const earliestInWindow = starts.length < policy.maximumStartsPerMinute
      ? timestamp
      : starts[starts.length - policy.maximumStartsPerMinute]! + WINDOW_MS;
    const waitMs = Math.max(nextInterval, earliestInWindow) - timestamp;
    if (waitMs > 0) return { kind: "wait", waitMs };
    const state = { schemaVersion: 1, lastStartMs: timestamp,
      starts: [...starts, timestamp] };
    await writeAtomicFile(path, JSON.stringify(state) + "\n");
    return { kind: "admitted" };
  } catch {
    throw Error("mutation-pacing-history-unavailable");
  }
}

interface StoredHistory {
  readonly lastStartMs: number;
  readonly starts: readonly number[];
}

async function readHistory(path: string): Promise<StoredHistory | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error &&
        error.code === "ENOENT") return null;
    throw Error("mutation-pacing-history-unavailable");
  }
  let data = "";
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 ||
        (stat.mode & 0o022) !== 0 || stat.size < 2 ||
        stat.size > MAX_FILE_BYTES)
      throw Error("mutation-pacing-history-invalid");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const part = await handle.read(buffer, length,
        buffer.length - length, null);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    const after = await handle.stat();
    if (length > MAX_FILE_BYTES || length !== stat.size ||
        !after.isFile() || after.nlink !== 1 ||
        (after.mode & 0o022) !== 0 ||
        after.dev !== stat.dev || after.ino !== stat.ino ||
        after.size !== stat.size || after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs)
      throw Error("mutation-pacing-history-invalid");
    data = buffer.subarray(0, length).toString("utf8");
  } finally { await handle.close(); }
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("mutation-pacing-history-invalid");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== FIELDS.length ||
      FIELDS.some(field => !Object.hasOwn(record, field)) ||
      record["schemaVersion"] !== 1 ||
      !Number.isSafeInteger(record["lastStartMs"]) ||
      (record["lastStartMs"] as number) < 0 ||
      !Array.isArray(record["starts"]) ||
      record["starts"].length < 1 || record["starts"].length > 20)
    throw Error("mutation-pacing-history-invalid");
  const starts = record["starts"] as unknown[];
  if (starts.some((v, i) => !Number.isSafeInteger(v) ||
      (v as number) < 0 || (i > 0 &&
      (v as number) < (starts[i - 1] as number))) ||
      starts.at(-1) !== record["lastStartMs"])
    throw Error("mutation-pacing-history-invalid");
  // Exact serializer order matters: a reordered or repeated field cannot
  // stand in for the adapter's own previous reservation record.
  const canonical = JSON.stringify({
    schemaVersion: 1,
    lastStartMs: record["lastStartMs"],
    starts,
  }) + "\n";
  if (canonical !== data) throw Error("mutation-pacing-history-invalid");
  return {
    lastStartMs: record["lastStartMs"] as number,
    starts: starts as number[],
  };
}
