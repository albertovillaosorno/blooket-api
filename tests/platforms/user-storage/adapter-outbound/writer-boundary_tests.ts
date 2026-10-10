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
//   - Canonical writer exclusion and retained lease regression coverage.
// - Must-Not:
//   - Install apps, read lesson content, or reclaim uncertain writer leases.
// - Allows:
//   - Inputs: The trusted local user-data root.
//   - Outputs: Held command ownership or exclusive update admission.
//   - Side effects: Private lease/lock files and bounded directory iteration.
// - Split-When:
//   - Another persistent writer needs an independent update boundary.
// - Merge-When:
//   - Canonical user-data writes no longer cross process boundaries.
// - Summary:
//   - Keeps admitted command writers excluded from application replacement.
// - Description:
//   - Unknown storage and symbolic paths fail closed without reading content.
// - Usage:
//   - Hold the boundary through observation and the entire safe restart.
// - Defaults:
//   - At most 1,024 simultaneous retained command leases.
//
import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { acquireCanonicalDataWriter, acquireCanonicalDataUpdateBoundary,
  withCanonicalDataWriter } from
  "../../../../src/platforms/user-storage/adapter-outbound/writer-boundary.ts";

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "canonical-data-boundary-"));
  try { await work(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function close(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGKILL");
  await closed;
}

test("independent admitted writers exclude updates until every lease closes",
  async () => {
    await fixture(async root => {
      const first = await acquireCanonicalDataWriter(root);
      const second = await acquireCanonicalDataWriter(root);
      assert.ok(first.ok); assert.ok(second.ok);
      try {
        assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
          { ok: false, reason: "writer-active" });
        await first.release();
        assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
          { ok: false, reason: "writer-active" });
      } finally { await first.release(); await second.release(); }
      const update = await acquireCanonicalDataUpdateBoundary(root);
      assert.ok(update.ok);
      try {
        assert.deepEqual(await acquireCanonicalDataWriter(root),
          { ok: false, reason: "busy" });
      } finally { await update.release(); }
      assert.deepEqual(await readdir(join(root, ".canonical-writers")), []);
    });
  },
);

test("failed commands release only their own lease after completion",
  async () => {
    await fixture(async root => {
      const other = await acquireCanonicalDataWriter(root); assert.ok(other.ok);
      try {
        await assert.rejects(withCanonicalDataWriter(root, async () => {
          throw new Error("synthetic-command-failure");
        }), /synthetic-command-failure/);
        assert.equal((await readdir(join(root, ".canonical-writers"))).length,
          1);
        assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
          { ok: false, reason: "writer-active" });
      } finally { await other.release(); }
    });
  },
);

test("actual canonical CLI cannot save during held update admission",
  { timeout: 10_000 }, async () => {
    await fixture(async root => {
      await writeFile(join(root, "teacher-data-marker"), "preserved-data");
      const update = await acquireCanonicalDataUpdateBoundary(root);
      assert.ok(update.ok);
      try {
        const child = spawn(process.execPath, [
          new URL("../../../../src/cli/executable/adapter-inbound/blooket.ts",
            import.meta.url).pathname, "command", "--json",
        ], { stdio: ["pipe", "pipe", "ignore"],
          env: { BLOOKET_DATA_HOME: root } });
        const chunks: Buffer[] = [];
        child.stdout.on("data", chunk => { chunks.push(Buffer.from(chunk)); });
        const closed = once(child, "close");
        child.stdin.end(JSON.stringify({ version: 1, operationId: "test:save",
          command: "skills.put", payload: { id: "example", text: "Guidance",
            expectedRevision: null } }));
        const [code] = await closed;
        assert.equal(code, 2);
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        assert.equal(result.ok, false);
        assert.equal(result.issues[0].code, "canonical-data-busy");
        await assert.rejects(readFile(join(root, "skills", "example.md")));
        await assert.rejects(readFile(join(root, "settings.json")));
        assert.equal(await readFile(join(root, "teacher-data-marker"), "utf8"),
          "preserved-data");
      } finally { await update.release(); }
    });
  },
);

function writer(root: string) {
  const module = new URL(
    "../../../../src/platforms/user-storage/adapter-outbound/" +
      "writer-boundary.ts",
    import.meta.url).href;
  return spawn(process.execPath, ["--input-type=module", "-e", `
    import { withCanonicalDataWriter } from ${JSON.stringify(module)};
    await withCanonicalDataWriter(${JSON.stringify(root)}, async () => {
      const completion = Promise.withResolvers();
      process.on('message', () => completion.resolve());
      process.send({ kind: 'test-writer-entered' });
      await completion.promise;
    });
    process.send({ kind: 'test-writer-finished' }, () => process.disconnect());
  `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
}

test("a separately running command retains exclusion until actual completion",
  { timeout: 10_000 }, async () => {
    await fixture(async root => {
      const child = writer(root);
      try {
        await once(child, "message");
        assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
          { ok: false, reason: "writer-active" });
        const closed = once(child, "close");
        child.send({ complete: true });
        await closed;
        const update = await acquireCanonicalDataUpdateBoundary(root);
        assert.ok(update.ok); await update.release();
      } finally { await close(child); }
    });
  },
);

test("a dead parent does not authorize removal of an orphaned writer lease",
  { timeout: 10_000 }, async () => {
    await fixture(async root => {
      const child = writer(root);
      try {
        await once(child, "message");
        const catalog = join(root, ".canonical-writers");
        const leases = await readdir(catalog);
        assert.equal(leases.length, 1);
        const original = await readFile(join(catalog, leases[0]!));
        await close(child);
        assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
          { ok: false, reason: "writer-active" });
        assert.deepEqual(await readdir(catalog), leases);
        assert.deepEqual(await readFile(join(catalog, leases[0]!)), original);
      } finally { await close(child); }
    });
  },
);

test("symbolic, foreign and oversized lease storage cannot admit updates",
  async () => {
    await fixture(async root => {
      const directory = join(root, ".canonical-writers");
      await mkdir(directory, { mode: 0o700 });
      const invalid = join(directory, "foreign");
      await writeFile(invalid, "preserve", { mode: 0o600 });
      assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
        { ok: false, reason: "storage" });
      assert.equal(await readFile(invalid, "utf8"), "preserve");
      await rm(invalid);
      const symbolic = join(directory, randomUUID() + ".lock");
      const target = join(root, "foreign-file");
      await writeFile(target, "preserve", { mode: 0o600 });
      await symlink(target, symbolic);
      assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
        { ok: false, reason: "storage" });
      assert.equal(await readFile(target, "utf8"), "preserve");
      await rm(symbolic);
      const large = join(directory, randomUUID() + ".lock");
      await writeFile(large, "x".repeat(257), { mode: 0o600 });
      assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
        { ok: false, reason: "storage" });
      await rm(large);
      await chmod(directory, 0o755);
      assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
        { ok: false, reason: "storage" });
    });
  },
);


test("a crashed installer keeps new commands and replacement excluded",
  { timeout: 10_000 }, async () => {
    await fixture(async root => {
      const module = new URL(
        "../../../../src/platforms/user-storage/adapter-outbound/" +
          "writer-boundary.ts", import.meta.url).href;
      const child = spawn(process.execPath, ["--input-type=module", "-e", `
        import { acquireCanonicalDataUpdateBoundary } from
          ${JSON.stringify(module)};
        const owned = await acquireCanonicalDataUpdateBoundary(
          ${JSON.stringify(root)});
        if (!owned.ok) throw Error('synthetic-admission-failed');
        process.on('message', () => {});
        process.send({ ready: true });
      `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
      try {
        await once(child, "message");
        const marker = join(root, ".canonical-installation.lock");
        const original = await readFile(marker);
        await close(child);
        assert.deepEqual(await acquireCanonicalDataWriter(root),
          { ok: false, reason: "busy" });
        assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
          { ok: false, reason: "busy" });
        assert.deepEqual(await readFile(marker), original);
      } finally { await close(child); }
    });
  },
);


test("simultaneous normal registrations remain independently usable",
  async () => {
    await fixture(async root => {
      const writers = await Promise.all(Array.from({ length: 4 }, () =>
        acquireCanonicalDataWriter(root)));
      try {
        assert.equal(writers.every(writer => writer.ok), true);
        assert.equal((await readdir(join(root, ".canonical-writers"))).length,
          4);
        assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
          { ok: false, reason: "writer-active" });
      } finally {
        for (const writer of writers) if (writer.ok) await writer.release();
      }
    });
  },
);


test("first-use writer admission creates a private fresh user-data root",
  async () => {
    await fixture(async parent => {
      const root = join(parent, "fresh");
      await withCanonicalDataWriter(root, async () => {
        await writeFile(join(root, "teacher-data-marker"), "preserved-data");
      });
      const update = await acquireCanonicalDataUpdateBoundary(root);
      assert.ok(update.ok);
      try {
        assert.equal(await readFile(join(root, "teacher-data-marker"), "utf8"),
          "preserved-data");
      } finally { await update.release(); }
    });
  },
);


test("physical lease catalogs are bounded without clearing unknown ownership",
  async () => {
    await fixture(async root => {
      const directory = join(root, ".canonical-writers");
      await mkdir(directory, { mode: 0o700 });
      for (let offset = 0; offset < 1_025; offset += 32) {
        await Promise.all(Array.from({ length: Math.min(32, 1_025 - offset) },
          () => writeFile(join(directory, randomUUID() + ".lock"),
            "retained-ownership", { mode: 0o600 })));
      }
      assert.deepEqual(await acquireCanonicalDataUpdateBoundary(root),
        { ok: false, reason: "storage" });
      assert.deepEqual(await acquireCanonicalDataWriter(root),
        { ok: false, reason: "storage" });
      assert.equal((await readdir(directory)).length, 1_025);
    });
  },
);
