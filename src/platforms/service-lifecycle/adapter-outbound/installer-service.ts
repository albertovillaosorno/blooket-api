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
//   - Silent installer-owned service startup, health and drained shutdown.
// - Must-Not:
//   - Install bundles, authenticate publishers, release fences, or open
//     Terminal.
// - Allows:
//   - Inputs: Trusted assessed bundle facts and a held local data capability.
//   - Outputs: Fresh child health or retained startup/shutdown uncertainty.
//   - Side effects: One private IPC child and bounded lifecycle challenges.
// - Split-When:
//   - Independent installer supervision needs process handoff or recovery.
// - Merge-When:
//   - Normal and installer supervision share the same startup authority.
// - Summary:
//   - Keeps the actual child after deadlines and refuses duplicate startup.
// - Description:
//   - Startup readiness does not prove health or completed native drainage.
// - Usage:
//   - Compose inside the independent installer after bundle assessment.
// - Defaults:
//   - Unknown ownership and stopped-state uncertainty preserve the child.
//
import { spawn, type ChildProcess, type SpawnOptions } from
  "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { decodeProductVersion } from
  "../../../ir/product-version/contract/version.ts";
import { decodeUpdateHealthRequest, decodeUpdateHealthResponse } from
  "../../../ir/application-updates/contract/health.ts";
import { decodeUpdateStartupReady } from
  "../../../ir/application-updates/contract/startup.ts";
import { BUNDLE_NAME, directoryIdentity, identityAdmitted, pathAdmitted,
  sameIdentity, type DirectoryIdentity } from
  "../../bundle-exchange/adapter-outbound/identity.ts";
import { authorizeCanonicalServiceStartup, canonicalDataUpdateBoundaryOwned,
  type CanonicalDataBoundary } from
  "../../user-storage/adapter-outbound/writer-boundary.ts";
import { decodeServiceRuntime, type LocalServiceRuntime } from "./runtime.ts";
import { probeOwnedServiceHealth, type OwnedServiceHealth } from "./health.ts";
import { requestOwnedServiceStop, type OwnedServiceStopObservation } from
  "./stop.ts";

export interface InstallerServiceTarget {
  readonly bundlePath: string;
  readonly identity: DirectoryIdentity;
  readonly version: string;
}
interface Options {
  readonly timeoutMs?: number;
  // Trusted composition/test substitution only; never an HTTP/MCP payload.
  readonly launch?: (file: string, args: readonly string[],
    options: SpawnOptions) => ChildProcess;
}
interface OwnedChild {
  readonly child: ChildProcess;
  readonly target: InstallerServiceTarget;
  readonly stopNonce: string;
  readonly startup: Promise<LocalServiceRuntime | undefined>;
  runtime?: LocalServiceRuntime;
  runtimeVersion?: string;
  stop?: Promise<OwnedServiceStopObservation>;
}

export function createInstallerServiceManager(root: string,
  boundary: CanonicalDataBoundary, options: Options = {}) {
  const timeout = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10_000 ||
      !pathAdmitted(root)) throw Error("invalid-installer-service-options");
  let owned: OwnedChild | undefined;
  let pending = Promise.resolve();
  function admit<T>(work: () => Promise<T>): Promise<T> {
    const next = pending.then(work);
    pending = next.then(() => {}, () => {});
    return next;
  }
  return {
    startAndCheck(value: InstallerServiceTarget, nonce: string,
      signal?: AbortSignal): Promise<OwnedServiceHealth> {
      const unavailable: OwnedServiceHealth = { status: "unavailable" };
      let target: InstallerServiceTarget;
      try {
        decodeProductVersion(value.version);
        if (!pathAdmitted(value.bundlePath) ||
            basename(value.bundlePath) !== BUNDLE_NAME ||
            !identityAdmitted(value.identity) ||
            !decodeUpdateHealthRequest({ kind: "update-health-request",
              nonce }))
          return Promise.resolve(unavailable);
        target = { bundlePath: value.bundlePath, version: value.version,
          identity: { ...value.identity } };
      } catch { return Promise.resolve(unavailable); }
      return admit(async () => {
        try {
          if (signal?.aborted ||
              !await canonicalDataUpdateBoundaryOwned(boundary, root) ||
              !sameIdentity(target.identity,
                await directoryIdentity(target.bundlePath)))
            return unavailable;
          if (owned && (owned.stop ||
              JSON.stringify(owned.target) !== JSON.stringify(target)))
            return unavailable;
          if (!owned) {
            const resources = join(target.bundlePath, "Contents/Resources");
            const file = join(resources, "runtime/node");
            const entry = join(resources,
              "app/src/service/background-service/adapter-inbound/main.ts");
            for (const path of [file, entry]) {
              const info = await lstat(path);
              if (!info.isFile() || (info.mode & 0o022) !== 0 ||
                  await realpath(path) !== path ||
                  (path === file && (info.mode & 0o111) === 0))
                return unavailable;
            }
            if (signal?.aborted ||
                !await canonicalDataUpdateBoundaryOwned(boundary, root) ||
                !sameIdentity(target.identity,
                  await directoryIdentity(target.bundlePath)))
              return unavailable;
            const child = (options.launch ?? ((file, args, spawnOptions) =>
              spawn(file, [...args], spawnOptions)))(file,
            [entry, "--installer-child"], { shell: false,
              stdio: ["ignore", "ignore", "ignore", "ipc"],
              env: { PATH: process.env["PATH"], HOME: process.env["HOME"],
                XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
                DBUS_SESSION_BUS_ADDRESS:
                  process.env["DBUS_SESSION_BUS_ADDRESS"],
                BLOOKET_DATA_HOME: root } });
            owned = { child, target, stopNonce: randomUUID(),
              startup: observeStartup(child, boundary) };
            const captured = owned;
            void captured.startup.then(runtime => {
              if (runtime) captured.runtime = runtime;
            });
          }
          const captured = owned;
          const runtime = captured.runtime ?? await observeDeadline(
            captured.startup, timeout, signal);
          if (!runtime || signal?.aborted) return unavailable;
          captured.runtime = runtime;
          return await checkHealth(captured, runtime, nonce, timeout, signal);
        } catch { return unavailable; }
      });
    },
    stop(): Promise<OwnedServiceStopObservation> {
      return admit(async () => {
        const captured = owned;
        if (!captured) return { status: "stopped" };
        captured.stop ??= (async (): Promise<OwnedServiceStopObservation> => {
          const runtime = captured.runtime ?? await observeDeadline(
            captured.startup, timeout);
          if (!runtime) {
            // Startup observation is still owned after its deadline. Never
            // infer stopped from timeout, disconnect or a failed readiness.
            return { status: "pending", completion: captured.startup.then(
              async late => late ? await finishStop(captured, late)
                : { status: "unavailable" as const }) };
          }
          if (!captured.runtimeVersion)
            await checkHealth(captured, runtime, randomUUID(), timeout);
          return await requestOwnedServiceStop(captured.child, runtime,
            captured.runtimeVersion ?? captured.target.version,
            captured.stopNonce,
            { timeoutMs: timeout });
        })();
        const result = await captured.stop;
        const completed = result.status === "pending"
          ? result.completion : Promise.resolve(result);
        void completed.then(proof => {
          if (proof.status === "stopped" && owned === captured)
            owned = undefined;
        });
        return result;
      });
    },
  };
}

async function finishStop(captured: OwnedChild, runtime: LocalServiceRuntime) {
  if (!captured.runtimeVersion)
    await checkHealth(captured, runtime, randomUUID(), 5_000);
  const observed = await requestOwnedServiceStop(captured.child, runtime,
    captured.runtimeVersion ?? captured.target.version, captured.stopNonce);
  return observed.status === "pending" ? await observed.completion : observed;
}

async function checkHealth(captured: OwnedChild, runtime: LocalServiceRuntime,
  nonce: string, timeout: number, signal?: AbortSignal) {
  // A packaged version mismatch fails health, but the owned child's exact
  // fresh reply still identifies its version for safe shutdown. Never use it
  // to admit the candidate as the expected version or to trust a foreign child.
  const versionOf = (value: unknown) => {
    const reply = decodeUpdateHealthResponse(value);
    if (reply && reply.nonce === nonce && reply.instance === runtime.instance &&
        reply.pid === captured.child.pid && captured.child.connected &&
        captured.child.exitCode === null && captured.child.signalCode === null)
      captured.runtimeVersion = reply.version;
  };
  captured.child.on("message", versionOf);
  try {
    return await probeOwnedServiceHealth(captured.child, runtime,
      captured.target.version, nonce, { timeoutMs: timeout,
        ...(signal ? { signal } : {}) });
  } finally { captured.child.removeListener("message", versionOf); }
}

function observeStartup(child: ChildProcess, boundary: CanonicalDataBoundary):
  Promise<LocalServiceRuntime | undefined> {
  return new Promise(resolve => {
    let state: "ready" | "authorizing" | "runtime" = "ready";
    let settled = false;
    const finish = (runtime?: LocalServiceRuntime) => {
      if (settled) return;
      settled = true;
      child.removeListener("message", receive);
      child.removeListener("close", stopped);
      resolve(runtime);
    };
    const stopped = () => finish();
    const receive = (value: unknown) => {
      if (state === "ready") {
        if (decodeUpdateStartupReady(value) !== child.pid) { finish(); return; }
        state = "authorizing";
        void (async () => {
          const request = await authorizeCanonicalServiceStartup(boundary,
            child);
          if (!request || settled) { finish(); return; }
          state = "runtime";
          child.send(request, error => { if (error) finish(); });
        })().catch(() => finish());
      } else if (state === "runtime") {
        try {
          const runtime = decodeServiceRuntime(value);
          finish(runtime.pid === child.pid ? Object.freeze(runtime)
            : undefined);
        } catch { finish(); }
      } else finish();
    };
    child.on("message", receive);
    child.once("close", stopped);
    child.on("error", stopped);
    child.once("close", () => child.removeListener("error", stopped));
  });
}

function observeDeadline<T>(operation: Promise<T>, timeout: number,
  signal?: AbortSignal): Promise<T | undefined> {
  return new Promise(resolve => {
    const finish = (value?: T) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stopped);
      resolve(value);
    };
    const stopped = () => finish();
    const timer = setTimeout(stopped, timeout);
    signal?.addEventListener("abort", stopped, { once: true });
    if (signal?.aborted) stopped();
    void operation.then(finish, stopped);
  });
}
