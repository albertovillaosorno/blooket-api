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
//   - Bounded candidate decoding of Blooket Flight records and action states.
// - Must-Not:
//   - Fetch responses, expose account records, or confirm remote writes.
// - Allows:
//   - Inputs: Bounded provider Flight text and action redirect header values.
//   - Outputs: Strict candidate values, errors, redirects, or explicit failure.
//   - Side effects: None.
// - Split-When:
//   - Provider variants require independent validation contracts.
// - Merge-When:
//   - The provider no longer requires this candidate boundary.
// - Summary:
//   - Decodes the observed production Flight subset without coercion.
// - Description:
//   - Decoded candidates still require a verified provider response contract.
// - Usage:
//   - Inspect bounded records within the authenticated adapter boundary.
// - Defaults:
//   - Unsupported row tags and reference kinds fail closed.
//
export interface FlightActionState {
  readonly status: "SUCCESS" | "ERROR" | "UNSET";
  readonly message: string;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
}
export interface FlightErrorRecord {
  readonly kind: "error";
  readonly digest: string;
}
export interface FlightActionRedirect {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

const MAX_FLIGHT_BYTES = 5_000_000;
const MAX_FLIGHT_ROWS = 20_000;
const MAX_GRAPH_VALUES = 100_000;
const MAX_GRAPH_DEPTH = 100;
const MAX_TEXT_BYTES = 5_000_000;
const MAX_ACTION_TEXT_BYTES = 100_000;
const MAX_FIELD_ERRORS = 200;
const MAX_FIELD_MESSAGES = 100;

export function decodeFlightRows(source: string): ReadonlyMap<string, unknown> {
  const data = new TextEncoder().encode(source);
  if (data.length > MAX_FLIGHT_BYTES) throw new Error("flight-too-large");
  const rows = new Map<string, unknown>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  while (offset < data.length) {
    const colon = data.indexOf(58, offset);
    if (colon < 0 || colon === offset || colon - offset > 12)
      throw new Error("invalid-flight-row");
    const id = decoder.decode(data.subarray(offset, colon));
    if (!/^[0-9a-f]+$/u.test(id)) throw new Error("invalid-flight-id");
    if (rows.has(id)) throw new Error("duplicate-flight-id");
    offset = colon + 1;
    const tag = data[offset];
    if (tag === 84) {
      offset += 1;
      const comma = data.indexOf(44, offset);
      if (comma < 0 || comma === offset || comma - offset > 12)
        throw new Error("invalid-flight-text");
      const lengthText = decoder.decode(data.subarray(offset, comma));
      if (!/^[0-9a-f]+$/u.test(lengthText))
        throw new Error("invalid-flight-text");
      const length = Number.parseInt(lengthText, 16);
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_TEXT_BYTES ||
        comma + 1 + length > data.length
      )
        throw new Error("invalid-flight-text");
      rows.set(
        id,
        decoder.decode(data.subarray(comma + 1, comma + 1 + length)),
      );
      offset = comma + 1 + length;
    } else {
      if (tag !== undefined && tag >= 65 && tag <= 90 && tag !== 69)
        throw new Error("unsupported-flight-tag");
      const next = data.indexOf(10, offset);
      if (next < 0) throw new Error("unterminated-flight-row");
      const content = decoder.decode(data.subarray(offset, next));
      offset = next + 1;
      if (tag === 69) {
        rows.set(id, decodeErrorRecord(content.slice(1)));
      } else {
        try {
          rows.set(id, JSON.parse(content) as unknown);
        } catch {
          throw new Error("invalid-flight-json");
        }
      }
    }
    if (rows.size > MAX_FLIGHT_ROWS) throw new Error("flight-row-limit");
  }
  return rows;
}

export function flightObjects(
  rows: ReadonlyMap<string, unknown>,
): readonly Readonly<Record<string, unknown>>[] {
  const found: Readonly<Record<string, unknown>>[] = [];
  const objectMemo = new Map<object, unknown>();
  const rowMemo = new Map<string, unknown>();
  const resolvingRows = new Set<string>();
  const resolvingObjects = new Set<object>();
  let count = 0;

  function visit(value: unknown, depth: number): unknown {
    if (depth > MAX_GRAPH_DEPTH || ++count > MAX_GRAPH_VALUES)
      throw new Error("flight-graph-limit");
    if (typeof value === "string") {
      if (value.startsWith("$$")) return value.slice(1);
      const direct = /^\$([a-f0-9]+)$/u.exec(value);
      if (direct) return resolveRow(direct[1]!, depth + 1);
      if (/^\$[@LQWShDinNu-]/u.test(value))
        throw new Error("unsupported-flight-reference");
      return value;
    }
    if (value === null || typeof value !== "object") return value;
    if (isFlightError(value)) return value;
    const existing = objectMemo.get(value);
    if (existing !== undefined) return existing;
    if (resolvingObjects.has(value)) throw new Error("flight-cycle");
    resolvingObjects.add(value);
    try {
      if (Array.isArray(value)) {
        const output: unknown[] = [];
        objectMemo.set(value, output);
        for (const entry of value) output.push(visit(entry, depth + 1));
        return output;
      }
      const output: Record<string, unknown> = {};
      objectMemo.set(value, output);
      for (const [key, entry] of Object.entries(value))
        output[key] = visit(entry, depth + 1);
      found.push(output);
      return output;
    } finally {
      resolvingObjects.delete(value);
    }
  }

  function resolveRow(id: string, depth: number): unknown {
    if (!rows.has(id)) throw new Error("missing-flight-reference");
    if (rowMemo.has(id)) return rowMemo.get(id);
    if (resolvingRows.has(id)) throw new Error("flight-cycle");
    resolvingRows.add(id);
    try {
      const resolved = visit(rows.get(id), depth + 1);
      rowMemo.set(id, resolved);
      return resolved;
    } finally {
      resolvingRows.delete(id);
    }
  }

  for (const [id] of rows) resolveRow(id, 0);
  return found;
}

export function flightActionState(
  source: string,
): FlightActionState | undefined {
  for (const object of flightObjects(decodeFlightRows(source))) {
    if (!exactActionKeys(object)) continue;
    const status = object["status"];
    const message = object["message"];
    const fieldErrors = object["fieldErrors"];
    if (
      (status !== "SUCCESS" && status !== "ERROR" && status !== "UNSET") ||
      typeof message !== "string" ||
      encodedBytes(message) > MAX_ACTION_TEXT_BYTES ||
      !fieldErrors ||
      typeof fieldErrors !== "object" ||
      Array.isArray(fieldErrors)
    )
      continue;
    const entries = Object.entries(fieldErrors);
    if (entries.length > MAX_FIELD_ERRORS) continue;
    const decoded: Record<string, readonly string[]> = {};
    let valid = true;
    for (const [key, value] of entries) {
      if (
        key.length < 1 ||
        encodedBytes(key) > 1_000 ||
        !Array.isArray(value) ||
        value.length > MAX_FIELD_MESSAGES ||
        !value.every(
          (entry) =>
            typeof entry === "string" &&
            encodedBytes(entry) <= MAX_ACTION_TEXT_BYTES,
        )
      ) {
        valid = false;
        break;
      }
      decoded[key] = value as readonly string[];
    }
    if (valid) return { status, message, fieldErrors: decoded };
  }
  return undefined;
}

export function flightErrorRecords(
  source: string,
): readonly FlightErrorRecord[] {
  return [...decodeFlightRows(source).values()].filter(isFlightError);
}

export function decodeFlightActionRedirect(
  value: string | null,
  origin = "https://dashboard.blooket.com",
): FlightActionRedirect | null {
  if (value === null) return null;
  if (encodedBytes(value) < 1 || encodedBytes(value) > 8_192)
    throw new Error("invalid-flight-redirect");
  let base: URL;
  let target: URL;
  try {
    base = new URL(origin);
    target = new URL(value, base);
  } catch {
    throw new Error("invalid-flight-redirect");
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    target.origin !== base.origin ||
    target.username ||
    target.password
  )
    throw new Error("invalid-flight-redirect");
  return {
    pathname: target.pathname,
    search: target.search,
    hash: target.hash,
  };
}

function decodeErrorRecord(content: string): FlightErrorRecord {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw new Error("invalid-flight-error");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "digest") ||
    !("digest" in value) ||
    typeof value.digest !== "string" ||
    value.digest.length < 1 ||
    encodedBytes(value.digest) > 4_096
  )
    throw new Error("invalid-flight-error");
  return { kind: "error", digest: value.digest };
}

function isFlightError(value: unknown): value is FlightErrorRecord {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "error" &&
    typeof (value as { digest?: unknown }).digest === "string"
  );
}

function exactActionKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === 3 &&
    keys[0] === "fieldErrors" &&
    keys[1] === "message" &&
    keys[2] === "status"
  );
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).length;
}
