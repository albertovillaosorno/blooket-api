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
//   - The Node process entrypoint for the repository blooket CLI.
// - Must-Not:
//   - Implement command semantics or expose exception details to stdout.
// - Allows:
//   - Inputs: Process arguments and local UTF-8 files selected by the caller.
//   - Outputs: CLI stdout, stderr, and process exit status.
//   - Side effects: Reads files and writes process streams.
// - Split-When:
//   - Packaged native launchers need independent host-specific entrypoints.
// - Merge-When:
//   - Another executable runtime becomes the sole CLI host.
// - Summary:
//   - Wires Node process facilities into the transport-only CLI runner.
// - Description:
//   - Creates lowercase UUID operation IDs for cross-transport correlation.
// - Usage:
//   - Invoke through the repository blooket package script during development.
// - Defaults:
//   - Files are decoded as UTF-8 text.
//
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { runCli } from
  "../../command-running/adapter-inbound/run-cli.ts";

const exitCode = await runCli(process.argv.slice(2), {
  readText: (path) => readFile(path, "utf8"),
  operationId: () => `cli:${randomUUID()}`,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});

process.exitCode = exitCode;
