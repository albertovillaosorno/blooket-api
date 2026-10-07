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
//   - Exact persisted first-use diagnostic state and bounded log authority.
// - Must-Not:
//   - Execute checks, consume credentials, or prove native host acceptance.
// - Allows:
//   - Inputs: Untrusted diagnostic records.
//   - Outputs: Validated state or bounded decoding failures.
//   - Side effects: None.
// - Split-When:
//   - Native diagnostic results need a different schema or trust authority.
// - Merge-When:
//   - Diagnostic persistence no longer exists.
// - Summary:
//   - Prevents malformed cached diagnostics becoming trusted startup status.
// - Description:
//   - Rejects unknown fields, duplicate checks, and contradictory outcomes.
// - Usage:
//   - Decode before returning persisted state or publishing a fresh result.
// - Defaults:
//   - Unknown schemas and malformed records fail closed.
//
import { isRecord } from "../../runtime-decoding/domain/exact-object.ts";
import {
  decodeFailure,
  type DecodeResult,
} from "../../runtime-decoding/domain/decode-result.ts";

export const DIAGNOSTIC_MAX_BYTES = 16_384;
export const DIAGNOSTIC_LOG = "logs/first-use.json";

export type DiagnosticCheckName =
  | "runtime"
  | "macos"
  | "settings"
  | "storage"
  | "online"
  | "native-image"
  | "secret-store-client";
export type DiagnosticCheckStatus =
  | "passed" | "failed" | "unconfigured" | "unverified";
export interface DiagnosticCheck {
  readonly name: DiagnosticCheckName;
  readonly status: DiagnosticCheckStatus;
  readonly code: string;
}
export interface FirstUseDiagnostic {
  readonly schemaVersion: 1;
  readonly checkVersion: 1;
  readonly at: string;
  readonly outcome: "passed" | "failed";
  readonly checks: readonly DiagnosticCheck[];
  readonly log: typeof DIAGNOSTIC_LOG;
}

const NAMES = new Set<unknown>([
  "runtime", "macos", "settings", "storage", "online", "native-image",
  "secret-store-client",
]);
const STATUSES = new Set<unknown>([
  "passed", "failed", "unconfigured", "unverified",
]);
const REQUIRED: readonly DiagnosticCheckName[] = [
  "runtime", "macos", "storage", "native-image", "secret-store-client",
];

export function decodeFirstUseDiagnostic(
  value: unknown,
): DecodeResult<FirstUseDiagnostic> {
  if (
    !isRecord(value)
    || !exactKeys(value, [
      "schemaVersion", "checkVersion", "at", "outcome", "checks", "log",
    ])
    || value["schemaVersion"] !== 1
    || value["checkVersion"] !== 1
    || !canonicalTime(value["at"])
    || value["log"] !== DIAGNOSTIC_LOG
    || !Array.isArray(value["checks"])
    || value["checks"].length > NAMES.size
  )
    return invalid();

  const names = new Set<DiagnosticCheckName>();
  const checks: DiagnosticCheck[] = [];
  for (const item of value["checks"] as unknown[]) {
    if (
      !isRecord(item)
      || !exactKeys(item, ["name", "status", "code"])
      || !NAMES.has(item["name"])
      || !STATUSES.has(item["status"])
      || typeof item["code"] !== "string"
      || !/^[a-z][a-z0-9-]{1,60}$/u.test(item["code"])
    )
      return invalid();
    const name = item["name"] as DiagnosticCheckName;
    if (names.has(name)) return invalid();
    names.add(name);
    checks.push({
      name,
      status: item["status"] as DiagnosticCheckStatus,
      code: item["code"],
    });
  }
  if (REQUIRED.some((name) => !names.has(name))) return invalid();
  const outcome = checks.some((check) => check.status === "failed")
    ? "failed" : "passed";
  if (value["outcome"] !== outcome) return invalid();
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      checkVersion: 1,
      at: value["at"] as string,
      outcome,
      checks,
      log: DIAGNOSTIC_LOG,
    },
  };
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function canonicalTime(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 24) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function invalid(): DecodeResult<never> {
  return decodeFailure(
    "$", "invalid-diagnostic-state", "Invalid first-use diagnostic state.",
  );
}
