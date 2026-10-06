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
//   - Explicit application launch, workspace opening, and service stop.
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
import { fileURLToPath } from "node:url";
import { userDataRoot } from
  "../../../platforms/user-storage/adapter-outbound/root.ts";
import {
  decodeServiceRuntime,
  existingService,
} from "../../../platforms/service-lifecycle/adapter-outbound/runtime.ts";
import { openLocalWorkspace } from
  "../../../platforms/browser-opening/adapter-outbound/open.ts";

const args = process.argv.slice(2);
if (args.some((arg) => !["--no-open", "--stop", "--status"].includes(arg))) {
  process.stderr.write("Unsupported launcher option.\n");
  process.exitCode = 1;
} else {
  try {
    const root = userDataRoot();
    let runtime = await existingService(root);
    if (args.includes("--stop")) {
      if (runtime) {
        const boot = await fetch(runtime.origin + "/api/bootstrap");
        const data = (await boot.json()) as { csrf?: unknown };
        if (typeof data.csrf !== "string") throw new Error("invalid-runtime");
        const response = await fetch(runtime.origin + "/api/service-stop", {
          method: "POST",
          headers: {
            Origin: runtime.origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": data.csrf,
          },
          body: "{}",
          signal: AbortSignal.timeout(5000),
        });
        if (response.status !== 202) throw new Error("service-stop-failed");
      }
      process.stdout.write("Service stopped.\n");
    } else if (args.includes("--status")) {
      process.stdout.write(
        runtime ? runtime.origin + "\n" : "Service offline.\n",
      );
    } else {
      if (!runtime) {
        const entry = fileURLToPath(
          new URL(
            "../../background-service/adapter-inbound/main.ts",
            import.meta.url,
          ),
        );
        runtime = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [entry], {
            detached: true,
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            env: {
              PATH: process.env["PATH"],
              DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
              XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
              HOME: process.env["HOME"],
              BLOOKET_DATA_HOME: root,
            },
          });
          const timer = setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error("service-start-timeout"));
          }, 30_000);
          child.once("error", () => {
            clearTimeout(timer);
            reject(new Error("service-start-unavailable"));
          });
          child.once("exit", () => {
            clearTimeout(timer);
            reject(new Error("service-start-failed"));
          });
          child.once("message", (message: unknown) => {
            clearTimeout(timer);
            try {
              const result = decodeServiceRuntime(message);
              child.disconnect();
              child.unref();
              resolve(result);
            } catch {
              child.kill("SIGTERM");
              reject(new Error("service-start-failed"));
            }
          });
        });
      }
      if (!runtime) throw new Error("service-start-failed");
      process.stdout.write(runtime.origin + "\n");
      if (!args.includes("--no-open")) await openLocalWorkspace(runtime.origin);
    }
  } catch {
    process.stderr.write(
      "The service could not open. Check its local port " +
        "and saved settings.\n",
    );
    process.exitCode = 1;
  }
}
