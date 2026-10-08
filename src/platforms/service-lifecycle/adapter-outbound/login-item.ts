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
//   - Bounded native login-item control for the installed app.
// - Must-Not:
//   - Open Terminal, choose caller paths, or guess OS approval.
// - Allows:
//   - Inputs: Explicit host configuration and bounded lifecycle inputs.
//   - Outputs: Validated local status, artifacts, or stable failure codes.
//   - Side effects: Owned filesystem, process, or browser operations.
// - Split-When:
//   - Host admission needs an independent platform boundary.
// - Merge-When:
//   - This host capability no longer needs a separate boundary.
// - Summary:
//   - Keeps explicit host operations outside product semantics.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { decodeLoginItemStatus, type LoginItemStatus } from
  "../../../ir/login-item-state/contract/state.ts";

export interface LoginItemControl {
  inspect(): Promise<LoginItemStatus>;
  setEnabled(enabled: boolean): Promise<LoginItemStatus>;
}
export type LoginItemCommand = (
  executable: string, args: readonly string[],
) => Promise<{ readonly stdout: string }>;
const executeFile = promisify(execFile);

export function createPackagedLoginItemControl(options: {
  readonly platform?: NodeJS.Platform;
  readonly executable?: string;
  readonly execute?: LoginItemCommand;
} = {}): LoginItemControl {
  const platform = options.platform ?? process.platform;
  const executable = options.executable ?? process.execPath;
  const execute: LoginItemCommand = options.execute ??
    (async (file, args) => await executeFile(file, [...args], {
      timeout: 15_000, maxBuffer: 4_096, killSignal: "SIGKILL", shell: false,
      env: { HOME: process.env["HOME"], PATH: "/usr/bin:/bin", LC_ALL: "C" },
    }));
  async function command(action: string): Promise<LoginItemStatus> {
    if (platform !== "darwin")
      return { schemaVersion: 1, state: "unsupported" };
    // Node belongs at Contents/Resources/runtime/node in this exact app.
    const runtime = dirname(executable), resources = dirname(runtime);
    const contents = dirname(resources), bundle = dirname(contents);
    if (!isAbsolute(executable) || basename(executable) !== "node" ||
        basename(runtime) !== "runtime" ||
        basename(resources) !== "Resources" ||
        basename(contents) !== "Contents" ||
        basename(bundle) !== "Blooket API.app")
      throw new Error("login-item-unavailable");
    const launcher = join(contents, "MacOS/Blooket API");
    if (await realpath(executable) !== executable ||
        await realpath(launcher) !== launcher ||
        !(await lstat(executable)).isFile() ||
        !(await lstat(launcher)).isFile())
      throw new Error("login-item-unavailable");
    const result = await execute(launcher, [action]);
    if (typeof result.stdout !== "string" ||
        Buffer.byteLength(result.stdout) > 4_096)
      throw new Error("invalid-login-item-status");
    const decoded = decodeLoginItemStatus(JSON.parse(result.stdout));
    if (!decoded.ok || ["unsupported", "unavailable"].includes(
      decoded.value.state,
    )) throw new Error("invalid-login-item-status");
    return decoded.value;
  }
  return {
    inspect: async () => await command("--login-status").catch(() => ({
      schemaVersion: 1 as const, state: "unavailable" as const,
    })),
    setEnabled: async enabled => {
      if (typeof enabled !== "boolean")
        throw new Error("invalid-login-item-request");
      return command(enabled ? "--login-enable" : "--login-disable");
    },
  };
}
