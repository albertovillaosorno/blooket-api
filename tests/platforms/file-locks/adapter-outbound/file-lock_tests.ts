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
//   - Verifies live exclusion, stale recovery, and unsafe lock refusal.
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
