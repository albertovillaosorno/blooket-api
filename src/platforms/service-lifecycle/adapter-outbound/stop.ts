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
//   - Private IPC drained shutdown for an explicitly owned service process.
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
//   - Requires a drained receipt and final process closure before replacement.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import type { ChildProcess } from "node:child_process";
import { decodeUpdateStopRequest, decodeUpdateStopResponse } from
  "../../../ir/application-updates/contract/stop.ts";
import { decodeProductVersion } from
  "../../../ir/product-version/contract/version.ts";
import { decodeServiceRuntime, type LocalServiceRuntime } from "./runtime.ts";

export type OwnedServiceStop = { readonly status: "stopped" }
  | { readonly status: "unavailable" };
export type OwnedServiceStopObservation = OwnedServiceStop | {
  readonly status: "pending";
  readonly completion: Promise<OwnedServiceStop>;
};
const pending = new WeakMap<ChildProcess, {
  readonly identity: string;
  readonly observation: Promise<OwnedServiceStopObservation>;
}>();

// Only the actual child capability retained by the installer grants authority.
// A deadline/cancellation retains owned pending completion. It cannot prove
// quiescence or authorize replacement.
// The caller must retain all fences until completion and require stopped proof.
// Do not kill, disconnect, release a lock or replay from a pending observation.
export function requestOwnedServiceStop(child: ChildProcess,
  observed: LocalServiceRuntime, version: string, nonce: string,
  options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
): Promise<OwnedServiceStopObservation> {
  const unavailable: OwnedServiceStop = { status: "unavailable" };
  let runtime: LocalServiceRuntime;
  try {
    runtime = Object.freeze({ ...decodeServiceRuntime(observed) });
    decodeProductVersion(version);
  } catch { return Promise.resolve(unavailable); }
  const request = { kind: "update-stop-request", nonce,
    instance: runtime.instance };
  const timeout = options.timeoutMs ?? 5_000;
  const signal = options.signal;
  if (!decodeUpdateStopRequest(request) || child.pid !== runtime.pid ||
      !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10_000)
    return Promise.resolve(unavailable);
  const identity = JSON.stringify({ runtime, version, nonce });
  const existing = pending.get(child);
  if (existing) return existing.identity === identity
    ? existing.observation : Promise.resolve(unavailable);
  if (!child.connected || child.exitCode !== null ||
      child.signalCode !== null || signal?.aborted)
    return Promise.resolve(unavailable);
  const observation = Promise.withResolvers<OwnedServiceStopObservation>();
  const completion = Promise.withResolvers<OwnedServiceStop>();
  pending.set(child, { identity, observation: observation.promise });
  let acknowledged = false, failed = false, closed = false;
  const reportPending = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", reportPending);
    observation.resolve({ status: "pending", completion: completion.promise });
  };
  const onMessage = (value: unknown) => {
    if (!value || typeof value !== "object" || !("kind" in value) ||
        value.kind !== "update-stop-response") return;
    const reply = decodeUpdateStopResponse(value);
    if (!reply || reply.nonce !== nonce ||
        reply.instance !== runtime.instance || reply.pid !== runtime.pid ||
        reply.version !== version || reply.status !== "drained") {
      failed = true;
      return;
    }
    acknowledged = true;
  };
  const onError = () => { failed = true; };
  const onClose = (code: number | null, receivedSignal: string | null) => {
    closed = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", reportPending);
    child.removeListener("message", onMessage);
    child.removeListener("error", onError);
    child.removeListener("close", onClose);
    const result: OwnedServiceStop = acknowledged && !failed && code === 0 &&
      receivedSignal === null ? { status: "stopped" } : unavailable;
    completion.resolve(result);
    observation.resolve(result);
    // Keep the settled receipt on this exact child: a later caller cannot
    // reuse its PID or send another stop, and release never races a new child.
  };
  const timer = setTimeout(reportPending, timeout);
  child.on("message", onMessage);
  child.on("error", onError);
  child.once("close", onClose);
  signal?.addEventListener("abort", reportPending, { once: true });
  try {
    child.send(request, error => {
      if (error && !closed) { failed = true; reportPending(); }
    });
  } catch { failed = true; reportPending(); }
  return observation.promise;
}

// The responder is private process IPC, not an HTTP/MCP shutdown tool.
// stop must drain every managed writer, including online canonical children.
export function installServiceStopResponder(observed: LocalServiceRuntime,
  version: string, stop: () => Promise<void>): () => void {
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
    const request = decodeUpdateStopRequest(value);
    if (!request || request.instance !== runtime.instance || active || disposed)
      return;
    active = true;
    void (async () => {
      let status: "drained" | "unavailable" = "drained";
      try { await stop(); }
      catch { status = "unavailable"; process.exitCode = 1; }
      if (disposed || !process.connected) return;
      const disconnect = () => {
        dispose();
        if (process.connected) process.disconnect?.();
      };
      try {
        process.send?.({ kind: "update-stop-response", nonce: request.nonce,
          status, version, instance: runtime.instance, pid: process.pid },
        disconnect);
      } catch { disconnect(); }
    })();
  };
  process.on("message", receive);
  process.once("disconnect", dispose);
  return dispose;
}
