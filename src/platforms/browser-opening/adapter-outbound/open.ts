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
//   - Opening the confirmed private workspace through the host browser.
// - Must-Not:
//   - Expose secrets or trust unvalidated host configuration.
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
import { spawn } from "node:child_process";
import { decodeServiceRuntime } from
  "../../service-lifecycle/adapter-outbound/runtime.ts";

const BROWSER_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_RUNTIME_DIR",
  "XDG_CURRENT_DESKTOP",
  "DESKTOP_SESSION",
  "TMPDIR",
] as const;

export function browserOpeningEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of BROWSER_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export async function openLocalWorkspace(origin: string) {
  decodeServiceRuntime({
    version: 1,
    pid: 1,
    instance: "00000000-0000-0000-0000-000000000000",
    origin,
  });
  const executable =
    process.platform === "darwin"
      ? "/usr/bin/open"
      : process.platform === "linux"
        ? "/usr/bin/xdg-open"
        : undefined;
  if (!executable) throw new Error("browser-opening-unsupported");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [origin], {
      stdio: "ignore",
      env: browserOpeningEnvironment(process.env),
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("browser-opening-timeout"));
    }, 5000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("browser-opening-unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("browser-opening-failed"));
    });
  });
}
