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
  const id = requiredString(value["id"], path + ".id", issues);
  const title = requiredString(
    value["title"],
    path + ".title",
    issues,
  );

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

  const items: BlooketSetSummary[] = [];
  const issues: ValidationIssue[] = [];
  for (const [index, candidate] of value.entries()) {
    const decoded = decodeBlooketSetSummary(
      candidate,
      "$[" + String(index) + "]",
    );
    if (!decoded.ok) {
      issues.push(...decoded.issues);
      continue;
    }
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
  const id = requiredString(value["id"], "$.id", issues);
  const title = requiredString(value["title"], "$.title", issues);
  const description = requiredStringValue(
    value["description"],
    "$.description",
    issues,
  );
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
