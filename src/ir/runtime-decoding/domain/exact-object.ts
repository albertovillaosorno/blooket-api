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
//   - Exact-object and primitive checks for runtime decoders.
// - Must-Not:
//   - Coerce primitive values or repair unknown object fields.
// - Allows:
//   - Inputs: Unknown runtime values and explicit field contracts.
//   - Outputs: Type guards and structured validation issues.
//   - Side effects: None.
// - Split-When:
//   - Collection decoding grows beyond primitive reusable checks.
// - Merge-When:
//   - All runtime contracts move to one generated validator.
// - Summary:
//   - Provides dependency-free exact runtime validation primitives.
// - Description:
//   - Rejects arrays, null, unknown fields, and primitive type mismatches.
// - Usage:
//   - Compose these checks inside versioned contract decoders.
// - Defaults:
//   - Unknown fields fail closed.
//
import type { ValidationIssue } from "./decode-result.js";

export type UnknownRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isExactDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 ||
      !Object.hasOwn(value, "length")) return false;
  for (let index = 0; index < value.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(value, String(index));
    if (!slot || !("value" in slot) || !slot.enumerable) return false;
  }
  return true;
}

/** Read only a directly owned data field; inherited getters are untrusted. */
export function ownDataField(
  value: UnknownRecord,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function unknownFieldIssues(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
): readonly ValidationIssue[] {
  return Reflect.ownKeys(value)
    .filter((key) => typeof key !== "string" || !allowed.has(key))
    .map((key) => typeof key === "string" ? key : "[symbol]")
    .sort()
    .map((key) => ({
      path: `${path}.${key}`,
      code: "unknown-field",
      message: "Field is not admitted by this contract.",
    }));
}

export function requiredString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  if (typeof value !== "string") {
    issues.push({
      path,
      code: "expected-string",
      message: "Expected a string.",
    });
    return undefined;
  }

  if (value.length === 0) {
    issues.push({
      path,
      code: "empty-string",
      message: "Expected a non-empty string.",
    });
    return undefined;
  }

  return value;
}
