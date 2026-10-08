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
//   - Portable login preference and compensation regression coverage.
// - Must-Not:
//   - Return stored secrets or mutate Blooket during diagnostics.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Disposable files and injected native login-control doubles.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Portable login preference and compensation regression coverage.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setLoginItemPreference, inspectLoginItem } from
  "../../../../src/api/teacher-configuration/application/login-item.ts";
import { loadPreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import type { LoginItemState } from
  "../../../../src/ir/login-item-state/contract/state.ts";

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "login-item-preference-"));
  try { await work(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function control(initial: LoginItemState = "not-registered") {
  let state = initial;
  const changes: boolean[] = [];
  return {
    changes,
    inspect: async () => ({ schemaVersion: 1 as const, state }),
    setEnabled: async (enabled: boolean) => {
      changes.push(enabled);
      state = enabled ? "requires-approval" : "not-registered";
      return { schemaVersion: 1 as const, state };
    },
  };
}
test("login enablement preserves independent settings and actual approval",
  async () => { await fixture(async root => {
    const host = control();
    const before = await loadPreferences(root);
    const enabled = await setLoginItemPreference(root, { enabled: true }, host);
    assert.equal(enabled.ok, true);
    assert.equal(enabled.loginItem.state, "requires-approval");
    const saved = await loadPreferences(root);
    assert.deepEqual(saved, { ...before,
      service: { ...before.service, launchAtLogin: true } });
    const disabled = await setLoginItemPreference(root,
      { enabled: false }, host);
    assert.equal(disabled.ok, true);
    assert.equal(disabled.loginItem.state, "not-registered");
    assert.equal((await loadPreferences(root)).service.launchAtLogin, false);
    assert.deepEqual(host.changes, [true, false]);
  }); });

test("unsupported states and extra fields never register or save preferences",
  async () => { await fixture(async root => {
    const host = control("unsupported");
    const stopped = await setLoginItemPreference(root, { enabled: true }, host);
    assert.equal(stopped.ok, false);
    assert.deepEqual(host.changes, []);
    assert.equal((await loadPreferences(root)).service.launchAtLogin, false);
    for (const input of [{ enabled: 1 }, { enabled: true, path: "/tmp" }, {}])
      await assert.rejects(setLoginItemPreference(root, input, host));
    assert.deepEqual(host.changes, []);
  }); });

test("failed preference persistence compensates the observed OS state",
  async () => { await fixture(async root => {
    const host = control();
    await loadPreferences(root);
    const lock = await tryAcquireFileLock(join(root, ".settings.lock"));
    assert.ok(lock.ok);
    try {
      const stopped = await setLoginItemPreference(root,
        { enabled: true }, host);
      assert.equal(stopped.ok, false);
      assert.equal("code" in stopped && stopped.code, "settings-save-failed");
      assert.equal(stopped.loginItem.state, "not-registered");
      assert.deepEqual(host.changes, [true, false]);
      assert.equal((await loadPreferences(root)).service.launchAtLogin, false);
    } finally { await lock.lock.release(); }
  }); });

test("rollback failures remain visible with the actual remaining OS state",
  async () => { await fixture(async root => {
    const host = control();
    await loadPreferences(root);
    const lock = await tryAcquireFileLock(join(root, ".settings.lock"));
    assert.ok(lock.ok);
    try {
      const stopped = await setLoginItemPreference(root, { enabled: true }, {
        inspect: host.inspect,
        setEnabled: async enabled => {
          if (!enabled) throw new Error("synthetic rollback denial");
          return host.setEnabled(enabled);
        },
      });
      assert.equal(stopped.ok, false);
      assert.equal("code" in stopped && stopped.code,
        "login-item-recovery-required");
      assert.equal(stopped.loginItem.state, "requires-approval");
      assert.equal((await loadPreferences(root)).service.launchAtLogin, false);
    } finally { await lock.lock.release(); }
  }); });

test("occupied configuration lock stops before native mutation",
  async () => { await fixture(async root => {
    const host = control();
    const lock = await tryAcquireFileLock(join(root, ".configuration.lock"));
    assert.ok(lock.ok);
    try {
      const stopped = await setLoginItemPreference(root,
        { enabled: true }, host);
      assert.equal(stopped.ok, false);
      assert.deepEqual(host.changes, []);
    } finally { await lock.lock.release(); }
  }); });

test("malformed native status never becomes a product approval claim",
  async () => {
    assert.equal((await inspectLoginItem({
      inspect: async () => ({ schemaVersion: 1, state: "enabled",
        extra: "provider data" }),
      setEnabled: async () => { throw new Error("unused"); },
    })).state, "unavailable");
  });
