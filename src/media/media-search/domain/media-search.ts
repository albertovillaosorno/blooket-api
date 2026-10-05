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
//   - Deterministic field-aware search over decoded media metadata.
// - Must-Not:
//   - Read files, invoke ripgrep, mutate records, or perform semantic
//     embedding.
// - Allows:
//   - Inputs: Decoded media records and one bounded search request.
//   - Outputs: Ordered per-asset matches and structured query failures.
//   - Side effects: None.
// - Split-When:
//   - Semantic or fuzzy retrieval gains independently versioned behavior.
// - Merge-When:
//   - Media lookup no longer exposes field-aware text search.
// - Summary:
//   - Gives agents a dependency-free search surface for the media vault.
// - Description:
//   - Supports literal search by default and explicit JavaScript regex search.
// - Usage:
//   - Search descriptions alone unless the caller intentionally selects fields.
// - Defaults:
//   - Literal matching is case-insensitive and returns at most 100 results.
//
import {
  decodeFailure,
  type DecodeResult,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";
import type { MediaRecord } from
  "../../media-records/domain/media-record.ts";

export type MediaSearchField = "description" | "name" | "id" | "path";
export type MediaSearchMode = "literal" | "regex";

export interface MediaSearchRequest {
  readonly query: string;
  readonly fields?: readonly MediaSearchField[];
  readonly mode?: MediaSearchMode;
  readonly caseSensitive?: boolean;
  readonly limit?: number;
}

export interface MediaSearchMatch {
  readonly media: MediaRecord;
  readonly matchedFields: readonly MediaSearchField[];
}

const DEFAULT_FIELDS = ["description"] as const;
const MAX_QUERY_LENGTH = 256;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function searchMedia(
  records: readonly MediaRecord[],
  request: MediaSearchRequest,
): DecodeResult<readonly MediaSearchMatch[]> {
  const query = request.query;
  if (query.length === 0 || query.length > MAX_QUERY_LENGTH) {
    return decodeFailure(
      "$.query",
      "invalid-search-query",
      `Expected a query from 1 through ${MAX_QUERY_LENGTH} characters.`,
    );
  }

  const fields = request.fields ?? DEFAULT_FIELDS;
  if (fields.length === 0 || new Set(fields).size !== fields.length) {
    return decodeFailure(
      "$.fields",
      "invalid-search-fields",
      "Expected one or more unique media search fields.",
    );
  }

  const mode = request.mode ?? "literal";
  const caseSensitive = request.caseSensitive ?? false;
  const limit = request.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return decodeFailure(
      "$.limit",
      "invalid-search-limit",
      `Expected a result limit from 1 through ${MAX_LIMIT}.`,
    );
  }

  const matcher = buildMatcher(query, mode, caseSensitive);
  if (!matcher.ok) {
    return matcher;
  }

  const matches: MediaSearchMatch[] = [];
  for (const media of records) {
    const matchedFields = fields.filter((field) => {
      return matcher.value(media[field]);
    });
    if (matchedFields.length === 0) {
      continue;
    }

    matches.push({ media, matchedFields });
    if (matches.length >= limit) {
      break;
    }
  }

  return { ok: true, value: matches };
}

function buildMatcher(
  query: string,
  mode: MediaSearchMode,
  caseSensitive: boolean,
): DecodeResult<(candidate: string) => boolean> {
  if (mode === "regex") {
    try {
      const expression = new RegExp(query, caseSensitive ? "u" : "iu");
      return {
        ok: true,
        value: (candidate) => expression.test(candidate),
      };
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : "Invalid regular expression.";
      return decodeFailure("$.query", "invalid-regex", message);
    }
  }

  if (mode !== "literal") {
    return decodeFailure(
      "$.mode",
      "invalid-search-mode",
      'Expected "literal" or "regex".',
    );
  }

  const expected = caseSensitive ? query : normalize(query);
  return {
    ok: true,
    value: (candidate) => {
      const actual = caseSensitive ? candidate : normalize(candidate);
      return actual.includes(expected);
    },
  };
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US");
}
