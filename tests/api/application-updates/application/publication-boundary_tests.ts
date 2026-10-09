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
//   - Admission of an update boundary against active or unresolved publication.
// - Must-Not:
//   - Install apps, stop services, clear journals, or replay Blooket writes.
// - Allows:
//   - Inputs: Trusted local user-data authority.
//   - Outputs: Held publication exclusion or bounded recovery/ownership stops.
//   - Side effects: Shared local lock acquisition and directory observation.
// - Split-When:
//   - Other user-data writers require separate update coordination.
// - Merge-When:
//   - Installation composition owns this policy without external callers.
// - Summary:
//   - Keeps publication excluded after inspection until the caller releases it.
// - Description:
//   - Any remaining attempt, including confirmed state, blocks installation.
// - Usage:
//   - Acquire before service quiescence; retain through restart or recovery.
// - Defaults:
//   - Busy or unsafe state cannot authorize an application exchange.
//
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireUpdatePublicationBoundary } from
  "../../../../src/api/application-updates/application/publication-boundary.ts";

async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "update-publication-boundary-"));
  try { await work(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("update owners retain exclusive admission and release idempotently",
  async () => { await fixture(async root => {
    const first = await acquireUpdatePublicationBoundary(root);
    assert.ok(first.ok);
    assert.deepEqual(await acquireUpdatePublicationBoundary(root), {
      ok: false, reason: "publication-busy",
    });
    await first.release();
    await first.release();
    const next = await acquireUpdatePublicationBoundary(root);
    assert.ok(next.ok);
    await next.release();
  }); });

test("attempt bytes are preserved regardless of journal validity or phase",
  async () => { await fixture(async root => {
    const directory = join(root, "publications", "a".repeat(64));
    await mkdir(directory, { recursive: true });
    const path = join(directory, "attempt.json");
    for (const source of ["not-json", '{"phase":"confirmed"}',
      '{"phase":"attempting"}']) {
      await writeFile(path, source);
      assert.deepEqual(await acquireUpdatePublicationBoundary(root), {
        ok: false, reason: "publication-recovery-required",
      });
      assert.equal(await readFile(path, "utf8"), source);
    }
    await rm(path);
    const clear = await acquireUpdatePublicationBoundary(root);
    assert.ok(clear.ok);
    await clear.release();
  }); });

test("symbolic publication storage cannot authorize update ownership",
  async () => { await fixture(async root => {
    const outside = join(root, "unrelated");
    await mkdir(outside);
    await writeFile(join(outside, "attempt.json"), "keep");
    const directory = join(root, "publications");
    await symlink(outside, directory);
    assert.deepEqual(await acquireUpdatePublicationBoundary(root), {
      ok: false, reason: "publication-storage-unavailable",
    });
    assert.equal(await readFile(join(outside, "attempt.json"), "utf8"),
      "keep");
    await rm(directory);
    const clear = await acquireUpdatePublicationBoundary(root);
    assert.ok(clear.ok);
    await clear.release();
  }); });

test("unknown folders, stale locks, and symbolic entries fail closed",
  async () => { await fixture(async root => {
    const parent = join(root, "publications");
    await mkdir(parent);
    const foreign = join(parent, "unknown");
    await mkdir(foreign);
    assert.deepEqual(await acquireUpdatePublicationBoundary(root), {
      ok: false, reason: "publication-storage-unavailable",
    });
    await rm(foreign, { recursive: true });
    const directory = join(parent, "a".repeat(64));
    await mkdir(directory);
    const lock = join(directory, "command.lock");
    await writeFile(lock, "keep");
    assert.deepEqual(await acquireUpdatePublicationBoundary(root), {
      ok: false, reason: "publication-storage-unavailable",
    });
    assert.equal(await readFile(lock, "utf8"), "keep");
    await rm(lock);
    await symlink(join(root, "unrelated"), join(directory, "attempt.json"));
    assert.deepEqual(await acquireUpdatePublicationBoundary(root), {
      ok: false, reason: "publication-storage-unavailable",
    });
  }); });


test("a separate publication process excludes updater ownership",
  async () => { await fixture(async root => {
    const module = new URL(
      "../../../../src/platforms/write-checkpoint-files/" +
        "adapter-outbound/update-boundary.ts", import.meta.url,
    ).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      const capability = await import(${JSON.stringify(module)});
      const { acquirePublicationBoundary } = capability;
      const owned = await acquirePublicationBoundary(process.argv[1]);
      if (!owned.ok) process.exit(1);
      console.log("owned");
      for await (const part of process.stdin) {}
      await owned.lock.release();
    `, root], { stdio: ["pipe", "pipe", "ignore"] });
    const closed = once(child, "close");
    const lines = createInterface({ input: child.stdout });
    try {
      const [ready] = await once(lines, "line", {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(ready, "owned");
      assert.deepEqual(await acquireUpdatePublicationBoundary(root), {
        ok: false, reason: "publication-busy",
      });
      child.stdin.end();
      const [exit] = await closed;
      assert.equal(exit, 0);
      const clear = await acquireUpdatePublicationBoundary(root);
      assert.ok(clear.ok);
      await clear.release();
    } finally {
      lines.close();
      if (child.exitCode === null) child.kill("SIGKILL");
      await closed;
    }
  }); });
