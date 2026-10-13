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
import assert from "node:assert/strict";
import test from "node:test";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeServiceSupervisorReady } from
  "../../../../src/ir/application-updates/contract/supervision.ts";
import { decodeServiceRuntime } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/runtime.ts";
import { loadPreferences, savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import { acquireCanonicalDataUpdateBoundary } from
  "../../../../src/platforms/user-storage/adapter-outbound/writer-boundary.ts";

const supervisor = new URL(
  "../../../../src/service/background-service/adapter-inbound/supervisor.ts",
  import.meta.url);
function environment(root: string) {
  return { PATH: process.env["PATH"], HOME: process.env["HOME"],
    XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
    DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
    BLOOKET_DATA_HOME: root };
}
async function cleanup(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, child.connected ? "close" : "exit");
  child.kill("SIGTERM");
  await closed;
}
async function settings(root: string) {
  const preferences = await loadPreferences(root);
  await savePreferences(root, { ...preferences,
    service: { ...preferences.service, portMode: "automatic", port: 1 } });
}

test("supervisor retains its service after the launcher disconnects",
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "independent-supervisor-"));
    await settings(root);
    await writeFile(join(root, "data-marker"), "teacher-owned-data");
    const child = fork(supervisor, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"], env: environment(root),
    });
    try {
      const ready = decodeServiceSupervisorReady(
        (await once(child, "message"))[0]);
      assert.ok(ready);
      assert.equal(ready.pid, child.pid);
      const runtime = decodeServiceRuntime(ready.runtime);
      assert.notEqual(runtime.pid, child.pid);
      const disconnected = once(child, "disconnect");
      child.disconnect();
      await disconnected;
      assert.equal((await fetch(runtime.origin + "/api/service-status")).status,
        200);
      assert.equal(child.exitCode, null);
      assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root), {
        ok: false, reason: "writer-active",
      });
      // This test has deliberately detached the launcher's IPC channel.
      // Observe supervisor exit; service-drain proof still requires the owned
      // service's private receipt and close inside the supervisor itself.
      const closed = once(child, "exit");
      // The supervisor sends a private drained-stop challenge. The actual
      // service never receives a process-kill fallback.
      child.kill("SIGTERM");
      assert.deepEqual(await closed, [0, null]);
      assert.equal(await readFile(join(root, "data-marker"), "utf8"),
        "teacher-owned-data");
      await assert.rejects(readFile(join(root, "service-runtime.json")));
      await assert.rejects(readFile(join(root, ".service.lock")));
      const boundary = await acquireCanonicalDataUpdateBoundary(root);
      assert.equal(boundary.ok, true);
      if (boundary.ok) await boundary.release();
    } finally {
      await cleanup(child);
      await rm(root, { recursive: true, force: true });
    }
  });

test("UI shutdown completes through the supervisor's owned service channel",
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "supervisor-ui-stop-"));
    await settings(root);
    const child = fork(supervisor, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"], env: environment(root),
    });
    try {
      const ready = decodeServiceSupervisorReady(
        (await once(child, "message"))[0]);
      assert.ok(ready);
      const runtime = decodeServiceRuntime(ready.runtime);
      const boot = await (await fetch(
        runtime.origin + "/api/bootstrap")).json();
      const closed = once(child, "close");
      const response = await fetch(runtime.origin + "/api/service-stop", {
        method: "POST", headers: { Origin: runtime.origin,
          "Content-Type": "application/json", "X-CSRF-Token": boot.csrf },
        body: "{}",
      });
      assert.equal(response.status, 202);
      assert.deepEqual(await closed, [0, null]);
      const boundary = await acquireCanonicalDataUpdateBoundary(root);
      assert.equal(boundary.ok, true);
      if (boundary.ok) await boundary.release();
    } finally {
      await cleanup(child);
      await rm(root, { recursive: true, force: true });
    }
  });

test("supervisor without launcher IPC cannot create service data",
  { timeout: 10_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "supervisor-no-parent-"));
    const child = spawn(process.execPath, [supervisor.pathname], {
      stdio: "ignore", env: environment(root),
    });
    try {
      assert.deepEqual(await once(child, "close"), [1, null]);
      assert.deepEqual(await readdir(root), []);
    } finally {
      await cleanup(child);
      await rm(root, { recursive: true, force: true });
    }
  });
