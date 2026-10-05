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

export async function executeCommand(
  command: CommandEnvelope,
): Promise<ResultEnvelope> {
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
