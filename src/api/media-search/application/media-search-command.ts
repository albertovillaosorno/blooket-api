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
//   - The media.search command payload and application operation.
// - Must-Not:
//   - Read files, invoke CLI behavior, or mutate media metadata.
// - Allows:
//   - Inputs: One validated command envelope with untrusted search payload.
//   - Outputs: Canonical result envelopes containing deterministic matches.
//   - Side effects: None.
// - Split-When:
//   - Search input sources need independent command variants.
// - Merge-When:
//   - Media search is no longer exposed through command execution.
// - Summary:
//   - Decodes media JSONL and executes field-aware media search.
// - Description:
//   - Keeps file transport outside the semantic API operation.
// - Usage:
//   - Supply mediaJsonl text and search options in the command payload.
// - Defaults:
//   - Search defaults remain owned by the media-search domain capability.
//
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";
import type { CommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import type { ResultEnvelope } from
  "../../../ir/wire-envelopes/contract/result-envelope.ts";
import { decodeMediaJsonLines } from
  "../../../media/media-index/domain/json-lines.ts";
import {
  searchMedia,
  type MediaSearchField,
  type MediaSearchMode,
  type MediaSearchRequest,
} from "../../../media/media-search/domain/media-search.ts";
import { commandFailure, commandSuccess } from
  "../../command-execution/application/result.ts";

const PAYLOAD_KEYS = new Set([
  "mediaJsonl",
  "query",
  "fields",
  "mode",
  "caseSensitive",
  "limit",
]);
const SEARCH_FIELDS = new Set<MediaSearchField>([
  "description",
  "id",
  "path",
]);

export function executeMediaSearchCommand(
  command: CommandEnvelope,
): ResultEnvelope {
  const decodedPayload = decodePayload(command.payload);
  if (!decodedPayload.ok) {
    return commandFailure(command.operationId, decodedPayload.issues);
  }

  const media = decodeMediaJsonLines(decodedPayload.mediaJsonl);
  if (!media.ok) {
    return commandFailure(command.operationId, media.issues);
  }

  const search = searchMedia(media.value, decodedPayload.request);
  if (!search.ok) {
    return commandFailure(command.operationId, search.issues);
  }

  return commandSuccess(command.operationId, {
    matches: search.value,
  });
}

type DecodedPayload =
  | {
      readonly ok: true;
      readonly mediaJsonl: string;
      readonly request: MediaSearchRequest;
    }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

function decodePayload(value: unknown): DecodedPayload {
  if (!isRecord(value)) {
    return failure("$.payload", "expected-object", "Expected search payload.");
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, PAYLOAD_KEYS, "$.payload"),
  ];
  const mediaJsonl = value["mediaJsonl"];
  const query = requiredString(value["query"], "$.payload.query", issues);
  const fields = decodeFields(value["fields"], issues);
  const mode = decodeMode(value["mode"], issues);
  const caseSensitive = decodeOptionalBoolean(
    value["caseSensitive"],
    "$.payload.caseSensitive",
    issues,
  );
  const limit = decodeOptionalNumber(
    value["limit"],
    "$.payload.limit",
    issues,
  );

  if (typeof mediaJsonl !== "string") {
    issues.push({
      path: "$.payload.mediaJsonl",
      code: "expected-string",
      message: "Expected media JSON Lines text.",
    });
  }

  if (issues.length > 0 || query === undefined) {
    return { ok: false, issues };
  }

  if (typeof mediaJsonl !== "string") {
    return failure(
      "$.payload.mediaJsonl",
      "decoder-invariant",
      "Decoder invariant failed.",
    );
  }

  return {
    ok: true,
    mediaJsonl,
    request: {
      query,
      ...(fields === undefined ? {} : { fields }),
      ...(mode === undefined ? {} : { mode }),
      ...(caseSensitive === undefined ? {} : { caseSensitive }),
      ...(limit === undefined ? {} : { limit }),
    },
  };
}

function decodeFields(
  value: unknown,
  issues: ValidationIssue[],
): readonly MediaSearchField[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({
      path: "$.payload.fields",
      code: "expected-array",
      message: "Expected an array of search fields.",
    });
    return undefined;
  }

  const fields: MediaSearchField[] = [];
  for (const [index, field] of value.entries()) {
    if (
      typeof field !== "string"
      || !SEARCH_FIELDS.has(field as MediaSearchField)
    ) {
      issues.push({
        path: `$.payload.fields[${index}]`,
        code: "invalid-search-field",
        message: 'Expected "description", "id", or "path".',
      });
      continue;
    }
    fields.push(field as MediaSearchField);
  }
  return fields;
}

function decodeMode(
  value: unknown,
  issues: ValidationIssue[],
): MediaSearchMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "literal" && value !== "regex") {
    issues.push({
      path: "$.payload.mode",
      code: "invalid-search-mode",
      message: 'Expected "literal" or "regex".',
    });
    return undefined;
  }
  return value;
}

function decodeOptionalBoolean(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push({
      path,
      code: "expected-boolean",
      message: "Expected boolean.",
    });
    return undefined;
  }
  return value;
}

function decodeOptionalNumber(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    issues.push({ path, code: "expected-number", message: "Expected number." });
    return undefined;
  }
  return value;
}

function failure(
  path: string,
  code: string,
  message: string,
): { readonly ok: false; readonly issues: readonly ValidationIssue[] } {
  return { ok: false, issues: [{ path, code, message }] };
}
