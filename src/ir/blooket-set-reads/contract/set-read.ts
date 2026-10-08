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
//   - Minimal versioned runtime contracts for observed Blooket set
//     metadata.
// - Must-Not:
//   - Guess remote ID grammar, question payloads, cover shapes, or extra
//     fields.
// - Allows:
//   - Inputs: Untrusted set-list and set-detail candidates.
//   - Outputs: Exact decoded metadata or structured validation failures.
//   - Side effects: None.
// - Split-When:
//   - Question retrieval gains a verified independently versioned read shape.
// - Merge-When:
//   - Set list and detail observations no longer differ structurally.
// - Summary:
//   - Validates only remote set fields established by current evidence.
// - Description:
//   - IDs are opaque non-empty strings; details add description and visibility.
// - Usage:
//   - Decode browser-adapter observations before returning them to callers.
// - Defaults:
//   - Unknown fields and unsupported versions fail closed.
//
import {
  type DecodeResult,
  type ValidationIssue,
} from "../../runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../runtime-decoding/domain/exact-object.ts";

export const BLOOKET_SET_READ_VERSION = 1 as const;

export interface BlooketSetSummary {
  readonly schemaVersion: typeof BLOOKET_SET_READ_VERSION;
  readonly id: string;
  readonly title: string;
}

export interface BlooketSetDetail {
  readonly schemaVersion: typeof BLOOKET_SET_READ_VERSION;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly visibility: "public" | "private";
}

const SUMMARY_KEYS = new Set([
  "schemaVersion",
  "id",
  "title",
]);

const DETAIL_KEYS = new Set([
  "schemaVersion",
  "id",
  "title",
  "description",
  "visibility",
]);

export function decodeBlooketSetId(
  value: unknown,
  path = "$.setId",
): DecodeResult<string> {
  const issues: ValidationIssue[] = [];
  const id = requiredString(value, path, issues);
  if (id !== undefined && (id.length > 512 || /[\x00-\x1f\x7f]/u.test(id))) {
    issues.push({
      path,
      code: "invalid-set-id",
      message: "Expected a bounded opaque set ID.",
    });
  }
  if (issues.length > 0 || id === undefined) {
    return { ok: false, issues };
  }
  return { ok: true, value: id };
}

export function decodeBlooketSetSummary(
  value: unknown,
  path = "$",
): DecodeResult<BlooketSetSummary> {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path,
        code: "expected-object",
        message: "Expected a Blooket set summary.",
      }],
    };
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, SUMMARY_KEYS, path),
  ];
  validateVersion(value["schemaVersion"], path, issues);
  const decodedId = decodeBlooketSetId(value["id"], path + ".id");
  if (!decodedId.ok) issues.push(...decodedId.issues);
  const id = decodedId.ok ? decodedId.value : undefined;
  const title = requiredTitle(value["title"], path + ".title", issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  if (id === undefined || title === undefined) {
    return invariantFailure(path);
  }
  return {
    ok: true,
    value: {
      schemaVersion: BLOOKET_SET_READ_VERSION,
      id,
      title,
    },
  };
}

export function decodeBlooketSetList(
  value: unknown,
): DecodeResult<readonly BlooketSetSummary[]> {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "expected-array",
        message: "Expected a Blooket set summary array.",
      }],
    };
  }

  // Mirror the local browser extraction cap, not a provider account limit.
  if (value.length > 200) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "too-many-sets",
        message: "Expected at most 200 observed set summaries.",
      }],
    };
  }
  const items: BlooketSetSummary[] = [];
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = "$[" + String(index) + "]";
    const decoded = decodeBlooketSetSummary(candidate, path);
    if (!decoded.ok) {
      issues.push(...decoded.issues);
      continue;
    }
    if (seenIds.has(decoded.value.id)) {
      issues.push({
        path: path + ".id",
        code: "duplicate-set-id",
        message: "Remote set ID appears more than once.",
      });
      continue;
    }
    seenIds.add(decoded.value.id);
    items.push(decoded.value);
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: items };
}

export function decodeBlooketSetDetail(
  value: unknown,
): DecodeResult<BlooketSetDetail> {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        code: "expected-object",
        message: "Expected Blooket set detail.",
      }],
    };
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, DETAIL_KEYS, "$"),
  ];
  validateVersion(value["schemaVersion"], "$", issues);
  const decodedId = decodeBlooketSetId(value["id"], "$.id");
  if (!decodedId.ok) issues.push(...decodedId.issues);
  const id = decodedId.ok ? decodedId.value : undefined;
  const title = requiredTitle(value["title"], "$.title", issues);
  const description = requiredStringValue(
    value["description"],
    "$.description",
    issues,
  );
  if (description !== undefined && description.length > 10_000) {
    issues.push({
      path: "$.description",
      code: "description-too-long",
      message: "Description exceeds the local browser read bound.",
    });
  }
  const visibility = value["visibility"];
  if (visibility !== "public" && visibility !== "private") {
    issues.push({
      path: "$.visibility",
      code: "invalid-visibility",
      message: 'Expected "public" or "private".',
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  if (
    id === undefined
    || title === undefined
    || description === undefined
    || (visibility !== "public" && visibility !== "private")
  ) {
    return invariantFailure("$");
  }

  return {
    ok: true,
    value: {
      schemaVersion: BLOOKET_SET_READ_VERSION,
      id,
      title,
      description,
      visibility,
    },
  };
}

function requiredTitle(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  const title = requiredString(value, path, issues);
  if (title !== undefined && (!title.trim() || title.length > 1_000)) {
    issues.push({
      path,
      code: "invalid-set-title",
      message: "Expected a bounded non-blank set title.",
    });
  }
  return title;
}

function requiredStringValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  issues.push({
    path,
    code: "expected-string",
    message: "Expected a string.",
  });
  return undefined;
}

function validateVersion(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === BLOOKET_SET_READ_VERSION) {
    return;
  }
  issues.push({
    path: path + ".schemaVersion",
    code: "unsupported-version",
    message: "Expected Blooket set read version 1.",
  });
}

function invariantFailure<T>(path: string): DecodeResult<T> {
  return {
    ok: false,
    issues: [{
      path,
      code: "decoder-invariant",
      message: "Decoder invariant failed.",
    }],
  };
}
