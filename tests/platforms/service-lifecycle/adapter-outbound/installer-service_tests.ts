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
//   - Actual installer service startup, health, shutdown and preservation
//     tests.
// - Must-Not:
//   - Use accounts, copy runtimes or infer native Apple bundle trust.
// - Allows:
//   - Inputs: Owned app-shape fixtures and the real repository service child.
//   - Outputs: Actual IPC health/closure and retained data assertions.
//   - Side effects: Automatic fixtures and silent repository subprocesses.
// - Split-When:
//   - Full installer supervision provides product transaction acceptance.
// - Merge-When:
//   - Production updater tests exercise these same startup boundaries.
// - Summary:
//   - Runs real service IPC behind actual held update admission.
// - Description:
//   - Only bundle launch location is substituted; lifecycle replies are real.
// - Usage:
//   - Validate before connecting the manager to independent installation.
// - Defaults:
//   - Failed tests may terminate only their own disposable child processes.
//
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInstallerServiceManager } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/service-lifecycle/adapter-outbound/installer-service.ts";
import { directoryIdentity } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/identity.ts";
import { acquireCanonicalDataUpdateBoundary, acquireCanonicalDataWriter,
  canonicalDataUpdateBoundaryOwned } from
  "../../../../src/platforms/user-storage/adapter-outbound/writer-boundary.ts";
import { loadPreferences, savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import { PRODUCT_VERSION } from
  "../../../../src/ir/product-version/contract/version.ts";
import type { OwnedServiceStopObservation } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/stop.ts";

async function finished(result: OwnedServiceStopObservation) {
  return result.status === "pending" ? await result.completion : result;
}
type ManagerOptions =
  NonNullable<Parameters<typeof createInstallerServiceManager>[2]>;
async function fixture(timeoutMs = 5_000,
  onStopped?: NonNullable<ManagerOptions["onStopped"]>) {
  const root = await mkdtemp(join(tmpdir(), "installer-service-"));
  const data = join(root, "teacher-data");
  const bundlePath = join(root, "Blooket API.app");
  const resources = join(bundlePath, "Contents/Resources");
  const entry = join(resources,
    "app/src/service/background-service/adapter-inbound/main.ts");
  await mkdir(join(resources, "runtime"), { recursive: true });
  await mkdir(join(entry, ".."), { recursive: true });
  await writeFile(join(resources, "runtime/node"), "fixture runtime only",
    { mode: 0o700 });
  await writeFile(entry, "fixture entry only; launch uses repository service");
  const preferences = await loadPreferences(data);
  await savePreferences(data, { ...preferences,
    service: { ...preferences.service, portMode: "automatic", port: 1 } });
  await writeFile(join(data, "teacher-marker"), "preserved teacher data");
  const boundary = await acquireCanonicalDataUpdateBoundary(data);
  assert.ok(boundary.ok);
  const target = { bundlePath, identity: await directoryIdentity(bundlePath),
    version: PRODUCT_VERSION };
  const children: ChildProcess[] = [];
  const launch: ManagerOptions["launch"] = (file, args, options) => {
    assert.equal(file, join(resources, "runtime/node"));
    assert.deepEqual(args, [entry, "--installer-child"]);
    assert.equal(options.shell, false);
    assert.deepEqual(options.stdio, ["ignore", "ignore", "ignore", "ipc"]);
    assert.equal(options.env?.["BLOOKET_DATA_HOME"], data);
    assert.deepEqual(Object.keys(options.env!).sort(), ["BLOOKET_DATA_HOME",
      "DBUS_SESSION_BUS_ADDRESS", "HOME", "PATH", "XDG_RUNTIME_DIR"]);
    const child = fork(new URL(
      "../../../../src/service/background-service/adapter-inbound/main.ts",
      import.meta.url), ["--installer-child"], options);
    children.push(child);
    return child;
  };
  const manager = createInstallerServiceManager(data, boundary,
    { timeoutMs, launch, ...(onStopped ? { onStopped } : {}) });
  return { root, data, boundary, target, children, manager, launch,
    async preserved() {
      assert.equal(await readFile(join(data, "teacher-marker"), "utf8"),
        "preserved teacher data");
    },
    async cleanup() {
      await finished(await manager.stop());
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        const closed = once(child, "close");
        child.kill("SIGKILL"); // Only a failed test's own disposable process.
        await closed;
      }
      await boundary.release();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("manager starts a real fenced service and reuses its owned child",
  { timeout: 20_000 }, async () => {
    const f = await fixture();
    try {
      for (let index = 0; index < 2; index++) {
        const nonce = randomUUID();
        assert.deepEqual(await f.manager.startAndCheck(f.target, nonce), {
          status: "healthy", nonce, version: PRODUCT_VERSION,
        });
      }
      assert.equal(f.children.length, 1);
      assert.deepEqual(await acquireCanonicalDataWriter(f.data),
        { ok: false, reason: "busy" });
      assert.deepEqual(await finished(await f.manager.stop()),
        { status: "stopped" });
      assert.equal(f.children[0]!.exitCode, 0);
      assert.equal(await canonicalDataUpdateBoundaryOwned(f.boundary, f.data),
        true);
      await f.preserved();
      const nonce = randomUUID();
      assert.deepEqual(await f.manager.startAndCheck(f.target, nonce), {
        status: "healthy", nonce, version: PRODUCT_VERSION,
      });
      assert.equal(f.children.length, 2);
      await f.boundary.release();
      assert.deepEqual(await f.manager.startAndCheck(f.target, randomUUID()),
        { status: "unavailable" });
      assert.deepEqual(await finished(await f.manager.stop()),
        { status: "stopped" });
    } finally { await f.cleanup(); }
  });

test("local UI shutdown closes the installer-owned service and reports once",
  { timeout: 20_000 }, async () => {
    const observer = new EventEmitter();
    const reports: unknown[] = [];
    const f = await fixture(5_000, proof => {
      reports.push(proof); observer.emit("stopped", proof);
    });
    try {
      const nonce = randomUUID();
      assert.deepEqual(await f.manager.startAndCheck(f.target, nonce), {
        status: "healthy", nonce, version: PRODUCT_VERSION,
      });
      await f.boundary.release();
      const runtime = JSON.parse(await readFile(join(f.data,
        "service-runtime.json"), "utf8"));
      const bootstrap = await (await fetch(runtime.origin + "/api/bootstrap"))
        .json();
      const reported = once(observer, "stopped",
        { signal: AbortSignal.timeout(5_000) });
      void reported.catch(() => {});
      const closed = once(f.children[0]!, "close",
        { signal: AbortSignal.timeout(2_000) });
      const response = await fetch(runtime.origin + "/api/service-stop", {
        method: "POST", headers: { Origin: runtime.origin,
          "Content-Type": "application/json", "X-CSRF-Token": bootstrap.csrf },
        body: "{}",
      });
      assert.equal(response.status, 202);
      await response.body?.cancel();
      assert.deepEqual(await closed, [0, null]);
      assert.deepEqual(await reported, [{ status: "stopped" }]);
      assert.deepEqual(await f.manager.stop(), { status: "stopped" });
      assert.deepEqual(reports, [{ status: "stopped" }]);
      await assert.rejects(readFile(join(f.data, ".service.lock")),
        { code: "ENOENT" });
      await f.preserved();
    } finally { await f.cleanup(); }
  });

test("concurrent fresh health requests never spawn duplicate services",
  { timeout: 20_000 }, async () => {
    const f = await fixture();
    try {
      const nonces = [randomUUID(), randomUUID()];
      const replies = await Promise.all(nonces.map(nonce =>
        f.manager.startAndCheck(f.target, nonce)));
      assert.deepEqual(replies, nonces.map(nonce => ({ status: "healthy",
        version: PRODUCT_VERSION, nonce })));
      assert.equal(f.children.length, 1);
      await f.preserved();
    } finally { await f.cleanup(); }
  });

test("unexpected real child death reports uncertainty without another spawn",
  { timeout: 20_000 }, async () => {
    const observer = new EventEmitter();
    const f = await fixture(5_000, proof => observer.emit("stopped", proof));
    try {
      const nonce = randomUUID();
      assert.deepEqual(await f.manager.startAndCheck(f.target, nonce), {
        status: "healthy", nonce, version: PRODUCT_VERSION,
      });
      const reported = once(observer, "stopped",
        { signal: AbortSignal.timeout(5_000) });
      const closed = once(f.children[0]!, "close");
      f.children[0]!.kill("SIGKILL"); // Intentional disposable-child crash.
      await closed;
      assert.deepEqual(await reported, [{ status: "unavailable" }]);
      assert.deepEqual(await f.manager.startAndCheck(f.target, randomUUID()),
        { status: "unavailable" });
      assert.equal(f.children.length, 1);
      assert.equal(await canonicalDataUpdateBoundaryOwned(f.boundary, f.data),
        true);
      await f.preserved();
    } finally { await f.cleanup(); }
  });

test("a real wrong-version child fails health but can drain for rollback",
  { timeout: 20_000 }, async () => {
    const f = await fixture();
    try {
      const version = PRODUCT_VERSION === "26.4.1" ? "26.4.2" : "26.4.1";
      assert.deepEqual(await f.manager.startAndCheck({ ...f.target, version },
        randomUUID()), { status: "unavailable" });
      assert.equal(f.children.length, 1);
      assert.deepEqual(await finished(await f.manager.stop()),
        { status: "stopped" });
      assert.equal(f.children[0]!.exitCode, 0);
      await f.preserved();
    } finally { await f.cleanup(); }
  });

test("startup deadline retains ownership until actual late service closure",
  { timeout: 20_000 }, async () => {
    const f = await fixture(1);
    try {
      const version = PRODUCT_VERSION === "26.4.1" ? "26.4.2" : "26.4.1";
      assert.deepEqual(await f.manager.startAndCheck({ ...f.target, version },
        randomUUID()),
        { status: "unavailable" });
      assert.equal(f.children.length, 1);
      assert.equal(f.children[0]!.exitCode, null);
      const stopped = await f.manager.stop();
      assert.equal(stopped.status, "pending");
      assert.equal(await canonicalDataUpdateBoundaryOwned(f.boundary, f.data),
        true);
      assert.deepEqual(await acquireCanonicalDataWriter(f.data),
        { ok: false, reason: "busy" });
      assert.deepEqual(await finished(stopped), { status: "stopped" });
      assert.equal(f.children[0]!.exitCode, 0);
      await f.preserved();
    } finally { await f.cleanup(); }
  });

test("foreign, released and pre-cancelled startup has no process authority",
  { timeout: 20_000 }, async () => {
    const f = await fixture();
    try {
      const forged = createInstallerServiceManager(f.data,
        { ok: true, release: async () => {} }, { launch: f.launch });
      const foreign = createInstallerServiceManager(join(f.root, "foreign"),
        f.boundary, { launch: f.launch });
      for (const manager of [forged, foreign])
        assert.deepEqual(await manager.startAndCheck(f.target, randomUUID()),
          { status: "unavailable" });
      assert.deepEqual(await f.manager.startAndCheck(f.target, randomUUID(),
        AbortSignal.abort()), { status: "unavailable" });
      await f.boundary.release();
      assert.deepEqual(await f.manager.startAndCheck(f.target, randomUUID()),
        { status: "unavailable" });
      assert.equal(f.children.length, 0);
      await f.preserved();
    } finally { await f.cleanup(); }
  });
