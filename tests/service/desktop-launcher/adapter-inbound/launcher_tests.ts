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
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFirstUseDiagnostic } from
  "../../../../src/ir/first-use-diagnostics/contract/state.ts";
import { defaultTeacherPreferences } from
  "../../../../src/settings/teacher-preferences/domain/preferences.ts";
import { savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";

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

test("launcher stop refuses oversized and invalid local bootstrap replies",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "launcher-stop-safe-"));
  let mode: "oversized" | "bad-csrf" | "valid" = "oversized";
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
    const accepted = await promisify(execFile)(process.execPath, [
      launcher, "--stop",
    ], {
      env: { PATH: process.env["PATH"], BLOOKET_DATA_HOME: root },
      timeout: 6_000, maxBuffer: 8192,
    });
    assert.equal(accepted.stdout, "Service stopped.\n");
    assert.equal(stopped, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
  },
);
