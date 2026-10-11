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
//   - Locating and opening the Safari companion bundled with Blooket API.app.
// - Must-Not:
//   - Enable Safari extensions silently or trust caller-provided bundle paths.
// - Allows:
//   - Inputs: The packaged runtime executable and owned Safari resource files.
//   - Outputs: Stable availability/open results for the localhost workspace.
//   - Side effects: Registers the companion app and opens Safari preferences.
// - Split-When:
//   - Another browser needs a native installation helper.
// - Merge-When:
//   - Safari no longer requires a native containing application.
// - Summary:
//   - Keeps Safari activation one click away while preserving user consent.
// - Description:
//   - Final enabling remains a Safari-owned human security boundary.
// - Usage:
//   - Call only from the trusted same-origin local workspace.
// - Defaults:
//   - Non-macOS and incomplete packages report unavailable.
//
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface SafariExtensionInstallPaths {
  readonly companion: string;
  readonly helper: string;
  readonly identifier: string;
}

export function packagedSafariExtensionPaths(
  executable = process.execPath,
): SafariExtensionInstallPaths {
  const resources = dirname(dirname(executable));
  const safari = join(resources, "Safari");
  return {
    companion: join(safari, "Blooket API Safari.app"),
    helper: join(safari, "open-extension"),
    identifier: join(safari, "extension-id.txt"),
  };
}

export async function safariExtensionAvailable(
  platform = process.platform,
  paths = packagedSafariExtensionPaths(),
): Promise<boolean> {
  if (platform !== "darwin") return false;
  try {
    const [companion, helper, identifier] = await Promise.all([
      lstat(paths.companion),
      lstat(paths.helper),
      lstat(paths.identifier),
    ]);
    return companion.isDirectory() && !companion.isSymbolicLink() &&
      helper.isFile() && !helper.isSymbolicLink() &&
      identifier.isFile() && !identifier.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function openPackagedSafariExtension(
  options: {
    readonly platform?: NodeJS.Platform;
    readonly paths?: SafariExtensionInstallPaths;
    readonly run?: (
      program: string,
      args: readonly string[],
    ) => Promise<void>;
  } = {},
): Promise<
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string }
> {
  const platform = options.platform ?? process.platform;
  const paths = options.paths ?? packagedSafariExtensionPaths();
  if (!(await safariExtensionAvailable(platform, paths)))
    return { ok: false, code: "safari-extension-unavailable" };
  let identifier: string;
  try {
    const handle = await open(paths.identifier,
      constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 256 || stat.size < 1)
        throw new Error("invalid-extension-identifier");
      const bytes = Buffer.alloc(stat.size + 1);
      let size = 0;
      let complete = false;
      while (size < bytes.length) {
        const part = await handle.read(bytes, size,
          bytes.length - size, null);
        if (part.bytesRead === 0) {
          complete = true;
          break;
        }
        size += part.bytesRead;
      }
      const after = await handle.stat();
      if (!complete || size !== stat.size ||
          stat.dev !== after.dev || stat.ino !== after.ino ||
          stat.size !== after.size ||
          stat.mtimeMs !== after.mtimeMs ||
          stat.ctimeMs !== after.ctimeMs)
        throw new Error("invalid-extension-identifier");
      identifier = bytes.subarray(0, size).toString("utf8").trim();
    } finally {
      await handle.close();
    }
  } catch {
    return { ok: false, code: "safari-extension-invalid" };
  }
  if (!/^[A-Za-z0-9.-]{3,255}$/u.test(identifier))
    return { ok: false, code: "safari-extension-invalid" };
  const run = options.run ?? runProgram;
  try {
    await run("/usr/bin/open", ["-gj", paths.companion]);
    await run(paths.helper, [identifier]);
    return { ok: true };
  } catch {
    return { ok: false, code: "safari-extension-open-failed" };
  }
}

async function runProgram(program: string, args: readonly string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, [...args], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("safari-extension-open-timeout"));
    }, 15_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("safari-extension-open-failed"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("safari-extension-open-failed"));
    });
  });
}
