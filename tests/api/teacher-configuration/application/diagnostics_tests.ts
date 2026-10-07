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
import { mkdtemp, rm, readFile, writeFile, symlink, mkdir } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFirstUseDiagnostics } from
  "../../../../src/api/teacher-configuration/application/configuration.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import { DIAGNOSTIC_MAX_BYTES } from
  "../../../../src/ir/first-use-diagnostics/contract/state.ts";

async function temporary(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "first-use-diagnostic-"));
  try { await action(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("first-use reuses validated state and manual rerun repairs corruption",
  async () => {
    await temporary(async root => {
      const first = await runFirstUseDiagnostics(root);
      const state = await readFile(join(root, "diagnostics.json"), "utf8");
      const log = await readFile(join(root, first.log), "utf8");
      assert.equal(log, state);
      assert.deepEqual(await runFirstUseDiagnostics(root), first);
      assert.equal(
        await readFile(join(root, "diagnostics.json"), "utf8"), state,
      );
      await writeFile(join(root, "diagnostics.json"), '{"outcome":"passed"}');
      await assert.rejects(
        runFirstUseDiagnostics(root), /diagnostics-unreadable/u,
      );
      const repaired = await runFirstUseDiagnostics(root, true);
      assert.notEqual(repaired.at, first.at);
      assert.deepEqual(await runFirstUseDiagnostics(root), repaired);
    });
  });

test("cached diagnostics reject oversized, symbolic and non-file state",
  async () => {
    await temporary(async root => {
      const path = join(root, "diagnostics.json");
      await writeFile(path, " ".repeat(DIAGNOSTIC_MAX_BYTES + 1));
      await assert.rejects(
        runFirstUseDiagnostics(root), /diagnostics-unreadable/u,
      );
      await rm(path);
      const target = join(root, "foreign.json");
      await writeFile(target, "{}");
      await symlink(target, path);
      await assert.rejects(
        runFirstUseDiagnostics(root), /diagnostics-unreadable/u,
      );
      assert.equal(await readFile(target, "utf8"), "{}");
      await rm(path);
      await mkdir(path);
      await assert.rejects(
        runFirstUseDiagnostics(root), /diagnostics-unreadable/u,
      );
    });
  });

test("a live diagnostic owner blocks a second run without stealing its lock",
  async () => {
    await temporary(async root => {
      const acquired = await tryAcquireFileLock(
        join(root, ".diagnostics.lock"),
      );
      assert.equal(acquired.ok, true);
      if (!acquired.ok) return;
      try {
        const before = await readFile(acquired.lock.path, "utf8");
        await assert.rejects(runFirstUseDiagnostics(root), /diagnostics-busy/u);
        await assert.rejects(
          runFirstUseDiagnostics(root, true), /diagnostics-busy/u,
        );
        assert.equal(await readFile(acquired.lock.path, "utf8"), before);
      } finally { await acquired.lock.release(); }
      assert.ok(await runFirstUseDiagnostics(root));
    });
  });
