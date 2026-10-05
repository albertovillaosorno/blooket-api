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
//   - Fail-closed redaction of structured values before diagnostics emission.
// - Must-Not:
//   - Persist logs, inspect secret stores, or infer whether free text is safe.
// - Allows:
//   - Inputs: Structured diagnostic values selected by trusted callers.
//   - Outputs: Bounded JSON-compatible values with sensitive fields redacted.
//   - Side effects: None.
// - Split-When:
//   - Transport-specific log formatting gains independent security semantics.
// - Merge-When:
//   - Diagnostics no longer accept structured values.
// - Summary:
//   - Sanitizes diagnostic fields before they cross an observability boundary.
// - Description:
//   - Redacts secret-bearing keys, accessors, cycles, and excessive structures.
// - Usage:
//   - Sanitize fields before serialization, logging, CLI output, or telemetry.
// - Defaults:
//   - Sensitive values are replaced and unknown executable values are omitted.
//
export type RedactedDiagnosticValue =
  | null
  | boolean
  | number
  | string
  | RedactedDiagnosticArray
  | RedactedDiagnosticObject;

export interface RedactedDiagnosticArray
  extends ReadonlyArray<RedactedDiagnosticValue> {}

export interface RedactedDiagnosticObject {
  readonly [key: string]: RedactedDiagnosticValue;
}

const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";
const ACCESSOR = "[ACCESSOR OMITTED]";
const UNSUPPORTED = "[UNSUPPORTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = 8;
const MAX_COLLECTION_ENTRIES = 100;

const SENSITIVE_KEY_MARKERS = [
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "password",
  "passwd",
  "refreshtoken",
  "secret",
  "sessionid",
  "sessionsecret",
  "setcookie",
  "token",
] as const;

export function redactDiagnosticValue(
  value: unknown,
): RedactedDiagnosticValue {
  return redact(value, 0, new WeakSet<object>());
}

export function isSensitiveDiagnosticKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return SENSITIVE_KEY_MARKERS.some((marker) => normalized.includes(marker));
}

function redact(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): RedactedDiagnosticValue {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : UNSUPPORTED;
  }

  if (typeof value !== "object") {
    return UNSUPPORTED;
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED;
  }

  if (seen.has(value)) {
    return CIRCULAR;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const entries = value
      .slice(0, MAX_COLLECTION_ENTRIES)
      .map((entry) => redact(entry, depth + 1, seen));
    if (value.length > MAX_COLLECTION_ENTRIES) {
      entries.push(TRUNCATED);
    }
    return entries;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  const result: Record<string, RedactedDiagnosticValue> = {};
  for (const key of keys.slice(0, MAX_COLLECTION_ENTRIES)) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || descriptor.enumerable !== true) {
      continue;
    }

    if (isSensitiveDiagnosticKey(key)) {
      result[key] = REDACTED;
      continue;
    }

    if (!("value" in descriptor)) {
      result[key] = ACCESSOR;
      continue;
    }

    result[key] = redact(descriptor.value, depth + 1, seen);
  }

  if (keys.length > MAX_COLLECTION_ENTRIES) {
    result["$truncated"] = TRUNCATED;
  }
  return result;
}
