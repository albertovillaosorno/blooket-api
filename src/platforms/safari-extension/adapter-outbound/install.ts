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
import { access, readFile } from "node:fs/promises";
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
    await Promise.all([
      access(paths.companion),
      access(paths.helper),
      access(paths.identifier),
    ]);
    return true;
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
  const identifier = (await readFile(paths.identifier, "utf8")).trim();
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
