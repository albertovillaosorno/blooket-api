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
//   - Parsing supported blooket CLI arguments into typed invocations.
// - Must-Not:
//   - Read files, execute API commands, or infer missing project content.
// - Allows:
//   - Inputs: Process argument strings after the executable name.
//   - Outputs: Typed CLI invocations or one deterministic usage error.
//   - Side effects: None.
// - Split-When:
//   - A command family needs independently versioned syntax.
// - Merge-When:
//   - CLI parsing is replaced by another canonical argument surface.
// - Summary:
//   - Defines the initial media search and project validation CLI syntax.
// - Description:
//   - Keeps argument interpretation separate from command semantics.
// - Usage:
//   - Parse before reading any file or creating a command envelope.
// - Defaults:
//   - Media search uses domain defaults unless optional flags are present.
//
import type {
  MediaSearchField,
  MediaSearchMode,
} from "../../../media/media-search/domain/media-search.ts";

import { decodeBlooketReadCommand } from
  "../../../ir/blooket-read-commands/contract/commands.ts";
import { isBlooketPublicationCommand, decodeBlooketPublicationCommand,
  type BlooketPublicationCommandName } from
  "../../../ir/blooket-publication-commands/contract/commands.ts";

export type CliInvocation =
  | { readonly kind: "help" }
  | MediaSearchInvocation
  | ProjectValidateInvocation
  | BlooketReadInvocation
  | BlooketPublicationInvocation;

export interface BlooketPublicationInvocation {
  readonly kind: "blooket-publication";
  readonly command: BlooketPublicationCommandName;
  readonly payload: Record<string, string>;
  readonly json: boolean;
}

export interface BlooketReadInvocation {
  readonly kind: "blooket-read";
  readonly command:
    | "blooket.session.inspect"
    | "blooket.capabilities.inspect"
    | "blooket.sets.list"
    | "blooket.sets.get"
    | "blooket.questions.list";
  readonly payload: Record<string, string>;
  readonly json: boolean;
}

export interface MediaSearchInvocation {
  readonly kind: "media-search";
  readonly mediaPath: string;
  readonly query: string;
  readonly fields?: readonly MediaSearchField[];
  readonly mode?: MediaSearchMode;
  readonly caseSensitive?: boolean;
  readonly limit?: number;
  readonly json: boolean;
}

export interface ProjectValidateInvocation {
  readonly kind: "project-validate";
  readonly projectPath: string;
  readonly mediaPath?: string;
  readonly json: boolean;
}

export type CliParseResult =
  | { readonly ok: true; readonly invocation: CliInvocation }
  | { readonly ok: false; readonly message: string };

const FIELD_VALUES = new Set<MediaSearchField>([
  "description",
  "name",
  "id",
  "path",
]);

export function parseCliArguments(args: readonly string[]): CliParseResult {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    return { ok: true, invocation: { kind: "help" } };
  }

  if (args[0] === "publication") {
    const command = "blooket.publication." + args[1];
    const json = args.at(-1) === "--json";
    const values = args.slice(2, json ? -1 : undefined);
    const step = command === "blooket.publication.step";
    const payload = {
      draftId: values[0]!,
      ...(step ? { expectedRevision: values[1]! } : {}),
    };
    if (!isBlooketPublicationCommand(command) ||
        values.length !== (step ? 2 : 1) ||
        !decodeBlooketPublicationCommand(command, payload).ok)
      return { ok: false,
        message: "Usage: blooket publication " +
          "step <draft-id> <revision> [--json], or " +
          "status|verify|reconcile <draft-id> [--json]",
      };
    return { ok: true, invocation: {
      kind: "blooket-publication", command, payload, json,
    } };
  }

  if (args[0] === "session" && args[1] === "inspect")
    return parseBlooketRead("blooket.session.inspect", args.slice(2));
  if (args[0] === "capabilities" && args[1] === "inspect")
    return parseBlooketRead("blooket.capabilities.inspect", args.slice(2));
  if (args[0] === "sets" && args[1] === "list")
    return parseBlooketRead("blooket.sets.list", args.slice(2));
  if (args[0] === "sets" && args[1] === "get")
    return parseBlooketRead("blooket.sets.get", args.slice(2));
  if (args[0] === "questions" && args[1] === "list")
    return parseBlooketRead("blooket.questions.list", args.slice(2));

  if (args[0] === "media" && args[1] === "search") {
    return parseMediaSearch(args.slice(2));
  }

  if (args[0] === "project" && args[1] === "validate") {
    return parseProjectValidate(args.slice(2));
  }

  return { ok: false, message: `Unknown command: ${args.join(" ")}` };
}

function parseMediaSearch(args: readonly string[]): CliParseResult {
  const query = args[0];
  if (query === undefined) {
    return {
      ok: false,
      message: "Usage: blooket media search <query> [options]",
    };
  }

  let mediaPath = "media.jsonl";
  const fields: MediaSearchField[] = [];
  let mode: MediaSearchMode | undefined;
  let caseSensitive: boolean | undefined;
  let limit: number | undefined;
  let json = false;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--regex") {
      mode = "regex";
      continue;
    }
    if (argument === "--case-sensitive") {
      caseSensitive = true;
      continue;
    }
    if (argument === "--media") {
      const path = args[index + 1];
      if (path === undefined) {
        return { ok: false, message: "Missing --media path." };
      }
      mediaPath = path;
      index += 1;
      continue;
    }
    if (argument === "--field") {
      const field = args[index + 1];
      if (field === undefined || !FIELD_VALUES.has(field as MediaSearchField)) {
        return { ok: false, message: "Invalid or missing --field value." };
      }
      fields.push(field as MediaSearchField);
      index += 1;
      continue;
    }
    if (argument === "--limit") {
      const rawLimit = args[index + 1];
      if (rawLimit === undefined || !/^[0-9]+$/u.test(rawLimit)) {
        return { ok: false, message: "Invalid or missing --limit value." };
      }
      limit = Number(rawLimit);
      index += 1;
      continue;
    }
    return { ok: false, message: `Unknown media search option: ${argument}` };
  }

  return {
    ok: true,
    invocation: {
      kind: "media-search",
      mediaPath,
      query,
      ...(fields.length === 0 ? {} : { fields }),
      ...(mode === undefined ? {} : { mode }),
      ...(caseSensitive === undefined ? {} : { caseSensitive }),
      ...(limit === undefined ? {} : { limit }),
      json,
    },
  };
}

function parseProjectValidate(args: readonly string[]): CliParseResult {
  const projectPath = args[0];
  if (projectPath === undefined) {
    return {
      ok: false,
      message: "Usage: blooket project validate <project.json> [options]",
    };
  }

  let mediaPath: string | undefined;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--media") {
      mediaPath = args[index + 1];
      if (mediaPath === undefined) {
        return { ok: false, message: "Missing --media path." };
      }
      index += 1;
      continue;
    }
    return { ok: false, message: `Unknown project option: ${argument}` };
  }

  return {
    ok: true,
    invocation: {
      kind: "project-validate",
      projectPath,
      ...(mediaPath === undefined ? {} : { mediaPath }),
      json,
    },
  };
}

function parseBlooketRead(
  command: BlooketReadInvocation["command"],
  args: readonly string[],
): CliParseResult {
  const needsSetId =
    command === "blooket.sets.get" ||
    command === "blooket.questions.list";
  const payload: Record<string, string> =
    needsSetId ? { setId: args[0] ?? "" } : {};
  const options = needsSetId ? args.slice(1) : args;
  if (
    (options.length !== 0 &&
      (options.length !== 1 || options[0] !== "--json")) ||
    !decodeBlooketReadCommand(command, payload).ok
  )
    return { ok: false, message: "Invalid Blooket read arguments." };
  return {
    ok: true,
    invocation: {
      kind: "blooket-read",
      command,
      payload,
      json: options[0] === "--json",
    },
  };
}
