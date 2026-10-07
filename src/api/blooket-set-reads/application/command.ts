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
//   - Canonical commands over validated read-only Blooket application ports.
// - Must-Not:
//   - Expose credentials, infer provider fields, or admit publication.
// - Allows:
//   - Inputs: Validated command inputs and explicit local ports.
//   - Outputs: Canonical read results or stable failures.
//   - Side effects: Only explicitly delegated local operations.
// - Split-When:
//   - One port family needs independent browser lifecycle management.
// - Merge-When:
//   - Application ports directly consume bridge commands.
// - Summary:
//   - Canonical commands over validated read-only Blooket application ports.
// - Description:
//   - Preserves the canonical runtime validation boundary.
// - Usage:
//   - Use through the owning validated command entrypoint.
// - Defaults:
//   - Invalid or unsupported inputs fail closed.
//
import type { CommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import {
  decodeBlooketReadCommand,
  isBlooketReadCommand,
} from "../../../ir/blooket-read-commands/contract/commands.ts";
import {
  commandFailure,
  commandSuccess,
} from "../../command-execution/application/result.ts";
import type { BlooketBrowserSessionPort } from
  "../../blooket-session/contract/browser-session.ts";
import { inspectBlooketSession } from
  "../../blooket-session/application/inspect-session.ts";
import type { BlooketSetReadPort } from "../contract/set-reads.ts";
import type { BlooketQuestionReadPort } from "../contract/question-reads.ts";
import {
  listBlooketQuestions,
  listBlooketSets,
  getBlooketSet,
} from "./read-sets.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";

export interface BlooketReadDependencies {
  readonly session: BlooketBrowserSessionPort;
  readonly sets: BlooketSetReadPort;
  readonly questions: BlooketQuestionReadPort;
  readonly secrets: HostSecretStore;
}

export async function executeBlooketReadCommand(
  command: CommandEnvelope,
  dependencies?: BlooketReadDependencies,
) {
  if (!isBlooketReadCommand(command.command))
    return fail(command.operationId, "unknown-command");
  const decoded = decodeBlooketReadCommand(command.command, command.payload);
  if (!decoded.ok) return commandFailure(command.operationId, decoded.issues);
  if (!dependencies)
    return fail(command.operationId, "blooket-browser-unavailable");
  const { session, sets, questions, secrets } = dependencies;
  const payload = decoded.value;
  const result =
    payload.kind === "session"
      ? await inspectBlooketSession(session)
      : payload.kind === "list"
        ? await listBlooketSets(session, secrets, sets, { readOnly: true })
        : payload.kind === "questions"
          ? await listBlooketQuestions(
              session,
              secrets,
              questions,
              payload.setId,
              { readOnly: true },
            )
          : await getBlooketSet(session, secrets, sets, payload.setId, {
              readOnly: true,
            });
  if (!result.ok) return fail(command.operationId, result.code);
  return commandSuccess(command.operationId, result);
}

function fail(operationId: string, code: string) {
  return commandFailure(operationId, [
    {
      path: "$.blooket",
      code,
      message:
        code === "blooket-authentication-required"
          ? "Sign in to Blooket in your local browser, then retry the read."
          : "The Blooket read could not be confirmed. Check the local browser.",
    },
  ]);
}
