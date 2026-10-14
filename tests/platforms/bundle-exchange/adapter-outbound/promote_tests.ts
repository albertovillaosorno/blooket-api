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
//   - Native no-overwrite placement and lost-acknowledgment regressions.
// - Must-Not:
//   - Touch installed user software or infer Mac publisher trust.
// - Allows:
//   - Inputs: Owned temporary bundles and the compiled native helper.
//   - Outputs: Filesystem preservation and bounded placement assertions.
//   - Side effects: Automatic test fixtures, compilation and native rename.
// - Split-When:
//   - Production installer acceptance provides native Mac evidence.
// - Merge-When:
//   - Preparation integration owns these same kernel race cases.
// - Summary:
//   - A competing empty destination survives the real exclusive syscall.
// - Description:
//   - Linux executes the helper; it does not establish Mac acceptance.
// - Usage:
//   - Run beside the existing atomic exchange regression suite.
// - Defaults:
//   - Each fixture cleans only its test-owned files.
//
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from
  "node:fs/promises";
import { join } from "node:path";
import { promotePreparedBundle } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/promote.ts";
import { executeNative } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/exchange.ts";
import { directoryIdentity } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/identity.ts";
import { fixture } from "./fixtures.ts";

async function prepared() {
  const f = await fixture();
  const unpacked = join(f.prepared, "stage-" + randomUUID(), "unpacked");
  await mkdir(unpacked, { recursive: true, mode: 0o700 });
  const sourcePath = join(unpacked, "Blooket API.app");
  await rename(f.options.candidatePath, sourcePath);
  return { ...f, unpacked, promotion: {
    sourcePath, candidatePath: f.options.candidatePath,
    sourceIdentity: await directoryIdentity(sourcePath),
    helperPath: f.options.helperPath, host: f.options.host,
  } };
}
test("native promotion retains the installed app and candidate identity",
  async () => {
    const f = await prepared();
    try {
      assert.deepEqual(await promotePreparedBundle(f.promotion), {
        status: "promoted", durable: true,
      });
      assert.deepEqual(await directoryIdentity(f.promotion.candidatePath),
        f.promotion.sourceIdentity);
      await assert.rejects(lstat(f.promotion.sourcePath), { code: "ENOENT" });
      assert.equal(await readFile(join(f.options.installedPath, "marker"),
        "utf8"), "old version");
    } finally { await f.cleanup(); }
  });
test("a racing empty or populated destination is never overwritten",
  async () => {
    for (const populated of [false, true]) {
      const f = await prepared();
      try {
        await chmod(f.promotion.sourcePath, 0o555);
        let competitor: Awaited<ReturnType<typeof directoryIdentity>>;
        const result = await promotePreparedBundle({ ...f.promotion,
          execute: async (file, args, signal) => {
            await mkdir(f.promotion.candidatePath, { mode: 0o700 });
            competitor = await directoryIdentity(f.promotion.candidatePath);
            if (populated) await writeFile(join(f.promotion.candidatePath,
              "marker"), "competing work");
            await executeNative(file, args, signal);
          },
        });
        assert.equal(result.status, "promotion-failed");
        assert.deepEqual(await directoryIdentity(f.promotion.candidatePath),
          competitor!);
        assert.deepEqual(await directoryIdentity(f.promotion.sourcePath),
          f.promotion.sourceIdentity);
        assert.equal((await lstat(f.promotion.sourcePath)).mode & 0o777, 0o555);
        if (populated) assert.equal(await readFile(
          join(f.promotion.candidatePath, "marker"), "utf8"), "competing work");
      } finally { await f.cleanup(); }
    }
  });
test("lost native acknowledgment is observed without another rename",
  async () => {
    const f = await prepared(); let calls = 0;
    try {
      const result = await promotePreparedBundle({ ...f.promotion,
        execute: async (...args) => {
          calls++; await executeNative(...args); throw Error("lost receipt");
        },
      });
      assert.deepEqual(result, { status: "promoted", durable: true });
      assert.equal(calls, 1);
    } finally { await f.cleanup(); }
  });
test("changed extraction parent cannot move a substituted candidate",
  async () => {
    const f = await prepared();
    try {
      const result = await promotePreparedBundle({ ...f.promotion,
        execute: async (file, args, signal) => {
          await rename(f.unpacked, f.unpacked + "-retained");
          await mkdir(f.unpacked, { mode: 0o700 });
          await mkdir(f.promotion.sourcePath, { mode: 0o700 });
          await executeNative(file, args, signal);
        },
      });
      assert.equal(result.status, "promotion-failed");
      await assert.rejects(lstat(f.promotion.candidatePath),
        { code: "ENOENT" });
      assert.equal(await readFile(join(f.unpacked + "-retained",
        "Blooket API.app/marker"), "utf8"), "new version");
    } finally { await f.cleanup(); }
  });
