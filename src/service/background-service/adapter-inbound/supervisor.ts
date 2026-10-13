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
//   - Independent silent lifetime and private IPC ownership of the service.
// - Must-Not:
//   - Install apps, infer native completion, kill writers, or open Terminal.
// - Allows:
//   - Inputs: Its actual launcher parent and exact owned service IPC.
//   - Outputs: Fresh owned readiness or retained failure state.
//   - Side effects: One directly spawned local service and private challenges.
// - Split-When:
//   - Installation composition needs its own preparation/recovery boundary.
// - Merge-When:
//   - The service itself can safely own its replacement lifetime.
// - Summary:
//   - Keeps the service child capability after the launcher exits.
// - Description:
//   - Signals and deadlines never prove drainage or authorize replacement.
// - Usage:
//   - Spawn from the installed launcher with private IPC and ignored stdio.
// - Defaults:
//   - Unknown startup and failed drainage retain their actual child ownership.
//
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { userDataRoot } from
  "../../../platforms/user-storage/adapter-outbound/root.ts";
import { decodeServiceRuntime, type LocalServiceRuntime } from
  "../../../platforms/service-lifecycle/adapter-outbound/runtime.ts";
import { probeOwnedServiceHealth } from
  "../../../platforms/service-lifecycle/adapter-outbound/health.ts";
import { requestOwnedServiceStop } from
  "../../../platforms/service-lifecycle/adapter-outbound/stop.ts";
import { decodeServiceDrainNotice } from
  "../../../ir/application-updates/contract/supervision.ts";
import { PRODUCT_VERSION } from
  "../../../ir/product-version/contract/version.ts";

// This internal entrypoint is not an external shell/CLI/MCP capability.
if (!process.connected || typeof process.send !== "function" ||
    process.argv.slice(2).length !== 0) {
  process.exitCode = 1;
} else {
  const root = userDataRoot();
  const child = spawn(process.execPath, [fileURLToPath(
    new URL("./main.ts", import.meta.url))], {
    shell: false, stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { PATH: process.env["PATH"], HOME: process.env["HOME"],
      XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
      DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
      BLOOKET_DATA_HOME: root },
  });
  let runtime: LocalServiceRuntime | undefined;
  let initial = true, announced = false, shutdownRequested = false;
  let stopping: Promise<void> | undefined;
  const stopNonce = randomUUID();
  function unavailable() {
    if (announced) return;
    announced = true;
    if (process.connected) process.send?.({
      kind: "service-supervisor-unavailable", version: 1, pid: process.pid,
    }, () => {});
  }
  const stop = () => {
    shutdownRequested = true;
    if (!runtime) return;
    stopping ??= (async () => {
      const observed = await requestOwnedServiceStop(child, runtime!,
        PRODUCT_VERSION, stopNonce);
      // A bounded observation may end while the actual owned writer drains.
      // Keep this independent supervisor and private channel until completion.
      const completed = observed.status === "pending"
        ? await observed.completion : observed;
      if (completed.status !== "stopped") process.exitCode = 1;
    })().catch(() => { process.exitCode = 1; });
  };
  child.on("message", (value: unknown) => {
    if (initial) {
      initial = false;
      try {
        runtime = Object.freeze({ ...decodeServiceRuntime(value) });
        if (runtime.pid !== child.pid) throw Error("foreign-service");
      } catch { runtime = undefined; unavailable(); return; }
      void (async () => {
        const health = await probeOwnedServiceHealth(child, runtime!,
          PRODUCT_VERSION, randomUUID());
        if (health.status !== "healthy" || shutdownRequested) {
          unavailable();
          if (shutdownRequested) stop();
          return;
        }
        announced = true;
        if (process.connected) process.send?.({
          kind: "service-supervisor-ready", version: 1,
          pid: process.pid, runtime,
        }, () => {});
      })().catch(unavailable);
      if (shutdownRequested) stop();
      return;
    }
    const notice = decodeServiceDrainNotice(value);
    if (notice && runtime && notice.pid === child.pid &&
        notice.instance === runtime.instance) {
      // This notice triggers a fresh private stop challenge. It alone never
      // supplies the drained receipt or final child closure needed by updates.
      stop();
    }
  });
  child.on("error", unavailable);
  child.once("close", (code, signal) => {
    if (code !== 0 || signal !== null) process.exitCode = 1;
    unavailable();
    // Only this supervisor's launcher channel is disconnected here. The
    // service has actually closed, not merely exited or received a signal.
    if (process.connected) process.disconnect?.();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, stop);
  // The launcher's normal disconnect intentionally leaves the service child
  // and this supervisor alive. No new login item or persistence is installed.
}
