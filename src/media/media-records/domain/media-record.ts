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
//   - Exact persisted metadata for one local media-vault asset.
// - Must-Not:
//   - Store source URLs, image bytes, or infer English verification.
// - Allows:
//   - Inputs: Unknown runtime media-record candidates.
//   - Outputs: Strict media records or structured validation failures.
//   - Side effects: None.
// - Split-When:
//   - Rendition metadata needs an independently versioned record.
// - Merge-When:
//   - Media metadata is no longer persisted separately from projects.
// - Summary:
//   - Defines the minimal searchable media metadata contract.
// - Description:
//   - Keeps IDs, local paths, English descriptions, and verification state.
// - Usage:
//   - Decode each JSONL line before admitting it to the media vault.
// - Defaults:
//   - English verification is explicit and never inferred by this decoder.
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

export interface MediaRecord {
  readonly id: string;
  readonly path: string;
  readonly description: string;
  readonly english: boolean;
}

const MEDIA_KEYS = new Set(["id", "path", "description", "english"]);
export function decodeMediaRecord(value: unknown): DecodeResult<MediaRecord> {
  if (!isRecord(value)) {
    return decodeFailure("$", "expected-object", "Expected a media record.");
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, MEDIA_KEYS, "$"),
  ];
  const id = requiredString(value["id"], "$.id", issues);
  const path = requiredString(value["path"], "$.path", issues);
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
    || description === undefined
    || typeof english !== "boolean"
  ) {
    return decodeFailure("$", "decoder-invariant", "Decoder invariant failed.");
  }

  return {
    ok: true,
    value: { id, path, description, english },
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
