// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - LicenseRef-Proprietary
// Confidential:
//   - true
// License-File:
//   - LICENSE
//
// Boundary-Contract:
// - Owns:
//   - Bounded subprocess execution for OS secret-store commands.
// - Must-Not:
//   - Interpret secret-store semantics or retain stderr text.
// - Allows:
//   - Inputs: Absolute executable paths, arguments, and optional stdin bytes.
//   - Outputs: Exit status, bounded stdout, and stderr byte counts.
//   - Side effects: Starts one bounded child process.
// - Split-When:
//   - Secret-store commands require platform-specific process lifecycles.
// - Merge-When:
//   - Host secret storage no longer uses command-line OS clients.
// - Summary:
//   - Runs credential commands without exposing stderr as application data.
// - Description:
//   - Bounds execution time and output while keeping stdin out of process argv.
// - Usage:
//   - Inject in tests; use the default runner only inside host secret storage.
// - Defaults:
//   - Commands time out after five seconds and stdout is bounded to 128 KiB.
//
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_STDOUT_BYTES = 128 * 1024;

export interface SecretCommandInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin?: Uint8Array;
  readonly timeoutMs?: number;
  readonly captureStdout?: boolean;
}

export type SecretCommandResult =
  | {
      readonly ok: true;
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly stdout: Uint8Array;
      readonly stderrBytes: number;
    }
  | {
      readonly ok: false;
      readonly code:
        | "secret-command-unavailable"
        | "secret-command-timeout"
        | "secret-command-output-too-large";
    };

export type SecretCommandRunner = (
  invocation: SecretCommandInvocation,
) => Promise<SecretCommandResult>;

export const runSecretCommand: SecretCommandRunner = async (
  invocation,
) => {
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        invocation.command,
        [...invocation.args],
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch {
      resolve({ ok: false, code: "secret-command-unavailable" });
      return;
    }

    let failure: Extract<SecretCommandResult, { ok: false }>["code"]
      | undefined;
    let stderrBytes = 0;
    let stdoutBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stop = (code: NonNullable<typeof failure>, terminate: boolean) => {
      if (failure !== undefined) return;
      failure = code;
      stdoutChunks.length = 0;
      if (terminate) {
        try { child.kill("SIGKILL"); }
        catch { /* The close event still owns process completion. */ }
      }
    };
    const timeout = setTimeout(() => {
      stop("secret-command-timeout", true);
    }, invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    // A signal, stream error, or failed spawn is not proof that a secret
    // store writer has exited. Only close releases subprocess ownership.
    child.once("error", () => {
      stop("secret-command-unavailable", false);
    });
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on("error", () => {
        stop("secret-command-unavailable", true);
      });
    }
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure !== undefined) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stop("secret-command-output-too-large", true);
      } else if (invocation.captureStdout === true) {
        stdoutChunks.push(Buffer.from(chunk));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (failure === undefined) stderrBytes += chunk.byteLength;
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (failure !== undefined) {
        resolve({ ok: false, code: failure });
        return;
      }
      resolve({
        ok: true,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderrBytes,
      });
    });

    try { child.stdin.end(invocation.stdin); }
    catch { stop("secret-command-unavailable", true); }
  });
};
