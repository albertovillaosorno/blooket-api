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
//   - Owned service IPC shutdown and final closure regression coverage.
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
import { requestOwnedServiceStop, type OwnedServiceStopObservation } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/stop.ts";
import { probeOwnedServiceHealth } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/health.ts";
import { decodeServiceRuntime, type LocalServiceRuntime } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/runtime.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import { loadPreferences, savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";

async function cleanup(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGKILL");
  await closed;
}
async function finished(observation: OwnedServiceStopObservation) {
  return observation.status === "pending" ? await observation.completion
    : observation;
}
async function runtimeOf(child: ChildProcess): Promise<LocalServiceRuntime> {
  return decodeServiceRuntime((await once(child, "message"))[0]);
}
function launch(root: string) {
  return fork(new URL(
    "../../../../src/service/background-service/adapter-inbound/main.ts",
    import.meta.url), [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { PATH: process.env["PATH"], HOME: process.env["HOME"],
      XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
      DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
      BLOOKET_DATA_HOME: root },
  });
}
test("real service drains, closes silently and restarts with teacher data",
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "owned-service-stop-"));
    const children: ChildProcess[] = [];
    try {
      const settings = await loadPreferences(root);
      await savePreferences(root, { ...settings,
        service: { ...settings.service, portMode: "automatic", port: 1 } });
      await writeFile(join(root, "teacher-data-marker"), "preserved-data");
      for (let index = 0; index < 2; index++) {
        const child = launch(root); children.push(child);
        const runtime = await runtimeOf(child);
        const nonce = randomUUID();
        assert.deepEqual(await probeOwnedServiceHealth(child, runtime,
          PRODUCT_VERSION, nonce), { status: "healthy",
          version: PRODUCT_VERSION, nonce });
        const preaborted = new AbortController(); preaborted.abort();
        assert.deepEqual(await requestOwnedServiceStop(child, runtime,
          PRODUCT_VERSION, randomUUID(), { signal: preaborted.signal }),
        { status: "unavailable" });
        assert.equal(child.connected, true);
        assert.deepEqual(await finished(await requestOwnedServiceStop(
          child, runtime, PRODUCT_VERSION, randomUUID(),
        )), { status: "stopped" });
        assert.equal(child.exitCode, 0);
        await assert.rejects(readFile(join(root, ".service.lock")));
        await assert.rejects(readFile(join(root, "service-runtime.json")));
        assert.equal(await readFile(join(root, "teacher-data-marker"),
          "utf8"), "preserved-data");
      }
    } finally {
      for (const child of children) await cleanup(child);
      await rm(root, { recursive: true, force: true });
    }
  },
);

// Real IPC transport with synthetic child behavior: a receipt/disconnect or
// process exit does not prove final pipe closure or drain of native children.
function fixture(body: string, pipe = false) {
  const instance = randomUUID();
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const runtime = { version: 1, pid: process.pid,
      instance: ${JSON.stringify(instance)}, origin: 'http://127.0.0.1:9' };
    process.send(runtime);
    process.on('message', request => {
      const receipt = { kind: 'update-stop-response', nonce: request.nonce,
        instance: runtime.instance, pid: process.pid,
        version: '26.4.0', status: 'drained' };
      ${body}
    });
  `], { stdio: ["ignore", pipe ? "pipe" : "ignore", "ignore", "ipc"] });
  return child;
}

test("deadline retains the exact completion and does not repeat shutdown",
  { timeout: 10_000 }, async () => {
    const child = fixture(`
      if (request.kind === 'release') {
        process.disconnect(); return;
      }
      process.send(receipt);
    `);
    try {
      const runtime = await runtimeOf(child), nonce = randomUUID();
      const operation = requestOwnedServiceStop(child, runtime,
        PRODUCT_VERSION, nonce, { timeoutMs: 40 });
      assert.equal(requestOwnedServiceStop(child, runtime,
        PRODUCT_VERSION, nonce), operation);
      const pending = await operation;
      assert.equal(pending.status, "pending");
      assert.equal(child.connected, true);
      assert.equal(child.exitCode, null);
      assert.equal(child.listenerCount("close"), 1);
      assert.deepEqual(await requestOwnedServiceStop(child, runtime,
        PRODUCT_VERSION, randomUUID()), { status: "unavailable" });
      child.send({ kind: "release" });
      assert.deepEqual(await finished(pending), { status: "stopped" });
      assert.equal(child.listenerCount("message"), 0);
      assert.equal(child.listenerCount("close"), 0);
      assert.equal(child.listenerCount("error"), 0);
    } finally { await cleanup(child); }
  },
);

test("aborted observation retains ownership until final child closure",
  { timeout: 10_000 }, async () => {
    const child = fixture(`
      if (request.kind === 'release') { process.disconnect(); return; }
      process.send(receipt);
    `);
    try {
      const runtime = await runtimeOf(child), nonce = randomUUID();
      const abort = new AbortController();
      const received = once(child, "message");
      const operation = requestOwnedServiceStop(child, runtime,
        PRODUCT_VERSION, nonce, { signal: abort.signal });
      await received;
      abort.abort();
      const pending = await operation;
      assert.equal(pending.status, "pending");
      assert.equal(child.connected, true);
      child.send({ kind: "release" });
      assert.deepEqual(await finished(pending), { status: "stopped" });
    } finally { await cleanup(child); }
  },
);

test("foreign, malformed and unavailable receipts cannot authorize exchange",
  { timeout: 20_000 }, async () => {
    for (const change of ["nonce: 'stale'", "instance: 'foreign'", "pid: 1",
      "version: '26.4.99999'", "status: 'unavailable'", "extra: true"]) {
      const child = fixture(`
        process.send({ ...receipt, ${change} }, () => process.disconnect());
      `);
      try {
        const runtime = await runtimeOf(child);
        assert.deepEqual(await finished(await requestOwnedServiceStop(
          child, runtime, PRODUCT_VERSION, randomUUID(),
        )), { status: "unavailable" });
      } finally { await cleanup(child); }
    }
  },
);

test("clean exit without a drained receipt remains unproven",
  { timeout: 10_000 }, async () => {
    const child = fixture("process.disconnect();");
    try {
      const runtime = await runtimeOf(child);
      assert.deepEqual(await finished(await requestOwnedServiceStop(
        child, runtime, PRODUCT_VERSION, randomUUID(),
      )), { status: "unavailable" });
    } finally { await cleanup(child); }
  },
);


test("parent exit with a still-open inherited pipe does not prove closure",
  { timeout: 10_000 }, async () => {
    const child = fixture(`
      import('node:child_process').then(({ spawn }) => {
        spawn(process.execPath, ['-e', 'setTimeout(() => {}, 350)'], {
          stdio: ['ignore', process.stdout, 'ignore'],
        }).unref();
        process.send(receipt, () => process.disconnect());
      });
    `, true);
    try {
      const runtime = await runtimeOf(child);
      const exited = once(child, "exit");
      const operation = requestOwnedServiceStop(child, runtime,
        PRODUCT_VERSION, randomUUID(), { timeoutMs: 100 });
      await exited;
      assert.equal(child.exitCode, 0);
      const pending = await operation;
      assert.equal(pending.status, "pending");
      assert.deepEqual(await finished(pending), { status: "stopped" });
    } finally { await cleanup(child); }
  },
);

test("a drained receipt followed by failed process exit is refused",
  { timeout: 10_000 }, async () => {
    const child = fixture(`
      process.exitCode = 1;
      process.send(receipt, () => process.disconnect());
    `);
    try {
      const runtime = await runtimeOf(child);
      assert.deepEqual(await finished(await requestOwnedServiceStop(
        child, runtime, PRODUCT_VERSION, randomUUID(),
      )), { status: "unavailable" });
      assert.equal(child.exitCode, 1);
    } finally { await cleanup(child); }
  },
);

test("private stop waits for an admitted settings writer before receipt",
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "owned-stop-writer-"));
    let child: ChildProcess | undefined;
    let saving: Promise<unknown> | undefined;
    try {
      const settings = await loadPreferences(root);
      await savePreferences(root, { ...settings,
        service: { ...settings.service, portMode: "automatic", port: 1 } });
      const runtimeModule = new URL(
        "../../../../src/service/background-service/application/runtime.ts",
        import.meta.url).href;
      const stopModule = new URL(
        "../../../../src/platforms/service-lifecycle/adapter-outbound/stop.ts",
        import.meta.url).href;
      child = spawn(process.execPath, ["--input-type=module", "-e", `
        import { startManagedBackgroundService } from
          ${JSON.stringify(runtimeModule)};
        import { installServiceStopResponder } from
          ${JSON.stringify(stopModule)};
        const release = Promise.withResolvers();
        process.on('message', value => {
          if (value.kind === 'test-release-writer') release.resolve();
        });
        const service = await startManagedBackgroundService(
          ${JSON.stringify(root)}, {
            read: async () => ({ ok: true, kind: 'missing' }),
            write: async () => {
              process.send({ kind: 'test-writer-entered' });
              await release.promise;
              return { ok: true };
            },
            delete: async () => ({ ok: true }),
          },
        );
        const runtime = { version: service.version, pid: service.pid,
          instance: service.instance, origin: service.origin };
        installServiceStopResponder(runtime, '26.4.0', service.stop);
        process.send(runtime);
      `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
      const runtime = await runtimeOf(child);
      const boot = await (await fetch(
        runtime.origin + "/api/bootstrap")).json();
      const entered = once(child, "message");
      saving = fetch(runtime.origin + "/api/settings", {
        method: "POST", headers: { Origin: runtime.origin,
          "Content-Type": "application/json", "X-CSRF-Token": boot.csrf },
        body: JSON.stringify({ preferences: { ...settings, locale: "es" },
          password: "synthetic-test-value", tunnelToken: "" }),
      }).then(response => response.json(), () => undefined);
      assert.deepEqual((await entered)[0], { kind: "test-writer-entered" });
      const pending = await requestOwnedServiceStop(child, runtime,
        PRODUCT_VERSION, randomUUID(), { timeoutMs: 100 });
      assert.equal(pending.status, "pending");
      assert.equal(child.exitCode, null);
      await readFile(join(root, ".service.lock"));
      assert.deepEqual(await tryAcquireFileLock(join(root, ".service.lock")),
        { ok: false, reason: "busy" });
      child.send({ kind: "test-release-writer" });
      assert.deepEqual(await finished(pending), { status: "stopped" });
      await saving;
      assert.equal((await loadPreferences(root)).locale, "es");
      await assert.rejects(readFile(join(root, ".service.lock")));
    } finally {
      if (child) await cleanup(child);
      await saving;
      await rm(root, { recursive: true, force: true });
    }
  },
);
