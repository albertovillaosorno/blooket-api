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
  try {
    return typeof value === "object" && value !== null &&
      !Array.isArray(value);
  } catch { return false; }
}

export function isExactDenseArray(value: unknown): value is unknown[] {
  try {
    if (!Array.isArray(value)) return false;
    const keys = Reflect.ownKeys(value);
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (!length || !Object.hasOwn(length, "value") ||
        !Number.isSafeInteger(length.value) ||
        keys.length !== length.value + 1) return false;
    for (let index = 0; index < length.value; index++) {
      const slot = Object.getOwnPropertyDescriptor(value, String(index));
      if (!slot || !Object.hasOwn(slot, "value") ||
          !slot.enumerable) return false;
    }
    return true;
  } catch { return false; }
}

/** Read only a directly owned data field; inherited getters are untrusted. */
export function ownDataField(
  value: UnknownRecord,
  key: string,
): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor
      ? descriptor.value : undefined;
  } catch { return undefined; }
}

// Own an untrusted envelope without evaluating property getters or inherited
// accessors. The result contains only the requested enumerable data fields.
export function exactOwnData(
  value: unknown, fields: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isRecord(value)) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length || keys.some(key =>
        typeof key !== "string" || !fields.includes(key)))
      return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const owned: Record<string, unknown> = {};
    for (const name of fields) {
      const descriptor = descriptors[name];
      if (!descriptor || !descriptor.enumerable ||
          !Object.hasOwn(descriptor, "value")) return undefined;
      Object.defineProperty(owned, name, {
        value: descriptor.value, enumerable: true,
        configurable: true, writable: true,
      });
    }
    return owned;
  } catch { return undefined; }
}

export function unknownFieldIssues(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
): readonly ValidationIssue[] {
  try {
    return Reflect.ownKeys(value)
    .map(key => {
      const name = typeof key === "string" ? key : "[symbol]";
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return {
        name,
        admitted: typeof key === "string" && allowed.has(key) &&
          descriptor !== undefined && descriptor.enumerable &&
          "value" in descriptor,
      };
    })
    .filter(field => !field.admitted)
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map(field => ({
      path: `${path}.${field.name}`,
      code: "unknown-field",
      message: "Field is not admitted by this contract.",
    }));
  } catch {
    return [{ path, code: "unknown-field",
      message: "Object descriptors could not be inspected." }];
  }
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
