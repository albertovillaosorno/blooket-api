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
//   - Routing canonical command envelopes to exactly one API application.
// - Must-Not:
//   - Parse transport syntax, read files, or duplicate command semantics.
// - Allows:
//   - Inputs: Already validated command envelopes.
//   - Outputs: Canonical result envelopes from registered API operations.
//   - Side effects: Only those explicitly owned by the selected command.
// - Split-When:
//   - Command registration requires independently versioned discovery metadata.
// - Merge-When:
//   - The API exposes only one command operation.
// - Summary:
//   - Provides one semantic command dispatcher for CLI, HTTP, and other
//     clients.
// - Description:
//   - Unknown command names fail in the same result format as domain failures.
// - Usage:
//   - Every transport lowers into a command envelope before calling this
//     router.
// - Defaults:
//   - Unregistered commands fail closed.
//
import type { CommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import type { ResultEnvelope } from
  "../../../ir/wire-envelopes/contract/result-envelope.ts";
import { executeMediaSearchCommand } from
  "../../media-search/application/media-search-command.ts";
import { executeProjectValidationCommand } from
  "../../project-validation/application/project-validation-command.ts";
import { commandFailure } from "./result.ts";

import { LIBRARY_COMMANDS } from
  "../../../ir/library-commands/contract/commands.ts";
import { executeLibraryCommand } from
  "../../teacher-library/application/library.ts";

import { isBlooketReadCommand } from
  "../../../ir/blooket-read-commands/contract/commands.ts";
import {
  executeBlooketReadCommand,
  type BlooketReadDependencies,
} from "../../blooket-set-reads/application/command.ts";
import { isBlooketPublicationCommand } from
  "../../../ir/blooket-publication-commands/contract/commands.ts";
import { executeBlooketPublicationCommand,
  type BlooketPublicationDependencies } from
  "../../blooket-write-execution/application/command.ts";

export async function executeCommand(
  command: CommandEnvelope,
  dataRoot?: string,
  blooket?: BlooketReadDependencies,
  publication?: BlooketPublicationDependencies,
): Promise<ResultEnvelope> {
  if (isBlooketPublicationCommand(command.command))
    return executeBlooketPublicationCommand(command, publication);
  if (isBlooketReadCommand(command.command))
    return executeBlooketReadCommand(command, blooket);
  if (LIBRARY_COMMANDS.some((name) => name === command.command))
    return await executeLibraryCommand(command, dataRoot);
  switch (command.command) {
    case "media.search":
      return executeMediaSearchCommand(command);
    case "project.validate":
      return executeProjectValidationCommand(command);
    default:
      return commandFailure(command.operationId, [
        {
          path: "$.command",
          code: "unknown-command",
          message: `Command ${command.command} is not registered.`,
        },
      ]);
  }
}
