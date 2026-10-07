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
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFirstUseDiagnostic } from
  "../../../../src/ir/first-use-diagnostics/contract/state.ts";

const launcher = fileURLToPath(new URL(
  "../../../../src/service/desktop-launcher/adapter-inbound/launcher.ts",
  import.meta.url,
));

test("explicit launcher diagnostics repairs cache without starting a service",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "launcher-diagnostic-"));
    try {
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
