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

    let settled = false;
    let timedOut = false;
    let stderrBytes = 0;
    let stdoutBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const finish = (result: SecretCommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    child.once("error", () => {
      finish({ ok: false, code: "secret-command-unavailable" });
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        child.kill("SIGKILL");
        finish({
          ok: false,
          code: "secret-command-output-too-large",
        });
        return;
      }
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
    });
    child.once("close", (exitCode, signal) => {
      if (timedOut) {
        finish({ ok: false, code: "secret-command-timeout" });
        return;
      }
      finish({
        ok: true,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderrBytes,
      });
    });

    child.stdin.end(invocation.stdin);
  });
};
