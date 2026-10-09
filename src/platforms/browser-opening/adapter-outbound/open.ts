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
  "XDG_ACTIVATION_TOKEN",
  "DESKTOP_STARTUP_ID",
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

// A human-owned Blooket sign-in stays in the OS default browser with its
// ordinary cookie jar. Do not replace it with a headless, emulated, or
// fingerprint-modified browser when Cloudflare requests human action.
export async function openBlooketInDefaultBrowser(): Promise<void> {
  await openWithSystemBrowser("https://dashboard.blooket.com/my-sets");
}

export async function openLocalWorkspace(origin: string) {
  decodeServiceRuntime({
    version: 1,
    pid: 1,
    instance: "00000000-0000-0000-0000-000000000000",
    origin,
  });
  await openWithSystemBrowser(origin);
}

async function openWithSystemBrowser(target: string): Promise<void> {
  const executable =
    process.platform === "darwin"
      ? "/usr/bin/open"
      : process.platform === "linux"
        ? "/usr/bin/xdg-open"
        : undefined;
  if (!executable) throw new Error("browser-opening-unsupported");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [target], {
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
