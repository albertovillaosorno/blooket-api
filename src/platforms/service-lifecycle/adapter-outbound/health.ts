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
//   - Private IPC health proof for an explicitly owned service process.
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
//   - Never treats startup messages or stale runtime files as fresh health.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import type { ChildProcess } from "node:child_process";
import { decodeUpdateHealthRequest, decodeUpdateHealthResponse } from
  "../../../ir/application-updates/contract/health.ts";
import { decodeProductVersion } from
  "../../../ir/product-version/contract/version.ts";
import { decodeServiceRuntime, type LocalServiceRuntime } from "./runtime.ts";

const pending = new WeakSet<ChildProcess>();
export type OwnedServiceHealth =
  | { readonly status: "healthy"; readonly nonce: string;
      readonly version: string }
  | { readonly status: "unavailable" };

// The installer supplies the ChildProcess it actually spawned and its exact
// startup runtime. An arbitrary PID, runtime file or HTTP server cannot supply
// this private parent-child IPC channel. Health does not release writer fences.
export async function probeOwnedServiceHealth(child: ChildProcess,
  observed: LocalServiceRuntime, version: string, nonce: string,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
): Promise<OwnedServiceHealth> {
  const unavailable: OwnedServiceHealth = { status: "unavailable" };
  let runtime: LocalServiceRuntime;
  try {
    runtime = Object.freeze({ ...decodeServiceRuntime(observed) });
    decodeProductVersion(version);
  } catch { return unavailable; }
  const request = { kind: "update-health-request", nonce };
  const timeout = options.timeoutMs ?? 5_000;
  const signal = options.signal;
  if (!decodeUpdateHealthRequest(request) || child.pid !== runtime.pid ||
      !child.connected || child.exitCode !== null ||
      child.signalCode !== null || pending.has(child) || signal?.aborted ||
      !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10_000)
    return unavailable;
  pending.add(child);
  return await new Promise<OwnedServiceHealth>(resolve => {
    let settled = false;
    const finish = (result: OwnedServiceHealth) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("message", onMessage);
      child.removeListener("exit", stopped);
      child.removeListener("disconnect", stopped);
      child.removeListener("error", stopped);
      signal?.removeEventListener("abort", stopped);
      pending.delete(child);
      resolve(result);
    };
    const stopped = () => finish(unavailable);
    const onMessage = (value: unknown) => {
      // Ordinary startup or unrelated IPC messages are not health receipts.
      if (!value || typeof value !== "object" ||
          !("kind" in value) || value.kind !== "update-health-response") return;
      const reply = decodeUpdateHealthResponse(value);
      if (!reply || reply.nonce !== nonce ||
          reply.instance !== runtime.instance ||
          reply.pid !== child.pid || reply.version !== version ||
          reply.status !== "healthy" || !child.connected ||
          child.exitCode !== null || child.signalCode !== null) {
        finish(unavailable);
        return;
      }
      finish({ status: "healthy", version: reply.version, nonce: reply.nonce });
    };
    const timer = setTimeout(stopped, timeout);
    child.on("message", onMessage);
    child.once("exit", stopped);
    child.once("disconnect", stopped);
    child.once("error", stopped);
    signal?.addEventListener("abort", stopped, { once: true });
    try { child.send(request, error => { if (error) stopped(); }); }
    catch { stopped(); }
  });
}

// Installed only on the process's existing private IPC channel. No public
// HTTP health/challenge endpoint, settings field, CLI or MCP tool is added.
export function installServiceHealthResponder(observed: LocalServiceRuntime,
  version: string, isReady: () => boolean): () => void {
  const runtime = Object.freeze({ ...decodeServiceRuntime(observed) });
  decodeProductVersion(version);
  if (!process.send || !process.connected || runtime.pid !== process.pid)
    return () => {};
  let active = false, disposed = false;
  const dispose = () => {
    disposed = true;
    process.removeListener("message", receive);
    process.removeListener("disconnect", dispose);
  };
  const receive = (value: unknown) => {
    const nonce = decodeUpdateHealthRequest(value);
    if (nonce === undefined || active || disposed) return;
    active = true;
    void (async () => {
      try {
        const healthy = isReady() && await freshRuntime(runtime) && isReady();
        if (disposed || !process.connected) return;
        process.send?.({ kind: "update-health-response", nonce,
          status: healthy ? "healthy" : "unavailable", version,
          instance: runtime.instance, pid: process.pid }, () => {});
      } catch {
        // Missing proof is a timeout/failure for the owner, never success.
      } finally { active = false; }
    })();
  };
  process.on("message", receive);
  process.once("disconnect", dispose);
  return dispose;
}

async function freshRuntime(runtime: LocalServiceRuntime): Promise<boolean> {
  try {
    const response = await fetch(runtime.origin + "/api/service-status", {
      redirect: "error", signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 4_096) return false;
        parts.push(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const current = decodeServiceRuntime(JSON.parse(
      Buffer.concat(parts).toString("utf8"),
    ));
    return JSON.stringify(current) === JSON.stringify(runtime);
  } catch { return false; }
}
