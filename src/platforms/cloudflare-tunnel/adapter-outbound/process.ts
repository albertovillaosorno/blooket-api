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
//   - Visible managed cloudflared process start and stop.
// - Must-Not:
//   - Put credentials in argv or forward raw connector logs.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Visible managed cloudflared process start and stop.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function connectorExecutable() {
  const bundled = fileURLToPath(
    new URL("../../../../../runtime/cloudflared", import.meta.url),
  );
  return existsSync(bundled) ? bundled : "cloudflared";
}

export function startCloudflareTunnel(
  token: string,
  update: (state: string) => void,
  executable = connectorExecutable(),
  connectionTimeoutMs = 30_000,
) {
  let child: ChildProcess | undefined;
  let stopped = false;
  let closed = false;
  let failure: string | undefined;
  update("starting");
  const timer = setTimeout(() => {
    if (!stopped) {
      failure = "connection-timeout";
      update(failure);
      child?.kill("SIGTERM");
    }
  }, connectionTimeoutMs);
  timer.unref();
  child = spawn(executable, ["tunnel", "--no-autoupdate", "run"], {
    env: {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      TUNNEL_TOKEN: token,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (
      !failure &&
      !stopped &&
      /Registered tunnel connection/u.test(chunk.toString("utf8"))
    ) {
      clearTimeout(timer);
      update("connected");
    }
  });
  child.once("error", () => {
    clearTimeout(timer);
    failure = "cloudflared-unavailable";
    if (!stopped) update(failure);
  });
  child.once("close", () => {
    closed = true;
    clearTimeout(timer);
    if (!stopped) update(failure ?? "offline");
  });
  return {
    async stop(): Promise<void> {
      stopped = true;
      clearTimeout(timer);
      if (!child || closed) return;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child?.kill("SIGKILL");
        }, 3000);
        child!.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
        child!.kill("SIGTERM");
      });
    },
  };
}
