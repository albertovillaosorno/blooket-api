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
//   - Lowering typed CLI invocations into canonical API command execution.
// - Must-Not:
//   - Reimplement project validation, media search, or Blooket semantics.
// - Allows:
//   - Inputs: CLI arguments and narrow file, output, ID, and executor ports.
//   - Outputs: Human or JSON result text and a deterministic process exit code.
//   - Side effects: Reads requested local files and writes configured output.
// - Split-When:
//   - Interactive terminal behavior needs an independent adapter.
// - Merge-When:
//   - The CLI no longer adapts local files into semantic API commands.
// - Summary:
//   - Keeps CLI behavior as a transport over the canonical API executor.
// - Description:
//   - Project validation derives media.jsonl beside project.json by default.
// - Usage:
//   - MCP must use JSON mode rather than parsing human-readable output.
// - Defaults:
//   - Semantic failures return exit code 2 and adapter failures return 3.
//
import { decodeCommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import { dirname, join } from "node:path";

import { executeCommand } from
  "../../../api/command-execution/application/execute-command.ts";
import {
  COMMAND_ENVELOPE_VERSION,
  type CommandEnvelope,
} from "../../../ir/wire-envelopes/contract/command-envelope.ts";
import {
  RESULT_ENVELOPE_VERSION,
  type ResultEnvelope,
} from "../../../ir/wire-envelopes/contract/result-envelope.ts";
import {
  parseCliArguments,
  type CliInvocation,
} from "../../argument-parsing/adapter-inbound/arguments.ts";

export interface CliDependencies {
  readonly readText: (path: string) => Promise<string>;
  readonly readStdin?: () => Promise<string>;
  readonly operationId: () => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly execute?: (command: CommandEnvelope) => Promise<ResultEnvelope>;
}

const HELP = `blooket

Usage:
  blooket session inspect [--json]
  blooket capabilities inspect [--json]
  blooket sets list [--json]
  blooket sets get <set-id> [--json]
  blooket questions list <set-id> [--json]
  blooket publication step <draft-id> <revision> [--json]
  blooket publication status|verify|reconcile <draft-id> [--json]
  blooket media search <query> [options]
  blooket project validate <project.json> [options]

Media search options:
  --media <media.jsonl>          Override the current media.jsonl path.
  --field <description|name|id|path>
                               Search one field; may be repeated.
  --regex                        Interpret the query as a regular expression.
  --case-sensitive               Preserve case during matching.
  --limit <count>                Limit returned matches.
  --json                         Emit one canonical result envelope.

Project validation options:
  --media <media.jsonl>          Override the sibling media.jsonl path.
  --json                         Emit one canonical result envelope.
`;

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  if (args.length === 2 && args[0] === "command" && args[1] === "--json") {
    try {
      if (!dependencies.readStdin) throw new Error("stdin-unavailable");
      const decoded = decodeCommandEnvelope(
        JSON.parse(await dependencies.readStdin()),
      );
      if (!decoded.ok) {
        renderResult(
          {
            version: 1,
            operationId: dependencies.operationId(),
            ok: false,
            issues: decoded.issues,
          },
          true,
          dependencies,
        );
        return 2;
      }
      const result = await (dependencies.execute ?? executeCommand)(
        decoded.value,
      );
      renderResult(result, true, dependencies);
      return result.ok ? 0 : 2;
    } catch {
      renderResult(
        internalFailure(dependencies.operationId()),
        true,
        dependencies,
      );
      return 3;
    }
  }
  const parsed = parseCliArguments(args);
  if (!parsed.ok) {
    dependencies.stderr(`${parsed.message}\n`);
    return 1;
  }

  if (parsed.invocation.kind === "help") {
    dependencies.stdout(HELP);
    return 0;
  }

  const operationId = dependencies.operationId();
  let command: CommandEnvelope;
  try {
    command = await prepareCommand(
      parsed.invocation,
      operationId,
      dependencies.readText,
    );
  } catch {
    const result = fileReadFailure(operationId);
    renderResult(result, parsed.invocation.json, dependencies);
    return 3;
  }

  try {
    const executor = dependencies.execute ?? executeCommand;
    const result = await executor(command);
    renderResult(result, parsed.invocation.json, dependencies);
    return result.ok ? 0 : 2;
  } catch {
    const result = internalFailure(operationId);
    renderResult(result, parsed.invocation.json, dependencies);
    return 3;
  }
}

async function prepareCommand(
  invocation: Exclude<CliInvocation, { readonly kind: "help" }>,
  operationId: string,
  readText: (path: string) => Promise<string>,
): Promise<CommandEnvelope> {
  if (invocation.kind === "blooket-read" ||
      invocation.kind === "blooket-publication")
    return {
      version: COMMAND_ENVELOPE_VERSION,
      operationId,
      command: invocation.command,
      payload: invocation.payload,
    };
  if (invocation.kind === "media-search") {
    const mediaJsonl = await readText(invocation.mediaPath);
    return {
      version: COMMAND_ENVELOPE_VERSION,
      operationId,
      command: "media.search",
      payload: {
        mediaJsonl,
        query: invocation.query,
        ...(invocation.fields === undefined
          ? {}
          : { fields: invocation.fields }),
        ...(invocation.mode === undefined ? {} : { mode: invocation.mode }),
        ...(invocation.caseSensitive === undefined
          ? {}
          : { caseSensitive: invocation.caseSensitive }),
        ...(invocation.limit === undefined ? {} : { limit: invocation.limit }),
      },
    };
  }

  const mediaPath =
    invocation.mediaPath ??
    join(dirname(invocation.projectPath), "media.jsonl");
  const [projectJson, mediaJsonl] = await Promise.all([
    readText(invocation.projectPath),
    readText(mediaPath),
  ]);
  return {
    version: COMMAND_ENVELOPE_VERSION,
    operationId,
    command: "project.validate",
    payload: { projectJson, mediaJsonl },
  };
}

function renderResult(
  result: ResultEnvelope,
  json: boolean,
  dependencies: Pick<CliDependencies, "stdout" | "stderr">,
): void {
  if (json) {
    dependencies.stdout(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.ok) {
    dependencies.stdout(`${JSON.stringify(result.value, null, 2)}\n`);
    return;
  }

  for (const issue of result.issues) {
    dependencies.stderr(`${issue.path} ${issue.code}: ${issue.message}\n`);
  }
}

function fileReadFailure(operationId: string): ResultEnvelope {
  return {
    version: RESULT_ENVELOPE_VERSION,
    operationId,
    ok: false,
    issues: [
      {
        path: "$.files",
        code: "file-read-failed",
        message: "Unable to read one or more required local files.",
      },
    ],
  };
}

function internalFailure(operationId: string): ResultEnvelope {
  return {
    version: RESULT_ENVELOPE_VERSION,
    operationId,
    ok: false,
    issues: [
      {
        path: "$",
        code: "internal-error",
        message: "Command execution failed without exposing internal state.",
      },
    ],
  };
}
