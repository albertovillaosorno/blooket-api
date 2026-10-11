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
//   - Filesystem tests for exclusive local writer locks.
// - Must-Not:
//   - Exercise production paths or project/settings serialization.
// - Allows:
//   - Inputs: Temporary lock paths and deliberate stale/unsafe lock fixtures.
//   - Outputs: Deterministic acquisition, refusal, and cleanup verdicts.
//   - Side effects: Temporary filesystem state removed after each test.
// - Split-When:
//   - Host-specific lock implementations require separate fixture suites.
// - Merge-When:
//   - Local persistence no longer uses explicit writer locks.
// - Summary:
//   - Verifies exclusion, serialized stale recovery, and unsafe refusal.
// - Description:
//   - Exercises the POSIX hard-link lock protocol on the development host.
// - Usage:
//   - Run on Linux now and macOS before release promotion.
// - Defaults:
//   - Test locks exist only under the operating-system temporary directory.
//
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-file-lock-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("an acquired lock excludes a second live writer", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "settings.json.lock");
    const first = await tryAcquireFileLock(path);
    assert.equal(first.ok, true);
    if (!first.ok) {
      return;
    }

    const second = await tryAcquireFileLock(path);
    assert.deepEqual(second, { ok: false, reason: "busy" });

    await first.lock.release();
    const third = await tryAcquireFileLock(path);
    assert.equal(third.ok, true);
    if (third.ok) {
      await third.lock.release();
    }
  });
});

test("dead PID locks are reclaimed before acquisition", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "project.lock");
    await writeFile(
      path,
      '{"version":1,"pid":2147483647,"token":"stale"}\n',
      { mode: 0o600 },
    );

    const acquired = await tryAcquireFileLock(path);
    assert.equal(acquired.ok, true);
    if (acquired.ok) {
      await acquired.lock.release();
    }
  });
});

test("concurrent dead-lock reclaim elects only one writer", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "project.lock");
    await writeFile(
      path,
      '{"version":1,"pid":2147483647,"token":"stale"}\n',
      { mode: 0o600 },
    );

    const results = await Promise.all([
      tryAcquireFileLock(path),
      tryAcquireFileLock(path),
    ]);
    const acquired = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);

    assert.equal(acquired.length, 1);
    assert.equal(refused.length, 1);
    assert.equal(refused[0]?.ok, false);
    if (refused[0] !== undefined && !refused[0].ok) {
      assert.equal(refused[0].reason, "busy");
    }
    if (acquired[0]?.ok) {
      await acquired[0].lock.release();
    }
    assert.deepEqual(await readdir(directory), []);
  });
});

test("an existing recovery guard prevents stale lock removal", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "project.lock");
    const stale = '{"version":1,"pid":2147483647,"token":"stale"}\n';
    await writeFile(path, stale, { mode: 0o600 });
    await writeFile(
      path + ".reclaim",
      JSON.stringify({
        version: 1,
        pid: process.pid,
        token: "active-reclaimer",
      }) + "\n",
      { mode: 0o600 },
    );

    assert.deepEqual(await tryAcquireFileLock(path), {
      ok: false,
      reason: "busy",
    });
    assert.equal(await readFile(path, "utf8"), stale);
  });
});

test("malformed and symbolic lock files fail closed", async () => {
  await withTemporaryDirectory(async (directory) => {
    const malformed = join(directory, "malformed.lock");
    await writeFile(malformed, "{}\n", { mode: 0o600 });
    assert.deepEqual(await tryAcquireFileLock(malformed), {
      ok: false,
      reason: "unsafe",
    });

    const real = join(directory, "real.lock");
    const symbolic = join(directory, "symbolic.lock");
    await writeFile(real, "{}\n", { mode: 0o600 });
    await symlink(real, symbolic);
    assert.deepEqual(await tryAcquireFileLock(symbolic), {
      ok: false,
      reason: "unsafe",
    });
  });
});

test("owner reads reject dangling links and bounded-size violations",
  async () => {
  await withTemporaryDirectory(async directory => {
    const path = join(directory, "stale.lock");
    const stale = JSON.stringify({
      version: 1, pid: 2147483647, token: "fixture-stale",
    }) + "\n";
    await writeFile(path, stale.padEnd(4_097, " "));
    assert.deepEqual(await tryAcquireFileLock(path), {
      ok: false, reason: "unsafe",
    });
    assert.equal((await readFile(path, "utf8")).length, 4_097);
    await writeFile(path, stale.padEnd(4_096, " "));
    const recovered = await tryAcquireFileLock(path);
    assert.equal(recovered.ok, true);
    if (recovered.ok) await recovered.lock.release();
    await symlink(join(directory, "missing.json"), path);
    assert.deepEqual(await tryAcquireFileLock(path), {
      ok: false, reason: "unsafe",
    });
  });
  },
);

test("normal acquisition leaves no owner temporary files", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "project.lock");
    const acquired = await tryAcquireFileLock(path);
    assert.equal(acquired.ok, true);

    const during = await readdir(directory);
    assert.deepEqual(during, ["project.lock"]);

    if (acquired.ok) {
      const owner = JSON.parse(await readFile(path, "utf8")) as {
        pid: number;
      };
      assert.equal(owner.pid, process.pid);
      await acquired.lock.release();
    }
    assert.deepEqual(await readdir(directory), []);
  });
});

test("overlapping release callers share one completion", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "project.lock");
    const acquired = await tryAcquireFileLock(path);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }

    const first = acquired.lock.release();
    const second = acquired.lock.release();
    await Promise.allSettled([first, second]);
    assert.equal(first, second);
    await first;

    const replacement = await tryAcquireFileLock(path);
    assert.equal(replacement.ok, true);
    if (!replacement.ok) {
      return;
    }
    try {
      await acquired.lock.release();
      assert.deepEqual(await tryAcquireFileLock(path), {
        ok: false,
        reason: "busy",
      });
    } finally {
      await replacement.lock.release();
    }
  });
});

test("release preserves foreign owners and permits retry", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "project.lock");
    const acquired = await tryAcquireFileLock(path);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }
    const original = await readFile(path, "utf8");
    const foreign = JSON.stringify({
      version: 1,
      pid: process.pid,
      token: "replacement-owner",
    }) + "\n";
    await writeFile(path, foreign);
    await assert.rejects(acquired.lock.release(), /another writer/);
    assert.equal(await readFile(path, "utf8"), foreign);

    await writeFile(path, original);
    await acquired.lock.release();
    assert.deepEqual(await readdir(directory), []);
  });
});


test("nonreclaimable installer ownership survives its parent process",
  async () => {
    await withTemporaryDirectory(async directory => {
      const path = join(directory, "installation.lock");
      const source = '{"version":1,"pid":2147483647,"token":"retained"}\n';
      await writeFile(path, source, { mode: 0o600 });
      assert.deepEqual(await tryAcquireFileLock(path,
        { reclaimDeadOwner: false }), { ok: false, reason: "busy" });
      assert.equal(await readFile(path, "utf8"), source);
    });
  },
);
