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
//   - Verification of the compiled extension dependency closure.
// - Must-Not:
//   - Install software or include server secrets in browser artifacts.
// - Allows:
//   - Inputs: Repository-owned sources and an isolated temporary destination.
//   - Outputs: Assertions about emitted imports and admitted permissions.
//   - Side effects: Compiler execution and temporary output removed afterward.
// - Split-When:
//   - Native Safari assembly needs independent target-host checks.
// - Merge-When:
//   - Extension compilation no longer owns browser artifacts.
// - Summary:
//   - Tests the actual emitted worker and its dependencies.
// - Description:
//   - Checks exclusive output ownership and browser-only resources.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Existing destinations must remain untouched.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildBrowserExtension } from
  "../../../../src/platforms/distribution/adapter-outbound/extension.ts";

test(
  "extension compilation emits a closed browser-safe module tree",
  async () => {
  const repo = fileURLToPath(new URL("../../../../", import.meta.url));
  const root = await mkdtemp(join(repo, ".temp/extension build "));
  const output = join(root, "browser");
  try {
    await buildBrowserExtension(repo, output);
    const manifest = JSON.parse(
      await readFile(join(output, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ["storage", "scripting"]);
    assert.deepEqual(manifest.host_permissions, [
      "https://dashboard.blooket.com/*",
      "http://127.0.0.1/*",
      "http://127.0.0.2/*",
    ]);
    assert.equal(manifest.background.type, "module");
    assert.equal(manifest.externally_connectable, undefined);
    for (const size of [16, 32, 48, 128]) {
      assert.equal(manifest.icons[size], `icons/${size}.png`);
      assert.ok(
        (await readFile(join(output, manifest.icons[size]))).length > 100,
      );
    }
    const files = await readdir(output, { recursive: true });
    const scripts = files.filter((file) => file.endsWith(".js"));
    assert.ok(scripts.includes(manifest.background.service_worker));
    const before = Object.getOwnPropertyDescriptor(globalThis, "chrome");
    let listenerCount = 0;
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        tabs: { query: async () => [] },
        runtime: {
          onMessage: {
            addListener: () => {
              listenerCount++;
            },
          },
        },
        storage: { session: { get: async () => ({}) } },
      },
    });
    try {
      // Node rejects asynchronous ESM graphs here, as Chrome workers do.
      createRequire(import.meta.url)(
        join(output, manifest.background.service_worker),
      );
      assert.equal(listenerCount, 1);
      await Promise.resolve();
    } finally {
      if (before) Object.defineProperty(globalThis, "chrome", before);
      else Reflect.deleteProperty(globalThis, "chrome");
    }
    assert.ok(scripts.length > 1);
    assert.equal(
      files.some(
        (file) =>
          file.endsWith(".ts") ||
          file.includes(".env") ||
          file.includes("node_modules") ||
          file.includes("security/") ||
          file.includes("api/"),
      ),
      false,
    );
    for (const file of scripts) {
      const text = await readFile(join(output, file), "utf8");
      assert.doesNotMatch(text, /from\s+["']node:/u);
      assert.doesNotMatch(text, /from\s+["'][^"']+\.ts["']/u);
    }
    await writeFile(join(output, "sentinel"), "preserve");
    await assert.rejects(buildBrowserExtension(repo, output));
    assert.equal(await readFile(join(output, "sentinel"), "utf8"), "preserve");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
