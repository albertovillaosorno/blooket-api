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
//   - Bounded CLI subprocess execution in canonical JSON mode.
// - Must-Not:
//   - Implement application semantics or return subprocess stderr.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Bounded CLI subprocess execution in canonical JSON mode.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  decodeResultEnvelope,
  type ResultEnvelope,
} from "../../../ir/wire-envelopes/contract/result-envelope.ts";
import { isBlooketPublicationCommand } from
  "../../../ir/blooket-publication-commands/contract/commands.ts";
export type { ResultEnvelope } from
  "../../../ir/wire-envelopes/contract/result-envelope.ts";

export async function executeJsonCommand(
  command: string,
  payload: unknown,
  operationId: string,
  dataRoot: string,
): Promise<ResultEnvelope> {
  const executable = fileURLToPath(
    new URL("../../executable/adapter-inbound/blooket.ts", import.meta.url),
  );
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, "command", "--json"], {
      env: {
        PATH: process.env["PATH"],
        DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"],
        XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
        BLOOKET_DATA_HOME: dataRoot,
      },
      // Execute the bundled runtime directly, without Terminal or a shell.
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: string | undefined;
    const stop = (code: string, terminate: boolean) => {
      if (failure !== undefined) return;
      failure = code;
      chunks.length = 0;
      clearTimeout(timer);
      if (terminate) child.kill("SIGKILL");
      // A signal or error is not completion. Retain ownership until close.
    };
    const timer = setTimeout(() => {
      stop("cli-timeout", true);
    }, isBlooketPublicationCommand(command) ? 125_000 : 30_000);
    child.on("error", () => stop("cli-unavailable", false));
    child.stdout.on("error", () => stop("cli-unavailable", true));
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure !== undefined) return;
      size += chunk.length;
      if (size > 2_000_000) {
        stop("cli-result-too-large", true);
      } else chunks.push(chunk);
    });
    child.once("close", () => {
      clearTimeout(timer);
      if (failure !== undefined) {
        reject(new Error(failure));
        return;
      }
      try {
        const result = decodeResultEnvelope(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        if (!result.ok || result.value.operationId !== operationId)
          throw new Error("invalid-cli-result");
        resolve(result.value);
      } catch {
        reject(new Error("invalid-cli-result"));
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(
      JSON.stringify({ version: 1, operationId, command, payload }),
    );
  });
}

// Server identity follows the CLI contract without importing internals in MCP.
export { PRODUCT_VERSION } from
  "../../../ir/product-version/contract/version.ts";
