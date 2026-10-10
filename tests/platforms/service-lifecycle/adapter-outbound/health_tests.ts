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
//   - Owned service IPC health and fresh runtime regression coverage.
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
import assert from "node:assert/strict";
import test from "node:test";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PRODUCT_VERSION } from
  "../../../../src/ir/product-version/contract/version.ts";
import { probeOwnedServiceHealth } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/health.ts";
import { decodeServiceRuntime, type LocalServiceRuntime } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/runtime.ts";
import { loadPreferences, savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";

async function close(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try { await closed; } finally { clearTimeout(timer); }
}

test("real silent service proves version and fresh nonce on its owned IPC",
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "owned-service-health-"));
    let child: ChildProcess | undefined;
    try {
      const settings = await loadPreferences(root);
      await savePreferences(root, { ...settings,
        service: { ...settings.service, portMode: "automatic", port: 1 } });
      await writeFile(join(root, "teacher-data-marker"), "preserved-data");
      child = fork(new URL(
        "../../../../src/service/background-service/adapter-inbound/main.ts",
        import.meta.url), [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { PATH: process.env["PATH"], HOME: process.env["HOME"],
          XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
          DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
          BLOOKET_DATA_HOME: root },
      });
      const spawned = child;
      const runtime = await new Promise<LocalServiceRuntime>(
        (resolve, reject) => {
          const finish = () => {
            clearTimeout(timer);
            spawned.removeListener("message", message);
            spawned.removeListener("exit", exited);
          };
          const message = (value: unknown) => {
            finish();
            try { resolve(decodeServiceRuntime(value)); }
            catch (error) { reject(error); }
          };
          const exited = () => { finish(); reject(Error("startup-failed")); };
          const timer = setTimeout(() => {
            finish(); reject(Error("startup-deadline"));
          }, 10_000);
          spawned.once("message", message);
          spawned.once("exit", exited);
        });
      assert.equal(runtime.pid, child.pid);
      const nonce = randomUUID();
      assert.deepEqual(await probeOwnedServiceHealth(
        child, runtime, PRODUCT_VERSION, nonce,
      ), { status: "healthy", version: PRODUCT_VERSION, nonce });
      assert.deepEqual(await probeOwnedServiceHealth(
        child, runtime, "26.4.99999", randomUUID(),
      ), { status: "unavailable" });
      assert.deepEqual(await probeOwnedServiceHealth(
        child, { ...runtime, pid: runtime.pid + 1 }, PRODUCT_VERSION,
        randomUUID(),
      ), { status: "unavailable" });
      const aborted = new AbortController(); aborted.abort();
      assert.deepEqual(await probeOwnedServiceHealth(
        child, runtime, PRODUCT_VERSION, randomUUID(),
        { signal: aborted.signal },
      ), { status: "unavailable" });
      const fresh = randomUUID();
      assert.deepEqual(await probeOwnedServiceHealth(
        child, runtime, PRODUCT_VERSION, fresh,
      ), { status: "healthy", version: PRODUCT_VERSION, nonce: fresh });
      assert.equal(await readFile(join(root, "teacher-data-marker"),
        "utf8"), "preserved-data");
      await close(child);
      assert.deepEqual(await probeOwnedServiceHealth(
        child, runtime, PRODUCT_VERSION, randomUUID(),
      ), { status: "unavailable" });
    } finally {
      if (child) await close(child);
      await rm(root, { recursive: true, force: true });
    }
  },
);

// Synthetic hostile replies use real IPC transport; they are not application
// startup, bundle trust, provider or native Mac acceptance evidence.
test("foreign and malformed IPC receipts cannot prove service health",
  { timeout: 10_000 }, async () => {
    const instance = randomUUID();
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      let index = 0;
      const changes = [
        { nonce: 'stale' }, { instance: 'foreign' }, { pid: 1 },
        { version: '26.4.99999' }, { status: 'running' }, { extra: true },
      ];
      process.on('message', request => process.send({
        kind: 'update-health-response', nonce: request.nonce,
        instance: ${JSON.stringify(instance)}, pid: process.pid,
        version: '26.4.0', status: 'healthy', ...changes[index++],
      }));
      process.send({ ready: true });
    `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    try {
      await once(child, "message");
      const runtime: LocalServiceRuntime = { version: 1,
        pid: child.pid!, instance, origin: "http://127.0.0.1:9" };
      for (let index = 0; index < 6; index++) {
        assert.deepEqual(await probeOwnedServiceHealth(
          child, runtime, PRODUCT_VERSION, randomUUID(),
        ), { status: "unavailable" });
        assert.equal(child.listenerCount("message"), 0);
      }
    } finally { await close(child); }
  },
);

test("in-flight health cancellation clears listeners without killing service",
  { timeout: 10_000 }, async () => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      process.on('message', () => process.send({ received: true }));
      process.send({ ready: true });
    `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    try {
      await once(child, "message");
      const runtime: LocalServiceRuntime = { version: 1,
        pid: child.pid!, instance: randomUUID(),
        origin: "http://127.0.0.1:9" };
      const controller = new AbortController();
      const received = once(child, "message");
      const first = probeOwnedServiceHealth(child, runtime, PRODUCT_VERSION,
        randomUUID(), { signal: controller.signal });
      await received;
      assert.deepEqual(await probeOwnedServiceHealth(child, runtime,
        PRODUCT_VERSION, randomUUID()), { status: "unavailable" });
      controller.abort();
      assert.deepEqual(await first, { status: "unavailable" });
      assert.equal(child.exitCode, null);
      assert.equal(child.signalCode, null);
      assert.equal(child.listenerCount("message"), 0);
      assert.deepEqual(await probeOwnedServiceHealth(child, runtime,
        PRODUCT_VERSION, randomUUID(), { timeoutMs: 50 }),
      { status: "unavailable" });
      assert.equal(child.listenerCount("message"), 0);
    } finally { await close(child); }
  },
);
