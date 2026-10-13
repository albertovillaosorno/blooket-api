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
//   - Bounded private parent-to-child installer startup receipt.
// - Must-Not:
//   - Accept public startup authority or expose confidential ownership tokens.
// - Allows:
//   - Inputs: The process's existing private parent IPC channel.
//   - Outputs: An exact captured request or refusal.
//   - Side effects: Bounded IPC observation only.
// - Split-When:
//   - Another startup transport requires separate authority.
// - Merge-When:
//   - Private lifecycle admission is owned by a single protocol adapter.
// - Summary:
//   - Receives startup admission without consulting arguments or environment.
// - Description:
//   - The data adapter independently authenticates held installation ownership.
// - Usage:
//   - Call before any installer child loads or saves teacher data.
// - Defaults:
//   - Missing IPC, disconnect, malformed messages and deadlines refuse startup.
//
import assert from "node:assert/strict";
import test from "node:test";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { decodeUpdateStartupReady } from
  "../../../../src/ir/application-updates/contract/startup.ts";
import { PRODUCT_VERSION } from
  "../../../../src/ir/product-version/contract/version.ts";
import { acquireCanonicalDataUpdateBoundary, authorizeCanonicalServiceStartup,
  acquireCanonicalInstallerServiceWriter } from
  "../../../../src/platforms/user-storage/adapter-outbound/writer-boundary.ts";
import { loadPreferences, savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import { probeOwnedServiceHealth } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/health.ts";
import { requestOwnedServiceStop } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/stop.ts";
import { decodeServiceRuntime } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/runtime.ts";

const entry = new URL(
  "../../../../src/service/background-service/adapter-inbound/main.ts",
  import.meta.url);
function environment(root: string) {
  return { PATH: process.env["PATH"], HOME: process.env["HOME"],
    XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
    DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
    BLOOKET_DATA_HOME: root };
}
function launch(root: string) {
  return fork(entry, ["--installer-child"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], env: environment(root),
  });
}
async function cleanup(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  // Only a failed test's own subprocess is eligible for this fallback.
  child.kill("SIGKILL");
  await closed;
}

test("owned installer child starts, proves health and drains behind data fence",
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "installer-startup-"));
    let child: ChildProcess | undefined;
    let boundary: Awaited<ReturnType<typeof acquireCanonicalDataUpdateBoundary>>
      | undefined;
    try {
      const preferences = await loadPreferences(root);
      await savePreferences(root, { ...preferences,
        service: { ...preferences.service, portMode: "automatic", port: 1 } });
      await writeFile(join(root, "teacher-marker"), "teacher-owned-data");
      boundary = await acquireCanonicalDataUpdateBoundary(root);
      assert.equal(boundary.ok, true);
      if (!boundary.ok) return;
      child = launch(root);
      assert.equal(decodeUpdateStartupReady((await once(child, "message"))[0]),
        child.pid);
      const request = await authorizeCanonicalServiceStartup(boundary, child);
      assert.ok(request);
      const ready = once(child, "message");
      child.send(request);
      const runtime = decodeServiceRuntime((await ready)[0]);
      const nonce = randomUUID();
      assert.deepEqual(await probeOwnedServiceHealth(child, runtime,
        PRODUCT_VERSION, nonce), { status: "healthy", version: PRODUCT_VERSION,
        nonce });
      assert.equal((await fetch(runtime.origin + "/api/bootstrap")).status,
        503);
      assert.equal((await fetch(runtime.origin + "/api/service-status")).status,
        200);
      await boundary.release();
      assert.equal(await authorizeCanonicalServiceStartup(boundary, child),
        undefined);
      assert.equal((await fetch(runtime.origin + "/api/bootstrap")).status,
        200);
      assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root), {
        ok: false, reason: "writer-active",
      });
      const observed = await requestOwnedServiceStop(child, runtime,
        PRODUCT_VERSION, randomUUID());
      const stopped = observed.status === "pending"
        ? await observed.completion : observed;
      assert.deepEqual(stopped, { status: "stopped" });
      assert.equal(await readFile(join(root, "teacher-marker"), "utf8"),
        "teacher-owned-data");
      boundary = await acquireCanonicalDataUpdateBoundary(root);
      assert.equal(boundary.ok, true);
    } finally {
      await cleanup(child);
      if (boundary?.ok) await boundary.release();
      await rm(root, { recursive: true, force: true });
    }
  });

test("foreign startup messages cannot initialize data or steal ownership",
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "installer-startup-refused-"));
    const boundary = await acquireCanonicalDataUpdateBoundary(root);
    assert.equal(boundary.ok, true);
    if (!boundary.ok) return;
    let child: ChildProcess | undefined;
    try {
      const marker = await readFile(join(root, ".canonical-installation.lock"));
      for (const change of [{ token: randomUUID() }, { ownerPid: 1 },
        { childPid: 1 }, { extra: true }]) {
        child = launch(root);
        assert.equal(decodeUpdateStartupReady(
          (await once(child, "message"))[0]), child.pid);
        assert.equal(await authorizeCanonicalServiceStartup({ ok: true,
          release: async () => undefined }, child), undefined);
        const request = await authorizeCanonicalServiceStartup(boundary, child);
        assert.ok(request);
        const closed = once(child, "close");
        child.send({ ...request, ...change });
        assert.deepEqual(await closed, [1, null]);
        assert.deepEqual(await readFile(
          join(root, ".canonical-installation.lock")), marker);
        assert.deepEqual(await readdir(join(root, ".canonical-writers")), []);
        await assert.rejects(readFile(join(root, "service-runtime.json")));
        await assert.rejects(readFile(join(root, "settings.json")));
      }
      assert.deepEqual(await acquireCanonicalInstallerServiceWriter(root, {
        kind: "update-startup-request", version: 1, ownerPid: process.ppid,
        childPid: process.pid, token: randomUUID(),
      }), { ok: false, reason: "busy" });
    } finally {
      await cleanup(child);
      await boundary.release();
      await rm(root, { recursive: true, force: true });
    }
  });

test("installer flag without private IPC cannot grant startup authority",
  { timeout: 10_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "installer-startup-no-ipc-"));
    const before = await readdir(root);
    const child = spawn(process.execPath, [entry.pathname, "--installer-child"],
      { stdio: "ignore", env: environment(root) });
    try {
      assert.deepEqual(await once(child, "close"), [1, null]);
      assert.deepEqual(await readdir(root), before);
    } finally {
      await cleanup(child);
      await rm(root, { recursive: true, force: true });
    }
  });

test("startup IPC deadlines and malformed messages clean up listeners",
  { timeout: 10_000 }, async () => {
    const module = new URL(
      "../../../../src/platforms/service-lifecycle/adapter-outbound/startup.ts",
      import.meta.url).href;
    for (const malformed of [false, true]) {
      const child = spawn(process.execPath, ["--input-type=module", "-e", `
        import { receiveInstallerServiceStartup }
          from ${JSON.stringify(module)};
        const request = await receiveInstallerServiceStartup(100);
        process.send({ accepted: !!request,
          messages: process.listenerCount('message'),
          disconnects: process.listenerCount('disconnect') },
        () => process.disconnect());
      `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
      try {
        const closed = once(child, "close");
        assert.equal(decodeUpdateStartupReady(
          (await once(child, "message"))[0]), child.pid);
        const result = once(child, "message");
        if (malformed) child.send({ kind: "unrelated-message" });
        assert.deepEqual((await result)[0], { accepted: false,
          messages: 0, disconnects: 0 });
        assert.deepEqual(await closed, [0, null]);
      } finally { await cleanup(child); }
    }
  });
