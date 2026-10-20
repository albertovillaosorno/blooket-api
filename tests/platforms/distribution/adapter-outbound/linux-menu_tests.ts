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
//   - Explicit opt-in Linux menu installation regressions.
// - Must-Not:
//   - Modify a real desktop menu or execute a browser.
// - Allows:
//   - Inputs: Synthetic package and home directory fixtures.
//   - Outputs: Exact desktop-entry contents and safe failure checks.
//   - Side effects: Test-owned temporary files removed after assertions.
// - Split-When:
//   - Another Linux menu format needs separate admission.
// - Merge-When:
//   - The distribution no longer includes a desktop shortcut.
// - Summary:
//   - Makes desktop integration optional, exact and non-overwriting.
// - Description:
//   - Tests no-clobber installation and path/asset bounds.
// - Usage:
//   - Run through portable repository tests on Linux.
// - Defaults:
//   - Unsafe paths and existing desktop shortcuts fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installLinuxDesktopShortcut } from
  "../../../../src/platforms/distribution/adapter-outbound/linux-menu.ts";

test("Linux menu entry uses fixed launcher and preserves an existing shortcut",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "blooket-menu-test-"));
  const packageRoot = join(root, "package");
  const home = join(root, "home");
  try {
    await mkdir(join(packageRoot, "extensions/chrome/icons"),
      { recursive: true });
    await mkdir(home);
    await writeFile(join(packageRoot, "blooket-api"), "synthetic launcher",
      { mode: 0o755 });
    await writeFile(join(packageRoot, "extensions/chrome/icons/128.png"),
      "synthetic png");
    const installed = await installLinuxDesktopShortcut(packageRoot, home);
    assert.equal(installed, join(home,
      ".local/share/applications/blooket-api.desktop"));
    const content = await readFile(installed, "utf8");
    assert.ok(content.includes("Exec=" + packageRoot + "/blooket-api\n"));
    assert.ok(content.includes("Icon=" + packageRoot +
      "/extensions/chrome/icons/128.png\n"));
    assert.ok(content.includes("Terminal=false\n"));
    await assert.rejects(installLinuxDesktopShortcut(packageRoot, home),
      { code: "EEXIST" });
    assert.equal(await readFile(installed, "utf8"), content);
    await assert.rejects(installLinuxDesktopShortcut(
      packageRoot + "\nExec=sh", home), /unsafe-linux-shortcut-path/u);
    assert.equal(await readFile(installed, "utf8"), content);
  } finally { await rm(root, { recursive: true, force: true }); }
});
