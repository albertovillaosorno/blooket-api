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
//   - Explicit CLI installation of the optional Linux menu shortcut.
// - Must-Not:
//   - Install on other systems or change an existing shortcut.
// - Allows:
//   - Inputs: One fixed package directory passed by its local launcher.
//   - Outputs: One user-local installed desktop entry or a stable error.
//   - Side effects: Only the Linux user's desktop menu entry.
// - Split-When:
//   - Menu configuration needs an interactive user interface.
// - Merge-When:
//   - Native desktop integration is handled by the package manager.
// - Summary:
//   - Makes desktop integration explicit and separate from package startup.
// - Description:
//   - Invokes the no-clobber file adapter with the host user's home.
// - Usage:
//   - Run through the packaged install-desktop-shortcut wrapper.
// - Defaults:
//   - Other platforms, extra arguments and existing entries are refused.
//
import { homedir } from "node:os";
import { installLinuxDesktopShortcut } from "../adapter-outbound/linux-menu.ts";

const root = process.argv[2];
if (process.platform !== "linux" || process.argv.length !== 3 || !root) {
  process.stderr.write("linux-shortcut-unsupported\n");
  process.exitCode = 1;
} else {
  try {
    const installed = await installLinuxDesktopShortcut(root, homedir());
    process.stdout.write("Desktop shortcut installed: " + installed + "\n");
  } catch {
    process.stderr.write("linux-shortcut-install-failed\n");
    process.exitCode = 1;
  }
}
