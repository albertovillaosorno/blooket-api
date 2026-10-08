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
//   - Portable signed-ZIP staging regressions and owned fixtures.
// - Must-Not:
//   - Install, launch, consume secrets, or infer Apple trust.
// - Allows:
//   - Inputs: Ephemeral fixture keys and bounded synthetic ZIP records.
//   - Outputs: Bounded staging results still requiring Apple assessment.
//   - Side effects: Test-owned temporary files and native extraction doubles.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Native extraction no longer needs independent physical validation.
// - Summary:
//   - Portable signed-ZIP staging regressions and owned fixtures.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdir, readFile, readlink, readdir, rename, symlink,
  writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as tick } from "node:timers/promises";
import { stageSignedUpdate } from
  "../../../../src/platforms/update-extraction/adapter-outbound/stage.ts";
import { fixture, portableExtract, baseEntries } from "./fixtures.ts";

async function eventuallyMissing(path: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { await lstat(path); } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
    await tick(5);
  }
  assert.fail("Owned staging state was not removed after the writer stopped.");
}

test("signed staging preserves archive bytes and freezes a real extracted tree",
  async () => {
    const item = await fixture();
    try {
      const result = await stageSignedUpdate(item.options);
      assert.equal(result.status, "staged");
      if (result.status !== "staged") return;
      assert.equal(result.requiresAppleVerification, true);
      assert.equal(result.version, "26.4.1");
      const expected = baseEntries()[2]!;
      const runtime = join(result.bundlePath,
        "Contents/Resources/runtime/node");
      assert.deepEqual(await readFile(runtime), expected.data);
      assert.equal((await lstat(runtime)).mode & 0o777, 0o555);
      assert.equal((await lstat(result.bundlePath)).mode & 0o777, 0o555);
      assert.deepEqual(await readFile(item.options.archivePath), item.bytes);
      const stage = join(item.options.directory, "stage-" + result.stageId);
      assert.deepEqual((await readdir(stage)).sort(),
        [".owner.json", "unpacked"]);
      await assert.rejects(lstat(join(item.options.directory, ".extract.lock")),
        { code: "ENOENT" });
    } finally { await item.cleanup(); }
  });

test("unknown publishers, Linux stubs and cancellation stop before staging",
  async () => {
    const item = await fixture();
    let calls = 0;
    try {
      const execute = async () => { calls++; };
      const untrusted = await stageSignedUpdate({ ...item.options, execute,
        verification: { ...item.options.verification, trustedKeys: [] } });
      assert.deepEqual(untrusted, { status: "extraction-failed",
        reason: "manifest" });
      const unsupported = await stageSignedUpdate({ ...item.options, execute,
        host: { platform: "linux", architecture: "x64" } });
      assert.deepEqual(unsupported, { status: "extraction-failed",
        reason: "unsupported-host" });
      const signal = AbortSignal.abort();
      assert.deepEqual(await stageSignedUpdate({ ...item.options, signal,
        execute }), { status: "extraction-failed", reason: "cancelled" });
      assert.equal(calls, 0);
      await assert.rejects(lstat(item.options.directory), { code: "ENOENT" });
    } finally { await item.cleanup(); }
  });

test("archive hash mismatch and insufficient space preserve the source",
  async () => {
    const item = await fixture();
    let calls = 0;
    try {
      const execute = async () => { calls++; };
      assert.deepEqual(await stageSignedUpdate({ ...item.options, execute,
        availableBytes: async () => 0n }), { status: "extraction-failed",
        reason: "space" });
      const changed = Buffer.from(item.bytes); changed[40] ^= 1;
      await writeFile(item.options.archivePath, changed);
      const failed = await stageSignedUpdate({ ...item.options, execute });
      assert.deepEqual(failed, { status: "extraction-failed",
        reason: "archive-bytes" });
      assert.deepEqual(await readFile(item.options.archivePath), changed);
      assert.equal(calls, 0);
      assert.deepEqual(await readdir(item.options.directory), []);
    } finally { await item.cleanup(); }
  });

test("symbolic staging and source paths never invoke native extraction",
  async () => {
    const item = await fixture();
    let calls = 0;
    try {
      const outside = join(item.root, "preserved");
      await mkdir(outside, { mode: 0o700 });
      await writeFile(join(outside, "keep"), "synthetic user marker");
      await symlink(outside, item.options.directory);
      assert.equal((await stageSignedUpdate({ ...item.options,
        execute: async () => { calls++; } })).status, "extraction-failed");
      assert.equal(await readFile(join(outside, "keep"), "utf8"),
        "synthetic user marker");
      assert.equal(calls, 0);
    } finally { await item.cleanup(); }
  });

test("native output must match exact archived paths and bytes",
  async () => {
    for (const mutation of ["bytes", "extra", "link"]) {
      const item = await fixture();
      try {
        const result = await stageSignedUpdate({ ...item.options,
          execute: async (file, args, signal) => {
            await portableExtract(file, args, signal);
            const bundle = join(args[3]!, "Blooket API.app");
            if (mutation === "extra") await writeFile(join(bundle, "extra"),
              "unexpected native output");
            else if (mutation === "bytes") await writeFile(join(bundle,
              "Contents/Info.plist"), "changed payload!!");
            else await symlink("/foreign", join(bundle, "unexpected-link"));
          },
        });
        assert.equal(result.status, "extraction-failed");
        assert.deepEqual(await readdir(item.options.directory), []);
        assert.deepEqual(await readFile(item.options.archivePath), item.bytes);
      } finally { await item.cleanup(); }
    }
  });

test("cancellation retains ownership until an ignoring native writer stops",
  async () => {
    const item = await fixture();
    const writer = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    try {
      const pending = stageSignedUpdate({ ...item.options,
        signal: controller.signal, execute: async () => {
          started.resolve(); await writer.promise;
        } });
      await started.promise;
      controller.abort();
      const result = await pending;
      assert.equal(result.status, "extraction-failed");
      if (result.status !== "extraction-failed") return;
      assert.equal(result.reason, "cancelled");
      assert.ok(result.retainedStageId);
      const stage = join(item.options.directory, "stage-" +
        result.retainedStageId);
      assert.ok((await lstat(stage)).isDirectory());
      assert.equal((await stageSignedUpdate(item.options)).status,
        "extraction-failed");
      await writeFile(join(stage, "unpacked/late-output"), "late writer data");
      writer.resolve();
      await eventuallyMissing(stage);
      await eventuallyMissing(join(item.options.directory, ".extract.lock"));
      assert.deepEqual(await readFile(item.options.archivePath), item.bytes);
    } finally {
      writer.resolve();
      await eventuallyMissing(join(item.options.directory, ".extract.lock"));
      await item.cleanup();
    }
  });

test("an uncooperative native command has a bounded timeout and recovery ID",
  async () => {
    const item = await fixture();
    const writer = Promise.withResolvers<void>();
    try {
      const result = await stageSignedUpdate({ ...item.options, timeoutMs: 500,
        execute: async () => { await writer.promise; } });
      assert.equal(result.status, "extraction-failed");
      if (result.status !== "extraction-failed") return;
      assert.equal(result.reason, "timeout");
      assert.ok(result.retainedStageId);
      writer.resolve();
      await eventuallyMissing(join(item.options.directory, ".extract.lock"));
      assert.deepEqual(await readdir(item.options.directory), []);
    } finally {
      writer.resolve();
      await eventuallyMissing(join(item.options.directory, ".extract.lock"));
      await item.cleanup();
    }
  });


test("a symbolic source never invokes extraction or changes its target",
  async () => {
    const item = await fixture();
    let calls = 0;
    try {
      const original = join(item.root, "preserved.zip");
      await rename(item.options.archivePath, original);
      await symlink(original, item.options.archivePath);
      assert.deepEqual(await stageSignedUpdate({ ...item.options,
        execute: async () => { calls++; } }),
      { status: "extraction-failed", reason: "storage" });
      assert.deepEqual(await readFile(original), item.bytes);
      assert.equal(calls, 0);
    } finally { await item.cleanup(); }
  });

test("expanded-space exhaustion and native failure remove only owned staging",
  async () => {
    for (const cause of ["space", "native"] as const) {
      const item = await fixture();
      let checks = 0, calls = 0;
      try {
        await mkdir(item.options.directory, { mode: 0o700 });
        const marker = join(item.options.directory, "existing-marker");
        await writeFile(marker, "preserve existing data");
        const result = await stageSignedUpdate({ ...item.options,
          availableBytes: async () => {
            checks++;
            return cause === "space" && checks > 1 ? 0n : 10_000_000_000n;
          }, execute: async () => {
            calls++; throw new Error("synthetic native failure");
          } });
        assert.deepEqual(result, { status: "extraction-failed",
          reason: cause === "space" ? "space" : "native-extraction" });
        assert.equal(calls, cause === "space" ? 0 : 1);
        assert.equal(await readFile(marker, "utf8"), "preserve existing data");
        assert.deepEqual(await readdir(item.options.directory),
          ["existing-marker"]);
        assert.deepEqual(await readFile(item.options.archivePath), item.bytes);
      } finally { await item.cleanup(); }
    }
  });


test("the frozen native tree preserves an admitted internal symbolic link",
  async () => {
    const item = await fixture([...baseEntries(), {
      name: "Blooket API.app/Contents/Resources/node-link", mode: 0o120777,
      data: Buffer.from("runtime/node") }]);
    try {
      const result = await stageSignedUpdate(item.options);
      assert.equal(result.status, "staged");
      if (result.status !== "staged") return;
      const link = join(result.bundlePath, "Contents/Resources/node-link");
      assert.equal(await readlink(link), "runtime/node");
      assert.deepEqual(await readFile(link), baseEntries()[2]!.data);
      assert.deepEqual(await readFile(item.options.archivePath), item.bytes);
    } finally { await item.cleanup(); }
  });
