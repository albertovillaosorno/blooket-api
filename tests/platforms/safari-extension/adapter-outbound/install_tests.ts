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
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
