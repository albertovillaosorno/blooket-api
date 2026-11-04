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
import { reconcileUnchangedMetadataTextRevision } from
  "../../../api/blooket-write-execution/application/text-revision.ts";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { runCli } from "../../command-running/adapter-inbound/run-cli.ts";

import { executeCommand } from
  "../../../api/command-execution/application/execute-command.ts";
import { isBlooketReadCommand } from
  "../../../ir/blooket-read-commands/contract/commands.ts";
import { isBlooketPublicationCommand } from
  "../../../ir/blooket-publication-commands/contract/commands.ts";
import { executeLocalBlooketRead } from
  "../../../platforms/service-lifecycle/adapter-outbound/command.ts";
import { userDataRoot } from
  "../../../platforms/user-storage/adapter-outbound/root.ts";

// CLI callers may intentionally select symlinked regular files, but named
// pipes and oversized inputs must fail before any unbounded read. The limit
// matches the media vault's 16 MiB historical text-file recovery ceiling.
const MAX_CLI_TEXT_BYTES = 16 * 1_024 * 1_024;
async function readCliText(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_CLI_TEXT_BYTES))
      throw new Error("cli-file-not-admitted");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const part = await handle.read(bytes, count,
        Math.min(65_536, bytes.length - count), null);
      if (!part.bytesRead) break;
      count += part.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (BigInt(count) !== before.size || before.dev !== after.dev ||
        before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs)
      throw new Error("cli-file-changed");
    return bytes.subarray(0, count).toString("utf8");
  } finally { await handle.close(); }
}

const exitCode = await runCli(process.argv.slice(2), {
  execute: (command) =>
    command.command === "blooket.publication.reconcile-text"
      ? reconcileUnchangedMetadataTextRevision(command, userDataRoot(),
        async (setId) => {
          const operationId = "cli:" + randomUUID();
          const result = await executeLocalBlooketRead({
            version: 1, operationId, command: "blooket.sets.get",
            payload: { setId },
          }, userDataRoot());
          const data = result.ok && result.value &&
              typeof result.value === "object" &&
              !Array.isArray(result.value) ? result.value : undefined;
          if (!data || !("ok" in data) || data.ok !== true ||
              !("kind" in data) || data.kind !== "set" ||
              !("value" in data))
            throw new Error("fresh-set-read-unavailable");
          return { operationId, metadata: data.value };
        })
      : isBlooketReadCommand(command.command) ||
      isBlooketPublicationCommand(command.command)
      ? executeLocalBlooketRead(command, userDataRoot())
      : executeCommand(command),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > 1_000_000) throw new Error("stdin-too-large");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString("utf8");
  },
  readText: readCliText,
  operationId: () => `cli:${randomUUID()}`,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});

process.exitCode = exitCode;
