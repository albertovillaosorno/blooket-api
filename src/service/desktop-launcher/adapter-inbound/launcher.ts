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
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { userDataRoot } from
  "../../../platforms/user-storage/adapter-outbound/root.ts";
import {
  boundedResponseText,
  decodeServiceRuntime,
  existingService,
} from "../../../platforms/service-lifecycle/adapter-outbound/runtime.ts";
import { openLocalWorkspace } from
  "../../../platforms/browser-opening/adapter-outbound/open.ts";
import { runFirstUseDiagnostics } from
  "../../../api/teacher-configuration/application/configuration.ts";
import { withCanonicalDataWriter } from
  "../../../platforms/user-storage/adapter-outbound/writer-boundary.ts";
import { decodeServiceSupervisorReady } from
  "../../../ir/application-updates/contract/supervision.ts";

// HTTP 202 only admits a shutdown request. The explicit launcher cannot
// present it as completed until this process has exited, its discovery and
// service lock have vanished, and all canonical writer leases are gone.
// This is a read-only observation, never update-installation authority.
async function observeServiceClosure(root: string,
  observed: { readonly pid: number; readonly origin: string }):
  Promise<boolean> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    let exited = false;
    try { process.kill(observed.pid, 0); }
    catch (error) {
      exited = error instanceof Error && "code" in error &&
        error.code === "ESRCH";
    }
    if (exited) {
      const missing = async (name: string): Promise<boolean> => {
        try { await lstat(join(root, name)); return false; }
        catch (error) { return error instanceof Error && "code" in error &&
          error.code === "ENOENT"; }
      };
      const runtimeGone = await missing("service-runtime.json");
      const lockGone = await missing(".service.lock");
      let writersGone = false;
      try {
        const directory = join(root, ".canonical-writers");
        const state = await lstat(directory);
        writersGone = state.isDirectory() &&
          (await readdir(directory)).length === 0;
      } catch { /* Missing or ambiguous lease storage is not proof. */ }
      if (runtimeGone && lockGone && writersGone) {
        // PID reuse and a removed discovery file cannot establish that the
        // original loopback listener is gone. Refuse every response and
        // timeout; only an actual connection refusal completes this proof.
        let listenerGone = false;
        try {
          const response = await fetch(observed.origin +
            "/api/service-status", {
            redirect: "error", signal: AbortSignal.timeout(350),
          });
          await response.body?.cancel().catch(() => undefined);
        } catch (error) {
          const cause = error instanceof Error && "cause" in error
            ? error.cause : undefined;
          listenerGone = error instanceof TypeError &&
            cause instanceof Error && "code" in cause &&
            cause.code === "ECONNREFUSED";
        }
        if (listenerGone) return true;
      }
    }
    if (Date.now() >= deadline) return false;
    await pause(75);
  }
}

const args = process.argv.slice(2);
const options = ["--no-open", "--stop", "--status", "--diagnostics"];
if (
  args.some((arg) => !options.includes(arg))
  || (args.includes("--diagnostics") && args.length !== 1)
) {
  process.stderr.write("Unsupported launcher option.\n");
  process.exitCode = 1;
} else {
  try {
    const root = userDataRoot();
    let runtime = args.includes("--diagnostics")
      ? undefined : await existingService(root);
    if (args.includes("--diagnostics")) {
      const diagnostic = await withCanonicalDataWriter(root,
        () => runFirstUseDiagnostics(root, true));
      process.stdout.write(JSON.stringify(diagnostic) + "\n");
      if (diagnostic.outcome === "failed") process.exitCode = 1;
    } else if (args.includes("--stop")) {
      if (runtime) {
        const boot = await fetch(runtime.origin + "/api/bootstrap", {
          signal: AbortSignal.timeout(3_000), redirect: "error",
        });
        if (!boot.ok) throw new Error("invalid-runtime");
        const source = await boundedResponseText(boot, 128_000);
        if (source === undefined) throw new Error("invalid-runtime");
        const data = JSON.parse(source) as { csrf?: unknown };
        if (typeof data.csrf !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/u.test(data.csrf))
          throw new Error("invalid-runtime");
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
        await response.body?.cancel().catch(() => undefined);
        if (!await observeServiceClosure(root, runtime))
          throw new Error("service-stop-unconfirmed");
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
            "../../background-service/adapter-inbound/supervisor.ts",
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
            // The supervisor retains its actual service child. A launcher
            // deadline cannot prove that startup writers have stopped.
            if (child.connected) child.disconnect();
            child.unref();
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
              const ready = decodeServiceSupervisorReady(message);
              if (!ready || ready.pid !== child.pid)
                throw new Error("invalid-supervisor-ready");
              const result = decodeServiceRuntime(ready.runtime);
              child.disconnect();
              child.unref();
              resolve(result);
            } catch {
              if (child.connected) child.disconnect();
              child.unref();
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
    process.stderr.write(args.includes("--stop")
      ? "Service stop is unconfirmed. Preserve the service and check " +
          "its status before replacing any app files.\n"
      : "The service could not open. Check its local port " +
          "and saved settings.\n");
    process.exitCode = 1;
  }
}
