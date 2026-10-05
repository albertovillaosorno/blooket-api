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
//   - Exact runtime metadata and versioned persistence for one media asset.
// - Must-Not:
//   - Store source URLs, image bytes, or infer English verification.
// - Allows:
//   - Inputs: Runtime records or persisted version-one/version-two candidates.
//   - Outputs: Canonical media records or structured validation failures.
//   - Side effects: None.
// - Split-When:
//   - Rendition metadata needs an independently versioned record.
// - Merge-When:
//   - Media metadata is no longer persisted separately from projects.
// - Summary:
//   - Keeps stable IDs separate from editable human display names.
// - Description:
//   - Legacy unversioned records migrate display names from their stable IDs.
// - Usage:
//   - Decode runtime records and each persisted JSONL line at trust boundaries.
// - Defaults:
//   - New records default name to ID and English verification to false.
//
import {
  decodeFailure,
  type DecodeResult,
  type ValidationIssue,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";
import { decodeMediaId } from
  "../../media-identifiers/domain/media-id.ts";

export const MEDIA_RECORD_SCHEMA_VERSION = 2 as const;

export interface MediaRecord {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly english: boolean;
}

export interface MediaRecordInput {
  readonly id: string;
  readonly path: string;
  readonly name?: string;
  readonly description: string;
  readonly english?: boolean;
}

const RUNTIME_KEYS = new Set([
  "id",
  "path",
  "name",
  "description",
  "english",
]);
const LEGACY_KEYS = new Set([
  "id",
  "path",
  "description",
  "english",
]);
const VERSION_TWO_KEYS = new Set([
  "schemaVersion",
  ...RUNTIME_KEYS,
]);

export function createMediaRecord(
  input: MediaRecordInput,
): DecodeResult<MediaRecord> {
  return decodeMediaRecord({
    id: input.id,
    path: input.path,
    name: input.name ?? input.id,
    description: input.description,
    english: input.english ?? false,
  });
}

export function decodeMediaRecord(value: unknown): DecodeResult<MediaRecord> {
  if (!isRecord(value)) {
    return decodeFailure("$", "expected-object", "Expected a media record.");
  }

  if (value["name"] === undefined) {
    return decodeKnownRecord(value, LEGACY_KEYS, value["id"]);
  }
  return decodeKnownRecord(value, RUNTIME_KEYS, value["name"]);
}

export function decodePersistedMediaRecord(
  value: unknown,
): DecodeResult<MediaRecord> {
  if (!isRecord(value)) {
    return decodeFailure("$", "expected-object", "Expected a media record.");
  }

  if (value["schemaVersion"] === undefined) {
    return decodeKnownRecord(value, LEGACY_KEYS, value["id"]);
  }
  if (value["schemaVersion"] === MEDIA_RECORD_SCHEMA_VERSION) {
    return decodeKnownRecord(value, VERSION_TWO_KEYS, value["name"]);
  }
  return decodeFailure(
    "$.schemaVersion",
    "unsupported-version",
    "Expected media record schema version 2 or a legacy unversioned record.",
  );
}

function decodeKnownRecord(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
  nameValue: unknown,
): DecodeResult<MediaRecord> {
  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, keys, "$"),
  ];
  const id = requiredString(value["id"], "$.id", issues);
  const path = requiredString(value["path"], "$.path", issues);
  const name = requiredString(nameValue, "$.name", issues);
  const description = requiredString(
    value["description"],
    "$.description",
    issues,
  );
  const english = value["english"];

  const mediaId = decodeMediaId(id, "$.id");
  if (!mediaId.ok) {
    issues.push(...mediaId.issues);
  }

  if (path !== undefined && !isLocalMediaPath(path)) {
    issues.push({
      path: "$.path",
      code: "invalid-media-path",
      message: "Expected a normalized relative media path.",
    });
  }

  if (typeof english !== "boolean") {
    issues.push({
      path: "$.english",
      code: "expected-boolean",
      message: "Expected true or false.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (
    id === undefined
    || path === undefined
    || name === undefined
    || description === undefined
    || typeof english !== "boolean"
  ) {
    return decodeFailure("$", "decoder-invariant", "Decoder invariant failed.");
  }

  return {
    ok: true,
    value: { id, path, name, description, english },
  };
}

function isLocalMediaPath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    return false;
  }

  const segments = path.split("/");
  return segments.every((segment) => {
    return segment.length > 0 && segment !== "." && segment !== "..";
  });
}
