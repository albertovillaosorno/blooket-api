// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - MIT
// Confidential:
//   - false
// License-File:
//   - LICENSE
//
// Boundary-Contract:
// - Owns:
//   - Tests for the packaged Safari-extension installation helper.
// - Must-Not:
//   - Launch Safari or depend on a native Mac test host.
// - Allows:
//   - Inputs: Temporary owned companion/helper/id files and fake process
//     runner.
//   - Outputs: Availability and exact launch-command assertions.
//   - Side effects: Temporary filesystem writes only.
// - Split-When:
//   - Safari installation gains another native activation phase.
// - Merge-When:
//   - Safari installation helper is removed.
// - Summary:
//   - Proves only the owned embedded companion can be opened.
// - Description:
//   - User consent in Safari remains outside this portable test.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Non-macOS, missing files, and malformed identifiers fail closed.
//
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  openPackagedSafariExtension,
  safariExtensionAvailable,
  type SafariExtensionInstallPaths,
} from
  "../../../../src/platforms/safari-extension/adapter-outbound/install.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "blooket-safari-"));
  const paths: SafariExtensionInstallPaths = {
    companion: join(root, "Blooket API Safari.app"),
    helper: join(root, "open-extension"),
    identifier: join(root, "extension-id.txt"),
  };
  await mkdir(paths.companion);
  await writeFile(paths.helper, "helper");
  await writeFile(paths.identifier, "com.example.blooket.extension\n");
  return { root, paths };
}

test("Safari companion is available only from a macOS package", async () => {
  const { root, paths } = await fixture();
  try {
    assert.equal(await safariExtensionAvailable("darwin", paths), true);
    assert.equal(await safariExtensionAvailable("linux", paths), false);
    await rm(paths.companion, { recursive: true, force: true });
    assert.equal(await safariExtensionAvailable("darwin", paths), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Safari setup opens the exact bundled extension settings", async () => {
  const { root, paths } = await fixture();
  const calls: [string, readonly string[]][] = [];
  try {
    assert.deepEqual(
      await openPackagedSafariExtension({
        platform: "darwin",
        paths,
        run: async (program, args) => {
          calls.push([program, args]);
        },
      }),
      { ok: true },
    );
    assert.deepEqual(calls, [
      ["/usr/bin/open", ["-gj", paths.companion]],
      [paths.helper, ["com.example.blooket.extension"]],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing Safari companion fails before native open", async () => {
  const { root, paths } = await fixture();
  let calls = 0;
  try {
    await rm(paths.companion, { recursive: true, force: true });
    assert.deepEqual(
      await openPackagedSafariExtension({
        platform: "darwin",
        paths,
        run: async () => { calls++; },
      }),
      { ok: false, code: "safari-extension-unavailable" },
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Safari setup refuses oversized or unsafe identifier bytes before open",
  async () => {
  const { root, paths } = await fixture();
  let opens = 0;
  const run = async () => { opens++; };
  try {
    await writeFile(paths.identifier, "com.example." + "a".repeat(255));
    assert.deepEqual(await openPackagedSafariExtension({
      platform: "darwin", paths, run,
    }), { ok: false, code: "safari-extension-invalid" });
    assert.equal(opens, 0);
    await writeFile(paths.identifier, "incorrect/id");
    assert.deepEqual(await openPackagedSafariExtension({
      platform: "darwin", paths, run,
    }), { ok: false, code: "safari-extension-invalid" });
    assert.equal(opens, 0);
    const outside = join(root, "outside-id.txt");
    await writeFile(outside, "com.example.foreign\n");
    await rm(paths.identifier);
    await symlink(outside, paths.identifier);
    assert.deepEqual(await openPackagedSafariExtension({
      platform: "darwin", paths, run,
    }), { ok: false, code: "safari-extension-unavailable" });
    assert.equal(await readFile(outside, "utf8"), "com.example.foreign\n");
    await rm(paths.identifier);
    await symlink(join(root, "missing-id.txt"), paths.identifier);
    assert.deepEqual(await openPackagedSafariExtension({
      platform: "darwin", paths, run,
    }), { ok: false, code: "safari-extension-unavailable" });
    assert.equal(opens, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
  },
);

test("symbolic Safari companion or executable helper cannot be activated",
  async () => {
  for (const selected of ["companion", "helper"] as const) {
    const { root, paths } = await fixture();
    let calls = 0;
    try {
      const outside = join(root, "unrelated");
      if (selected === "companion") await mkdir(outside);
      else await writeFile(outside, "not-an-executable");
      await rm(paths[selected], { recursive: true, force: true });
      await symlink(outside, paths[selected]);
      assert.equal(await safariExtensionAvailable("darwin", paths), false);
      assert.deepEqual(await openPackagedSafariExtension({
        platform: "darwin", paths,
        run: async () => { calls++; },
      }), { ok: false, code: "safari-extension-unavailable" });
      assert.equal(calls, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  },
);

// A validated packaged identifier can be swapped before its descriptor opens.
// Refuse the substituted pipe promptly instead of waiting for a writer.
test("Safari identifier replacement by FIFO never blocks activation",
  async () => {
    const { root, paths } = await fixture();
    const fifo = join(root, "replacement.fifo");
    const run = promisify(execFile);
    try {
      await run("mkfifo", [fifo]);
      const moduleUrl = new URL(
        "../../../../src/platforms/safari-extension/adapter-outbound/" +
        "install.ts", import.meta.url,
      ).href;
      const script =
        `import { openPackagedSafariExtension } from ` +
        `${JSON.stringify(moduleUrl)};` +
        "let reads = 0;" +
        "const paths = { companion: process.argv[1], " +
        "helper: process.argv[2], get identifier() { " +
        "return ++reads === 1 ? process.argv[3] : process.argv[4]; } };" +
        "const result = await openPackagedSafariExtension({ " +
        "platform: 'darwin', paths, " +
        "run: async () => { throw Error('unexpected-open'); } });" +
        "process.stdout.write(JSON.stringify(result));";
      const { stdout, stderr } = await run(process.execPath,
        ["--input-type=module", "--eval", script, paths.companion,
          paths.helper, paths.identifier, fifo], { timeout: 8_000 });
      assert.equal(stderr, "");
      assert.deepEqual(JSON.parse(stdout),
        { ok: false, code: "safari-extension-invalid" });
    } finally { await rm(root, { recursive: true, force: true }); }
  },
);
