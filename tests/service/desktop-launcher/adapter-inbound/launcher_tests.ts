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
//   - Verification of persisted first-use diagnostic integrity.
// - Must-Not:
//   - Read credentials or claim native host acceptance from portable checks.
// - Allows:
//   - Inputs: Untrusted diagnostic records.
//   - Outputs: Validated state or bounded decoding failures.
//   - Side effects: Disposable files and isolated native diagnostic checks.
// - Split-When:
//   - Native diagnostic results need a different schema or trust authority.
// - Merge-When:
//   - Diagnostic persistence no longer exists.
// - Summary:
//   - Prevents malformed cached diagnostics becoming trusted startup status.
// - Description:
//   - Rejects unknown fields, duplicate checks, and contradictory outcomes.
// - Usage:
//   - Decode before returning persisted state or publishing a fresh result.
// - Defaults:
//   - Unknown schemas and malformed records fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile, readdir, lstat, mkdir } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFirstUseDiagnostic } from
  "../../../../src/ir/first-use-diagnostics/contract/state.ts";
import { defaultTeacherPreferences } from
  "../../../../src/settings/teacher-preferences/domain/preferences.ts";
import { savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import {
  acquireCanonicalDataWriter, acquireCanonicalDataUpdateBoundary,
} from
  "../../../../src/platforms/user-storage/adapter-outbound/writer-boundary.ts";
import { decodeServiceRuntime } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/runtime.ts";

const launcher = fileURLToPath(new URL(
  "../../../../src/service/desktop-launcher/adapter-inbound/launcher.ts",
  import.meta.url,
));

test("explicit launcher diagnostics repairs cache without starting a service",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "launcher-diagnostic-"));
    try {
      const preferences = defaultTeacherPreferences(join(root, "media"));
      await savePreferences(root, {
        ...preferences,
        service: { ...preferences.service, port: 1, portMode: "automatic" },
      });
      const state = join(root, "diagnostics.json");
      await writeFile(state, "invalid-json");
      const result = await promisify(execFile)(process.execPath, [
        launcher, "--diagnostics",
      ], {
        env: { PATH: process.env["PATH"], BLOOKET_DATA_HOME: root },
        timeout: 20_000,
        maxBuffer: 16_384,
      });
      assert.equal(result.stderr, "");
      const decoded = decodeFirstUseDiagnostic(JSON.parse(result.stdout));
      assert.equal(decoded.ok, true);
      assert.deepEqual(JSON.parse(await readFile(state, "utf8")),
        JSON.parse(result.stdout));
      await assert.rejects(readFile(join(root, "service-runtime.json")),
        { code: "ENOENT" });
      await assert.rejects(readFile(join(root, ".service.lock")),
        { code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("launcher refuses diagnostics combined with a lifecycle action",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "launcher-diagnostic-options-"));
    try {
      await assert.rejects(promisify(execFile)(process.execPath, [
        launcher, "--diagnostics", "--stop",
      ], {
        env: { PATH: process.env["PATH"], BLOOKET_DATA_HOME: root },
        timeout: 5000,
      }), { code: 1 });
      await assert.rejects(readFile(join(root, "diagnostics.json")),
        { code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("manual diagnostics preserve cached evidence during installation",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "launcher-diagnostic-update-"));
    const boundary = await acquireCanonicalDataUpdateBoundary(root);
    assert.equal(boundary.ok, true);
    if (!boundary.ok) return;
    try {
      const state = join(root, "diagnostics.json");
      const evidence = "preserved-existing-diagnostic-evidence\n";
      await writeFile(state, evidence);
      await assert.rejects(promisify(execFile)(process.execPath, [
        launcher, "--diagnostics",
      ], {
        env: { PATH: process.env["PATH"], BLOOKET_DATA_HOME: root },
        timeout: 6_000, maxBuffer: 8192,
      }), { code: 1 });
      assert.equal(await readFile(state, "utf8"), evidence);
      await assert.rejects(readFile(join(root, "settings.json")),
        { code: "ENOENT" });
      await assert.rejects(readFile(join(root, "service-runtime.json")),
        { code: "ENOENT" });
    } finally {
      await boundary.release();
      await rm(root, { recursive: true, force: true });
    }
  });

test("real silent launcher starts, reuses and drains the supervised service",
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "launcher-supervised-service-"));
    const preferences = defaultTeacherPreferences(join(root, "media"));
    await savePreferences(root, { ...preferences,
      service: { ...preferences.service, portMode: "automatic", port: 1 } });
    await writeFile(join(root, "teacher-marker"), "teacher-owned-data");
    const command = (option: string) => promisify(execFile)(process.execPath,
      [launcher, option], { timeout: 8_000, maxBuffer: 8192,
        env: { PATH: process.env["PATH"], HOME: process.env["HOME"],
          XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
          DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
          BLOOKET_DATA_HOME: root } });
    const drained = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const runtime = await lstat(join(root, "service-runtime.json"))
          .catch(error => { if (error.code === "ENOENT") return undefined;
            throw error; });
        const lock = await lstat(join(root, ".service.lock"))
          .catch(error => { if (error.code === "ENOENT") return undefined;
            throw error; });
        const writers = await readdir(join(root, ".canonical-writers"));
        if (!runtime && !lock && writers.length === 0) return;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw Error("owned-launcher-service-did-not-drain");
    };
    try {
      const first = await command("--no-open");
      assert.equal(first.stderr, "");
      const runtime = decodeServiceRuntime(JSON.parse(await readFile(
        join(root, "service-runtime.json"), "utf8")));
      assert.equal(first.stdout, runtime.origin + "\n");
      assert.equal((await fetch(runtime.origin + "/api/service-status")).status,
        200);
      const second = await command("--no-open");
      assert.equal(second.stdout, first.stdout);
      assert.equal(second.stderr, "");
      assert.equal(await readFile(join(root, "teacher-marker"), "utf8"),
        "teacher-owned-data");
      const stopped = await command("--stop");
      assert.equal(stopped.stdout, "Service stopped.\n");
      assert.equal(stopped.stderr, "");
      // The launcher now reports completion only after actual service exit
      // and removal of runtime discovery, service lock and writer leases.
      await drained();
      const boundary = await acquireCanonicalDataUpdateBoundary(root);
      assert.equal(boundary.ok, true);
      if (boundary.ok) await boundary.release();
    } finally {
      await command("--stop");
      await drained();
      await rm(root, { recursive: true, force: true });
    }
  });

test("launcher stop cannot claim drained while a separate writer remains",
  { timeout: 18_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "launcher-held-writer-"));
  const preferences = defaultTeacherPreferences(join(root, "media"));
  await savePreferences(root, { ...preferences,
    service: { ...preferences.service, portMode: "automatic", port: 1 } });
  const marker = join(root, "teacher-marker");
  await writeFile(marker, "preserve-synthetic-draft");
  const command = (option: string) => promisify(execFile)(process.execPath,
    [launcher, option], { timeout: 8_000, maxBuffer: 8192,
      env: { PATH: process.env["PATH"], HOME: process.env["HOME"],
        XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
        DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
        BLOOKET_DATA_HOME: root } });
  let held: Awaited<ReturnType<typeof acquireCanonicalDataWriter>> | undefined;
  try {
    await command("--no-open");
    held = await acquireCanonicalDataWriter(root);
    assert.equal(held.ok, true);
    await assert.rejects(command("--stop"), (error: unknown) => {
      assert.ok(error instanceof Error && "code" in error &&
        error.code === 1 && "stderr" in error &&
        typeof error.stderr === "string" &&
        error.stderr.includes("Service stop is unconfirmed"));
      return true;
    });
    assert.equal(await readFile(marker, "utf8"), "preserve-synthetic-draft");
    assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root), {
      ok: false, reason: "writer-active",
    });
  } finally {
    if (held?.ok) await held.release();
    await command("--stop").catch(() => undefined);
    const boundary = await acquireCanonicalDataUpdateBoundary(root);
    assert.equal(boundary.ok, true);
    if (boundary.ok) await boundary.release();
    await rm(root, { recursive: true, force: true });
  }
  },
);

test("launcher stop refuses oversized and invalid local bootstrap replies",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "launcher-stop-safe-"));
  let mode: "oversized" | "bad-csrf" | "valid" | "stale-pid" =
    "oversized";
  let stopped = 0;
  const runtime = {
    version: 1, pid: process.pid,
    instance: "00000000-0000-0000-0000-000000000000",
    origin: "",
  };
  const server = createServer((request, response) => {
    if (request.url === "/api/service-status") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(runtime));
    } else if (request.url === "/api/bootstrap") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(mode === "oversized"
        ? "x".repeat(128_001)
        : JSON.stringify({ csrf: mode === "bad-csrf"
          ? "unsafe" : "a".repeat(43) }));
    } else if (request.url === "/api/service-stop") {
      stopped++;
      assert.equal(request.headers.origin, runtime.origin);
      assert.equal(request.headers["x-csrf-token"], "a".repeat(43));
      response.writeHead(202);
      response.end("{}");
      if (mode === "stale-pid") {
        // Simulate a dead old PID and removed discovery, but a *different*
        // still-listening server on the same claimed origin.
        void rm(join(root, "service-runtime.json"));
      }
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  runtime.origin = "http://127.0.0.1:" + address.port;
  try {
    await writeFile(join(root, "service-runtime.json"),
      JSON.stringify(runtime));
    for (const invalid of ["oversized", "bad-csrf"] as const) {
      mode = invalid;
      await assert.rejects(promisify(execFile)(process.execPath, [
        launcher, "--stop",
      ], {
        env: { PATH: process.env["PATH"], BLOOKET_DATA_HOME: root },
        timeout: 6_000, maxBuffer: 8192,
      }), { code: 1 });
      assert.equal(stopped, 0);
    }
    mode = "valid";
    // HTTP 202 from a still-running service is only an accepted request.
    // Its runtime, owned process and journaled writers are not drained.
    await assert.rejects(promisify(execFile)(process.execPath, [
      launcher, "--stop",
    ], {
      env: { PATH: process.env["PATH"], BLOOKET_DATA_HOME: root },
      timeout: 8_000, maxBuffer: 8192,
    }), (error: unknown) => {
      assert.ok(error instanceof Error && "code" in error &&
        error.code === 1 && "stdout" in error && error.stdout === "" &&
        "stderr" in error && typeof error.stderr === "string" &&
        error.stderr.includes("Service stop is unconfirmed"));
      return true;
    });
    assert.equal(stopped, 1);
    assert.equal((await lstat(join(root, "service-runtime.json"))).isFile(),
      true);
    mode = "stale-pid";
    runtime.pid = 99_999_999;
    await writeFile(join(root, "service-runtime.json"),
      JSON.stringify(runtime));
    await mkdir(join(root, ".canonical-writers"));
    await assert.rejects(promisify(execFile)(process.execPath, [
      launcher, "--stop",
    ], {
      env: { PATH: process.env["PATH"], BLOOKET_DATA_HOME: root },
      timeout: 8_000, maxBuffer: 8192,
    }), { code: 1 });
    assert.equal(stopped, 2);
    await assert.rejects(lstat(join(root, "service-runtime.json")),
      { code: "ENOENT" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
  },
);
