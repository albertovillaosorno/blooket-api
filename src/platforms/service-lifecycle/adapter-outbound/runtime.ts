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
//   - Validated local instance discovery for explicit launch and stop.
// - Must-Not:
//   - Expose secrets or trust unvalidated host configuration.
// - Allows:
//   - Inputs: Explicit host configuration and bounded lifecycle inputs.
//   - Outputs: Validated local status, artifacts, or stable failure codes.
//   - Side effects: Owned filesystem, process, or browser operations.
// - Split-When:
//   - Host admission needs an independent platform boundary.
// - Merge-When:
//   - This host capability no longer needs a separate boundary.
// - Summary:
//   - Keeps explicit host operations outside product semantics.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  object,
  exact,
} from "../../../media/library-metadata/domain/metadata.ts";

// A detached service may exit as a Linux zombie before the container's
// init process reaps it. kill(pid, 0) still succeeds for that dead process;
// combine this observation with the launcher's independent lock/port checks.
export function isTerminatedLinuxProcessStat(
  source: string, pid: number,
): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1 ||
      !source.startsWith(String(pid) + " (")) return false;
  const end = source.lastIndexOf(") ");
  if (end < 0 || end + 4 >= source.length) return false;
  const state = source[end + 2];
  return (state === "Z" || state === "X" || state === "x") &&
    source[end + 3] === " ";
}

export async function serviceProcessExited(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); }
  catch (error) {
    return error instanceof Error && "code" in error &&
      error.code === "ESRCH";
  }
  if (process.platform !== "linux") return false;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return isTerminatedLinuxProcessStat(stat, pid);
  } catch { return false; }
}

export interface LocalServiceRuntime {
  readonly version: 1;
  readonly pid: number;
  readonly instance: string;
  readonly origin: string;
}
export function decodeServiceRuntime(value: unknown): LocalServiceRuntime {
  const record = object(value);
  exact(record, ["version", "pid", "instance", "origin"]);
  if (
    record["version"] !== 1 ||
    typeof record["pid"] !== "number" ||
    !Number.isSafeInteger(record["pid"]) ||
    record["pid"] < 1 ||
    typeof record["instance"] !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(
      record["instance"],
    ) ||
    typeof record["origin"] !== "string"
  )
    throw new Error("invalid-service-runtime");
  const url = new URL(record["origin"]);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "127.0.0.2", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.origin !== record["origin"]
  )
    throw new Error("invalid-service-runtime");
  return record as unknown as LocalServiceRuntime;
}
export async function existingService(root: string) {
  try {
    const bytes = await readOwnedRuntime(join(root, "service-runtime.json"));
    const expected = decodeServiceRuntime(JSON.parse(bytes));
    const response = await fetch(expected.origin + "/api/service-status", {
      signal: AbortSignal.timeout(1500),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const body = await boundedResponseText(response, 4096);
    if (body === undefined) return undefined;
    const current = decodeServiceRuntime(JSON.parse(body));
    return JSON.stringify(current) === JSON.stringify(expected)
      ? expected
      : undefined;
  } catch {
    return undefined;
  }
}

const MAX_RUNTIME_BYTES = 4_096;

async function readOwnedRuntime(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) ||
        stat.size > MAX_RUNTIME_BYTES)
      throw new Error("service-runtime-unsafe");
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    let complete = false;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, null);
      if (read.bytesRead === 0) {
        complete = true;
        break;
      }
      size += read.bytesRead;
    }
    const after = await handle.stat();
    if (!complete || stat.size !== after.size ||
        stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs)
      throw new Error("service-runtime-unsafe");
    return bytes.subarray(0, size).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function boundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      maxBytes > 128_000) throw new Error("invalid-response-byte-limit");
  const declared = response.headers.get("content-length");
  if (declared !== null && /^[0-9]+$/u.test(declared) &&
      Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const stream = response.body;
  if (stream === null) return undefined;
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) return text + decoder.decode();
      bytes += part.value.byteLength;
      if (bytes > maxBytes) return undefined;
      text += decoder.decode(part.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
