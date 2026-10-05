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
//   - Canonical JSON Lines decoding and serialization for media metadata.
// - Must-Not:
//   - Read files, search records, or repair malformed lines.
// - Allows:
//   - Inputs: UTF-8 JSONL text or already validated media records.
//   - Outputs: Decoded media records or canonical JSONL text.
//   - Side effects: None.
// - Split-When:
//   - Streaming indexes need an independently versioned parser contract.
// - Merge-When:
//   - Media metadata no longer uses JSON Lines persistence.
// - Summary:
//   - Makes media.jsonl a strict stable text index for humans and agents.
// - Description:
//   - Parses each line independently and rejects duplicate IDs and paths.
// - Usage:
//   - Decode before search and serialize only validated media records.
// - Defaults:
//   - Empty indexes are valid and non-empty output ends with one newline.
//
import { parseJson } from "../../../ir/json-syntax/domain/json.ts";
import {
  type DecodeResult,
  type ValidationIssue,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  decodePersistedMediaRecord,
  MEDIA_RECORD_SCHEMA_VERSION,
  type MediaRecord,
} from "../../media-records/domain/media-record.ts";

export function decodeMediaJsonLines(
  source: string,
): DecodeResult<readonly MediaRecord[]> {
  if (source.length === 0) {
    return { ok: true, value: [] };
  }

  const rawLines = source.split("\n");
  if (rawLines.at(-1) === "") {
    rawLines.pop();
  }

  const records: MediaRecord[] = [];
  const issues: ValidationIssue[] = [];
  for (const [index, rawLine] of rawLines.entries()) {
    const lineNumber = index + 1;
    const path = `$.lines[${lineNumber}]`;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      issues.push({
        path,
        code: "blank-jsonl-line",
        message: "Blank lines are not admitted inside media.jsonl.",
      });
      continue;
    }

    const parsed = parseJson(line);
    if (!parsed.ok) {
      issues.push({
        path,
        code: "invalid-json",
        message: parsed.message,
      });
      continue;
    }

    const decoded = decodePersistedMediaRecord(parsed.value);
    if (!decoded.ok) {
      issues.push(
        ...decoded.issues.map((issue) => ({
          ...issue,
          path: `${path}${issue.path === "$" ? "" : issue.path.slice(1)}`,
        })),
      );
      continue;
    }
    records.push(decoded.value);
  }

  addDuplicateIssues(records, issues);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: records };
}

export function serializeMediaJsonLines(
  records: readonly MediaRecord[],
): string {
  if (records.length === 0) {
    return "";
  }

  const lines = records.map((record) => {
    return JSON.stringify({
      schemaVersion: MEDIA_RECORD_SCHEMA_VERSION,
      id: record.id,
      path: record.path,
      name: record.name,
      description: record.description,
      english: record.english,
    });
  });
  return `${lines.join("\n")}\n`;
}

function addDuplicateIssues(
  records: readonly MediaRecord[],
  issues: ValidationIssue[],
): void {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [index, record] of records.entries()) {
    const linePath = `$.lines[${index + 1}]`;
    if (ids.has(record.id)) {
      issues.push({
        path: `${linePath}.id`,
        code: "duplicate-media-id",
        message: `Media ID ${record.id} appears more than once.`,
      });
    }
    if (paths.has(record.path)) {
      issues.push({
        path: `${linePath}.path`,
        code: "duplicate-media-path",
        message: `Media path ${record.path} appears more than once.`,
      });
    }
    ids.add(record.id);
    paths.add(record.path);
  }
}
