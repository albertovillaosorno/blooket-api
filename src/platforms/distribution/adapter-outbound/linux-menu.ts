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
//   - Explicit, user-local Linux menu shortcut installation.
// - Must-Not:
//   - Modify global menus, delete shortcuts or accept untrusted commands.
// - Allows:
//   - Inputs: A verified installed package root and user home.
//   - Outputs: One exclusively created desktop entry.
//   - Side effects: User-owned menu entry only after explicit invocation.
// - Split-When:
//   - Native desktop APIs need another independent entrypoint.
// - Merge-When:
//   - Linux packages no longer offer opt-in menu integration.
// - Summary:
//   - Generates a safe, portable launcher pointing to the extracted package.
// - Description:
//   - Refuses unsafe paths and never replaces an existing application entry.
// - Usage:
//   - Invoked by an optional wrapper in the Linux distribution.
// - Defaults:
//   - Existing shortcuts and malformed packages fail closed.
//
import { access, lstat, mkdir, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const SHORTCUT_NAME = "blooket-api.desktop";
const ALLOWED_PATH = /^\/[a-zA-Z0-9_./-]+$/u;

export function linuxDesktopShortcutLauncher(): string {
  return `#!/bin/sh
set -eu
root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
exec "$root/runtime/node" \\
  "$root/app/src/platforms/distribution/adapter-inbound/linux-menu.ts" "$root"
`;
}

export async function installLinuxDesktopShortcut(
  root: string, home: string,
): Promise<string> {
  if (process.platform !== "linux" ||
      !ALLOWED_PATH.test(root) || !ALLOWED_PATH.test(home))
    throw new Error("unsafe-linux-shortcut-path");
  const packageRoot = await realpath(root);
  const userHome = await realpath(home);
  if (!ALLOWED_PATH.test(packageRoot) || !ALLOWED_PATH.test(userHome))
    throw new Error("unsafe-linux-shortcut-path");
  const executable = join(packageRoot, "blooket-api");
  const icon = join(packageRoot, "extensions/chrome/icons/128.png");
  const launcherInfo = await lstat(executable);
  const iconInfo = await lstat(icon);
  if (!launcherInfo.isFile() || !(launcherInfo.mode & 0o111) ||
      !iconInfo.isFile()) throw new Error("invalid-linux-shortcut-package");
  await access(executable, constants.X_OK);
  const folder = join(userHome, ".local/share/applications");
  await mkdir(folder, { recursive: true });
  const destination = join(folder, SHORTCUT_NAME);
  // A direct owner-only file creation is atomic: no existing menu entry,
  // symlink, or another installer can be overwritten by this operation.
  const handle = await open(destination, "wx", 0o644);
  try {
    const content = `[Desktop Entry]
Type=Application
Version=1.0
Name=Blooket API
Exec=${executable}
Icon=${icon}
Terminal=false
Categories=Education;Utility;
StartupNotify=false
`;
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    // Never unlink by name after a failed write: an outside actor might
    // replace the path while this owner is closing its descriptor.
    await handle.close();
  }
  return destination;
}
