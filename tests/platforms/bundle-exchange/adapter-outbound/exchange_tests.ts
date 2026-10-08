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
//   - Guarded silent atomic exchange of two admitted application directories.
// - Must-Not:
//   - Choose update policy, verify publishers, remove apps, or open Terminal.
// - Allows:
//   - Inputs: Trusted local paths and exact expected filesystem identities.
//   - Outputs: Observed exchange orientation or bounded failure reasons.
//   - Side effects: Native atomic directory exchange and directory syncs.
// - Split-When:
//   - Update orchestration needs semantic journal/restart authority.
// - Merge-When:
//   - Node exposes the required atomic exchange syscall directly.
// - Summary:
//   - Retains both applications and inspects outcomes after native completion.
// - Description:
//   - An uncertain process result cannot authorize a blind second exchange.
// - Usage:
//   - Hold the installation lock and quiesce writers in trusted composition.
// - Defaults:
//   - Unsupported hosts and changed identities never invoke exchange.
//
import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdir, readFile, rename, symlink } from
  "node:fs/promises";
import { join } from "node:path";
import { exchangeBundles } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/exchange.ts";
import { directoryIdentity, observeExchange } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/identity.ts";
import { execute, fixture } from "./fixtures.ts";

async function markers(item: Awaited<ReturnType<typeof fixture>>) {
  return await Promise.all([
    readFile(join(item.options.installedPath, "marker"), "utf8"),
    readFile(join(item.options.candidatePath, "marker"), "utf8"),
  ]);
}

test("native exchange retains both directories and cannot blindly repeat",
  { skip: !["linux", "darwin"].includes(process.platform) }, async () => {
    const item = await fixture();
    try {
      assert.deepEqual(await exchangeBundles(item.options), {
        status: "exchanged", orientation: "exchanged", durable: true });
      assert.deepEqual(await markers(item), ["new version", "old version"]);
      assert.equal(await observeExchange(item.options), "exchanged");
      assert.deepEqual(await exchangeBundles(item.options), {
        status: "exchange-failed", reason: "identity",
        orientation: "exchanged" });
      assert.deepEqual(await markers(item), ["new version", "old version"]);
      const rollback = { ...item.options,
        installedIdentity: item.options.candidateIdentity,
        candidateIdentity: item.options.installedIdentity };
      assert.equal((await exchangeBundles(rollback)).status, "exchanged");
      assert.deepEqual(await markers(item), ["old version", "new version"]);
    } finally { await item.cleanup(); }
  });

test("a lost native acknowledgement is inspected rather than blindly replayed",
  async () => {
    const item = await fixture();
    try {
      const result = await exchangeBundles({ ...item.options,
        execute: async (file, args) => {
          await execute(file, [...args]);
          throw new Error("synthetic acknowledgement lost after exchange");
        } });
      assert.deepEqual(result, { status: "exchange-failed", reason: "native",
        orientation: "exchanged" });
      assert.deepEqual(await markers(item), ["new version", "old version"]);
    } finally { await item.cleanup(); }
  });

test("a failed native operation preserves the exact original orientation",
  async () => {
    const item = await fixture(false);
    try {
      const result = await exchangeBundles({ ...item.options,
        execute: async () => { throw new Error("synthetic denied exchange"); },
      });
      assert.deepEqual(result, { status: "exchange-failed", reason: "native",
        orientation: "original" });
      assert.deepEqual(await markers(item), ["old version", "new version"]);
    } finally { await item.cleanup(); }
  });

test("changed app identity, symbolic paths and public staging refuse execution",
  async () => {
    for (const change of ["identity", "link", "permissions"]) {
      const item = await fixture(false);
      let calls = 0;
      try {
        if (change === "permissions") await chmod(item.prepared, 0o755);
        else {
          const saved = join(item.root, "preserved-app");
          await rename(item.options.installedPath, saved);
          if (change === "link")
            await symlink(saved, item.options.installedPath);
          else await mkdir(item.options.installedPath);
        }
        const result = await exchangeBundles({ ...item.options,
          execute: async () => { calls++; } });
        assert.equal(result.status, "exchange-failed");
        assert.equal(calls, 0);
        assert.equal(await readFile(join(item.options.candidatePath, "marker"),
          "utf8"), "new version");
      } finally { await item.cleanup(); }
    }
  });

test("unsupported hosts, malformed identities and cancellation do not execute",
  async () => {
    const item = await fixture(false);
    let calls = 0;
    try {
      const command = async () => { calls++; };
      const unsupported = await exchangeBundles({ ...item.options,
        host: { platform: "linux", architecture: "x64" }, execute: command });
      assert.equal(unsupported.status, "exchange-failed");
      if (unsupported.status === "exchange-failed")
        assert.equal(unsupported.reason, "unsupported-host");
      for (const identity of [{ device: "-1", inode: "1" },
        { device: "0", inode: "0" }, { device: "00", inode: "1" },
        { device: "0", inode: "18446744073709551616" }])
        assert.equal((await exchangeBundles({ ...item.options,
          installedIdentity: identity, execute: command })).status,
        "exchange-failed");
      assert.equal((await exchangeBundles({ ...item.options,
        signal: AbortSignal.abort(), execute: command })).status,
      "exchange-failed");
      assert.equal(calls, 0);
      assert.deepEqual(await markers(item), ["old version", "new version"]);
    } finally { await item.cleanup(); }
  });

test("cancellation waits for a live native writer and reports the actual swap",
  async () => {
    const item = await fixture();
    const began = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const controller = new AbortController();
    let returned = false;
    try {
      const pending = exchangeBundles({ ...item.options,
        signal: controller.signal, execute: async (file, args) => {
          began.resolve(); await release.promise;
          await execute(file, [...args]);
        } }).then(value => { returned = true; return value; });
      await began.promise;
      controller.abort();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(returned, false);
      assert.equal((await lstat(item.options.installedPath)).isDirectory(),
        true);
      release.resolve();
      assert.deepEqual(await pending, { status: "exchange-failed",
        reason: "cancelled", orientation: "exchanged" });
      assert.deepEqual(await markers(item), ["new version", "old version"]);
    } finally { release.resolve(); await item.cleanup(); }
  });

test("native identity guards refuse a race after the Node preflight",
  async () => {
    const item = await fixture();
    try {
      const result = await exchangeBundles({ ...item.options,
        execute: async (file, args) => {
          await rename(item.options.candidatePath, join(item.prepared, "kept"));
          await mkdir(item.options.candidatePath);
          await execute(file, [...args]);
        } });
      assert.deepEqual(result, { status: "exchange-failed", reason: "native",
        orientation: "unknown" });
      assert.equal(await readFile(join(item.options.installedPath, "marker"),
        "utf8"), "old version");
      assert.equal(await readFile(join(item.prepared, "kept/marker"), "utf8"),
        "new version");
      assert.notDeepEqual(await directoryIdentity(item.options.candidatePath),
        item.options.candidateIdentity);
    } finally { await item.cleanup(); }
  });


test("native parent ownership guards catch permissions changed after preflight",
  async () => {
    const item = await fixture();
    try {
      const result = await exchangeBundles({ ...item.options,
        execute: async (file, args) => {
          await chmod(item.prepared, 0o755);
          await execute(file, [...args]);
        } });
      assert.deepEqual(result, { status: "exchange-failed", reason: "native",
        orientation: "original" });
      assert.deepEqual(await markers(item), ["old version", "new version"]);
    } finally { await item.cleanup(); }
  });

test("unsafe helper permissions and foreign locations cannot reach execution",
  async () => {
    const item = await fixture(false);
    let calls = 0;
    try {
      const command = async () => { calls++; };
      await chmod(item.options.helperPath, 0o777);
      assert.deepEqual(await exchangeBundles({ ...item.options,
        execute: command }), { status: "exchange-failed", reason: "helper",
        orientation: "unknown" });
      for (const candidatePath of [item.options.installedPath,
        join(item.root, "foreign/Blooket API.app"),
        item.options.candidatePath + "/../Blooket API.app"])
        assert.deepEqual(await exchangeBundles({ ...item.options,
          candidatePath, execute: command }), { status: "exchange-failed",
          reason: "locations", orientation: "unknown" });
      assert.equal(calls, 0);
      assert.deepEqual(await markers(item), ["old version", "new version"]);
    } finally { await item.cleanup(); }
  });
