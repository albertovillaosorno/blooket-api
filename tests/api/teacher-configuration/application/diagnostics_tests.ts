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
//   - Return credentials or claim native host acceptance from portable checks.
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
import { createServer } from "node:net";
import { runFirstUseDiagnostics } from
  "../../../../src/api/teacher-configuration/application/configuration.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import { DIAGNOSTIC_MAX_BYTES } from
  "../../../../src/ir/first-use-diagnostics/contract/state.ts";
import { defaultTeacherPreferences } from
  "../../../../src/settings/teacher-preferences/domain/preferences.ts";
import { savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import { OWNER_VERIFIER_SECRET } from
  "../../../../src/security/owner-password/domain/verifier.ts";
import type { HostSecretStore } from
  "../../../../src/security/host-secrets/domain/host-secret.ts";

async function temporary(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "first-use-diagnostic-"));
  try { await action(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function secrets(
  reads: string[],
  owner: "found" | "missing" = "found",
  tunnel: "found" | "missing" = "found",
): HostSecretStore {
  return {
    read: async (name) => {
      reads.push(name);
      const kind = name === OWNER_VERIFIER_SECRET ? owner : tunnel;
      return kind === "found"
        ? { ok: true, kind, secret: "fixture-secret" }
        : { ok: true, kind };
    },
    write: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
  };
}

test("first-use reuses validated state and manual rerun repairs corruption",
  async () => {
    await temporary(async root => {
      const preferences = defaultTeacherPreferences(join(root, "media"));
      await savePreferences(root, {
        ...preferences,
        service: { ...preferences.service, port: 1, portMode: "automatic" },
      });
      const first = await runFirstUseDiagnostics(root);
      assert.deepEqual(
        first.checks.map((check) => check.name),
        [
          "runtime",
          "macos",
          "settings",
          "storage",
          "online",
          "native-image",
          "secret-store-client",
        ],
      );
      assert.deepEqual(
        first.checks.find((check) => check.name === "settings"),
        { name: "settings", status: "passed", code: "settings-valid" },
      );
      assert.deepEqual(
        first.checks.find((check) => check.name === "online"),
        {
          name: "online",
          status: "unconfigured",
          code: "online-disabled",
        },
      );
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

test(
  "online diagnostics require owner and tunnel secrets without exposing them",
  async () => {
    await temporary(async root => {
      const preferences = defaultTeacherPreferences(join(root, "media"));
      await savePreferences(root, {
        ...preferences,
        service: { ...preferences.service, port: 1, portMode: "automatic" },
        online: {
          enabled: true,
          publicUrl: "https://example.test/mcp",
          provider: "cloudflare",
        },
      });
      const reads: string[] = [];
      const ready = await runFirstUseDiagnostics(
        root,
        true,
        secrets(reads),
      );
      assert.deepEqual(
        ready.checks.find((check) => check.name === "online"),
        {
          name: "online",
          status: "unverified",
          code: "connection-verification-required",
        },
      );
      assert.deepEqual(reads, [OWNER_VERIFIER_SECRET, "cloudflare-tunnel"]);
      assert.equal(JSON.stringify(ready).includes("fixture-secret"), false);

      reads.length = 0;
      const missingOwner = await runFirstUseDiagnostics(
        root,
        true,
        secrets(reads, "missing"),
      );
      assert.deepEqual(
        missingOwner.checks.find((check) => check.name === "online"),
        {
          name: "online",
          status: "unconfigured",
          code: "owner-password-missing",
        },
      );
      assert.deepEqual(reads, [OWNER_VERIFIER_SECRET]);

      reads.length = 0;
      const missingTunnel = await runFirstUseDiagnostics(
        root,
        true,
        secrets(reads, "found", "missing"),
      );
      assert.deepEqual(
        missingTunnel.checks.find((check) => check.name === "online"),
        {
          name: "online",
          status: "unconfigured",
          code: "tunnel-token-missing",
        },
      );
      assert.deepEqual(reads, [OWNER_VERIFIER_SECRET, "cloudflare-tunnel"]);
    });
  },
);

test("diagnostics distinguish fixed port conflicts from automatic recovery",
  async () => {
    await temporary(async root => {
      const blocker = createServer();
      await new Promise<void>((resolve, reject) => {
        blocker.once("error", reject);
        blocker.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = blocker.address();
        assert.ok(address && typeof address !== "string");
        if (!address || typeof address === "string") return;
        const preferences = defaultTeacherPreferences(join(root, "media"));
        await savePreferences(root, {
          ...preferences,
          service: {
            ...preferences.service,
            port: address.port,
            portMode: "fixed",
          },
        });
        const fixed = await runFirstUseDiagnostics(root, true);
        assert.deepEqual(
          fixed.checks.find((check) => check.name === "settings"),
          {
            name: "settings",
            status: "failed",
            code: "configured-port-in-use",
          },
        );
        assert.equal(fixed.outcome, "failed");
        const owned = await runFirstUseDiagnostics(
          root,
          true,
          secrets([]),
          address.port,
        );
        assert.deepEqual(
          owned.checks.find((check) => check.name === "settings"),
          { name: "settings", status: "passed", code: "settings-valid" },
        );

        await savePreferences(root, {
          ...preferences,
          service: {
            ...preferences.service,
            port: address.port,
            portMode: "automatic",
          },
        });
        const automatic = await runFirstUseDiagnostics(root, true);
        assert.deepEqual(
          automatic.checks.find((check) => check.name === "settings"),
          { name: "settings", status: "passed", code: "settings-valid" },
        );
      } finally {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
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
