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
//   - Exclusive bounded durable storage of admitted installation records.
// - Must-Not:
//   - Grant trust, select update phases, launch apps, or replace bundles.
// - Allows:
//   - Inputs: Local directory authority and selected journal transitions.
//   - Outputs: Durable journal facts or stable ownership/storage refusals.
//   - Side effects: Local locks, bounded reads, and atomic journal writes.
// - Split-When:
//   - Another installation target needs a distinct persistence contract.
// - Merge-When:
//   - Installation facts no longer need durable recovery.
// - Summary:
//   - Records intent and observation without inferring installed health.
// - Description:
//   - Paths and signed envelopes cannot grant filesystem or trust authority.
// - Usage:
//   - Reassess local publisher trust, ownership, and health before any action.
// - Defaults:
//   - Invalid or contradictory records cannot authorize recovery.
//
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rename,
  rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { openUpdateInstallationStore } from
  "../../../../src/platforms/update-journals/adapter-outbound/store.ts";
import { advanceUpdateInstallationJournal } from
  "../../../../src/ir/application-updates/contract/installation.ts";
import { assessInstallationRecovery } from
  "../../../../src/ir/application-updates/domain/recovery.ts";
import { journalFixture } from
  "../../../ir/application-updates/contract/fixtures.ts";
import { exchangeBundles } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/exchange.ts";
import { observeExchange } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/identity.ts";
import { fixture as exchangeFixture } from
  "../../bundle-exchange/adapter-outbound/fixtures.ts";

async function temporary(callback: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "update-journal-")));
  try { await callback(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("close drains accepted writes and old handles cannot release new owners",
  async () => {
    await temporary(async root => {
      const directory = join(root, "journal");
      const opened = await openUpdateInstallationStore(directory);
      assert.ok(opened.ok);
      assert.equal(await opened.store.read(), undefined);
      const record = journalFixture();
      const creating = opened.store.create(record);
      const closing = opened.store.close();
      assert.equal(opened.store.close(), closing);
      await assert.rejects(opened.store.read(), /closed/);
      assert.equal(await creating, "created");
      await closing;
      const next = await openUpdateInstallationStore(directory);
      assert.ok(next.ok);
      try {
        assert.deepEqual(await next.store.read(), record);
        assert.equal((await lstat(directory)).mode & 0o077, 0);
        const file = join(directory, "installation.json");
        assert.equal((await lstat(file)).mode & 0o077, 0);
        await opened.store.close();
        assert.deepEqual(await openUpdateInstallationStore(directory), {
          ok: false, reason: "busy" });
      } finally { await next.store.close(); }
    });
  });

test("exclusive creation and compare-and-replace preserve existing work",
  async () => {
    await temporary(async root => {
      const opened = await openUpdateInstallationStore(join(root, "journal"));
      assert.ok(opened.ok);
      try {
        const initial = journalFixture();
        assert.equal(await opened.store.create(initial), "created");
        assert.equal(await opened.store.create(journalFixture()), "exists");
        const intent = advanceUpdateInstallationJournal(initial,
          "exchange-intent");
        assert.ok(intent.ok);
        await opened.store.replace(initial, intent.value);
        await assert.rejects(opened.store.replace(initial, intent.value),
          /conflict/);
        assert.deepEqual(await opened.store.read(), intent.value);
        const observed = { ...intent.value, phase: "new-observed" };
        await assert.rejects(opened.store.replace(intent.value,
          { ...observed, installedVersion: "26.3.99" }), /transition-invalid/);
        await assert.rejects(opened.store.replace(intent.value,
          { ...intent.value, phase: "new-healthy" }), /transition-invalid/);
        assert.deepEqual(await opened.store.read(), intent.value);
      } finally { await opened.store.close(); }
    });
  });

test("corrupt, unknown, oversized and invalid UTF-8 records are preserved",
  async () => {
    for (const source of ["{", "{}", "x".repeat(16_385),
      JSON.stringify({ ...journalFixture(), unknown: true }),
      Buffer.from([0xff])]) {
      await temporary(async root => {
        const directory = join(root, "journal");
        const opened = await openUpdateInstallationStore(directory);
        assert.ok(opened.ok);
        const path = join(directory, "installation.json");
        try {
          await writeFile(path, source, { mode: 0o600 });
          await assert.rejects(opened.store.read(), /update-journal/);
          await assert.rejects(opened.store.create(journalFixture()),
            /update-journal/);
          assert.deepEqual(await readFile(path), Buffer.from(source));
        } finally { await opened.store.close(); }
      });
    }
  });

test("symbolic, hard-linked and publicly readable records cannot recover",
  async () => {
    for (const kind of ["symbolic", "hard-link", "public"]) {
      await temporary(async root => {
        const directory = join(root, "journal");
        const opened = await openUpdateInstallationStore(directory);
        assert.ok(opened.ok);
        const target = join(root, "preserved.json");
        const source = JSON.stringify(journalFixture());
        const path = join(directory, "installation.json");
        await writeFile(target, source, { mode: 0o600 });
        try {
          if (kind === "symbolic") await symlink(target, path);
          else if (kind === "hard-link") await link(target, path);
          else { await writeFile(path, source); await chmod(path, 0o644); }
          await assert.rejects(opened.store.read(), /storage-unavailable/);
          await assert.rejects(opened.store.create(journalFixture()),
            /storage-unavailable/);
          assert.equal(await readFile(target, "utf8"), source);
        } finally { await opened.store.close(); }
      });
    }
  });

test("symbolic parents, replaced directories and public storage fail closed",
  async () => {
    await temporary(async root => {
      const alias = join(root, "alias");
      await symlink(root, alias);
      assert.deepEqual(await openUpdateInstallationStore(
        join(alias, "journal")),
        { ok: false, reason: "storage" });
      const publicDirectory = join(root, "public");
      await mkdir(publicDirectory, { mode: 0o755 });
      // An inherited 0077 umask can silently create this as private 0700.
      // Set the unsafe mode explicitly so the refusal is actually exercised.
      await chmod(publicDirectory, 0o755);
      assert.deepEqual(await openUpdateInstallationStore(publicDirectory),
        { ok: false, reason: "storage" });
      const directory = join(root, "journal");
      const opened = await openUpdateInstallationStore(directory);
      assert.ok(opened.ok);
      try {
        await rename(directory, join(root, "preserved"));
        await mkdir(directory, { mode: 0o700 });
        await assert.rejects(opened.store.read(), /storage-unavailable/);
        await assert.rejects(opened.store.create(journalFixture()),
          /storage-unavailable/);
      } finally { await opened.store.close(); }
    });
  });

test("a separate process cannot open another installation owner's journal",
  async () => {
    await temporary(async root => {
      const directory = join(root, "journal");
      const opened = await openUpdateInstallationStore(directory);
      assert.ok(opened.ok);
      try {
        const module = new URL(
          "../../../../src/platforms/update-journals/adapter-outbound/store.ts",
          import.meta.url).href;
        const source = "const { openUpdateInstallationStore } = await import(" +
          JSON.stringify(module) + "); console.log(JSON.stringify(await " +
          "openUpdateInstallationStore(process.argv[1])));";
        const child = await promisify(execFile)(process.execPath,
          ["--input-type=module", "-e", source, directory],
          { timeout: 10_000, maxBuffer: 4_096 });
        assert.deepEqual(JSON.parse(child.stdout),
          { ok: false, reason: "busy" });
      } finally { await opened.store.close(); }
    });
  });

test("durable intent recovers a real exchanged pair and inverse rollback",
  async () => {
    const item = await exchangeFixture();
    const directory = join(item.root, "journal");
    let opened = await openUpdateInstallationStore(directory);
    assert.ok(opened.ok);
    try {
      let record = { ...journalFixture(),
        installationId: basename(dirname(item.options.candidatePath))
          .slice(".blooket-api.update-".length),
        installedPath: item.options.installedPath,
        candidatePath: item.options.candidatePath,
        installedIdentity: item.options.installedIdentity,
        candidateIdentity: item.options.candidateIdentity };
      assert.equal(await opened.store.create(record), "created");
      async function advance(phase: Parameters<
        typeof advanceUpdateInstallationJournal>[1]) {
        const next = advanceUpdateInstallationJournal(record, phase);
        assert.ok(next.ok);
        assert.ok(opened.ok);
        await opened.store.replace(record, next.value);
        record = next.value;
      }
      await advance("exchange-intent");
      assert.equal((await exchangeBundles(item.options)).status, "exchanged");
      // Restart before recording completion; the actual old app is retained.
      await opened.store.close();
      opened = await openUpdateInstallationStore(directory);
      assert.ok(opened.ok);
      const recovered = await opened.store.read();
      const orientation = await observeExchange(item.options);
      assert.equal(assessInstallationRecovery(recovered, orientation, false),
        "wait-for-writer");
      assert.equal(assessInstallationRecovery(recovered, orientation, true),
        "check-new-health");
      await advance("new-observed");
      await advance("rollback-intent");
      assert.equal((await exchangeBundles({ ...item.options,
        installedIdentity: item.options.candidateIdentity,
        candidateIdentity: item.options.installedIdentity })).status,
      "exchanged");
      await opened.store.close();
      opened = await openUpdateInstallationStore(directory);
      assert.ok(opened.ok);
      assert.equal(assessInstallationRecovery(await opened.store.read(),
        await observeExchange(item.options), true), "check-old-health");
      await advance("old-observed");
      await advance("old-healthy");
      assert.equal(await readFile(join(item.options.installedPath, "marker"),
        "utf8"), "old version");
      assert.equal(await readFile(join(item.options.candidatePath, "marker"),
        "utf8"), "new version");
    } finally {
      if (opened.ok) await opened.store.close();
      await item.cleanup();
    }
  });


test("failed close can retry while admitted work remains permanently closed",
  async () => {
    await temporary(async root => {
      const directory = join(root, "journal");
      const opened = await openUpdateInstallationStore(directory);
      assert.ok(opened.ok);
      const lock = join(directory, ".installation.lock");
      const original = await readFile(lock, "utf8");
      try {
        const foreign = JSON.stringify({ version: 1, pid: process.pid,
          token: "synthetic-other-owner" }) + "\n";
        await writeFile(lock, foreign);
        await assert.rejects(opened.store.close(), /close-failed/);
        assert.equal(await readFile(lock, "utf8"), foreign);
        await assert.rejects(opened.store.read(), /closed/);
        await writeFile(lock, original);
        await opened.store.close();
        await assert.rejects(opened.store.read(), /closed/);
        const next = await openUpdateInstallationStore(directory);
        assert.ok(next.ok);
        await next.store.close();
      } finally {
        await opened.store.close();
      }
    });
  });

test("a FIFO without a writer cannot hang journal recovery",
  { timeout: 3_000 }, async () => {
    await temporary(async root => {
      const directory = join(root, "journal");
      const opened = await openUpdateInstallationStore(directory);
      assert.ok(opened.ok);
      try {
        const path = join(directory, "installation.json");
        await promisify(execFile)("mkfifo", ["-m", "600", path],
          { timeout: 1_000, maxBuffer: 4_096 });
        await assert.rejects(opened.store.read(), /storage-unavailable/);
        assert.equal((await lstat(path)).isFIFO(), true);
      } finally { await opened.store.close(); }
    });
  });

test("queued creation owns the original directory and signed-context facts",
  async () => { await temporary(async root => {
    const opened = await openUpdateInstallationStore(join(root, "journal"));
    assert.ok(opened.ok);
    try {
      const input = journalFixture();
      const expected = structuredClone(input);
      const creating = opened.store.create(input);
      Reflect.set(input.installedIdentity, "inode", "20");
      Reflect.set(input.candidateIdentity, "inode", "30");
      Reflect.set(input.document.manifest.assets[0]!, "sha256", "b".repeat(64));
      Reflect.set(input.document, "signature", "A".repeat(86));
      assert.equal(await creating, "created");
      assert.deepEqual(await opened.store.read(), expected);
    } finally { await opened.store.close(); }
  }); });

test("queued replacement owns both expected and next intent before I/O",
  async () => { await temporary(async root => {
    const opened = await openUpdateInstallationStore(join(root, "journal"));
    assert.ok(opened.ok);
    try {
      const input = journalFixture();
      await opened.store.create(input);
      const next = advanceUpdateInstallationJournal(input, "exchange-intent");
      assert.ok(next.ok);
      const expected = structuredClone(next.value);
      const replacing = opened.store.replace(input, next.value);
      Reflect.set(input.installedIdentity, "inode", "20");
      Reflect.set(next.value, "phase", "old-observed");
      await replacing;
      assert.deepEqual(await opened.store.read(), expected);
    } finally { await opened.store.close(); }
  }); });

test("invalid creation cannot become admitted while its operation is queued",
  async () => { await temporary(async root => {
    const opened = await openUpdateInstallationStore(join(root, "journal"));
    assert.ok(opened.ok);
    try {
      const invalid = { ...journalFixture(), phase: "new-healthy" };
      const creating = opened.store.create(invalid);
      invalid.phase = "prepared";
      await assert.rejects(creating, /update-journal-invalid/);
      assert.equal(await opened.store.read(), undefined);
    } finally { await opened.store.close(); }
  }); });

test("invalid replacement cannot change phase validity while queued",
  async () => { await temporary(async root => {
    const opened = await openUpdateInstallationStore(join(root, "journal"));
    assert.ok(opened.ok);
    try {
      const input = journalFixture();
      await opened.store.create(input);
      const invalid = { ...input, phase: "new-healthy" };
      const replacing = opened.store.replace(input, invalid);
      invalid.phase = "exchange-intent";
      await assert.rejects(replacing, /update-journal-transition-invalid/);
      assert.deepEqual(await opened.store.read(), input);
    } finally { await opened.store.close(); }
  }); });
