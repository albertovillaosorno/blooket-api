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
//   - Inputs: Bounded provider candidates or validated submissions.
//   - Outputs: Candidate values or explicit failure.
//   - Side effects: None.
// - Split-When:
//   - Provider variants require independent validation contracts.
// - Merge-When:
//   - The provider no longer requires this candidate boundary.
// - Summary:
//   - Bounded candidate decoding of Blooket Flight records and action states.
// - Description:
//   - Decoded candidates still require a verified provider response contract.
// - Usage:
//   - Inspect bounded records within the authenticated adapter boundary.
// - Defaults:
//   - Unrecognized states do not produce a confirmed action result.
//
export interface FlightActionState {
  readonly status: "SUCCESS" | "ERROR" | "UNSET";
  readonly message: string;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
}
export function decodeFlightRows(source: string): ReadonlyMap<string, unknown> {
  const data = new TextEncoder().encode(source);
  if (data.length > 5_000_000) throw new Error("flight-too-large");
  const rows = new Map<string, unknown>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  while (offset < data.length) {
    const colon = data.indexOf(58, offset);
    if (colon < 0 || colon - offset > 12) throw new Error("invalid-flight-row");
    const id = decoder.decode(data.subarray(offset, colon));
    if (!/^[0-9a-f]+$/u.test(id)) throw new Error("invalid-flight-id");
    offset = colon + 1;
    if (data[offset] === 84) {
      const comma = data.indexOf(44, offset);
      if (comma < 0 || comma - offset > 10)
        throw new Error("invalid-flight-text");
      const length = Number.parseInt(
        decoder.decode(data.subarray(offset + 1, comma)),
        16,
      );
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        comma + 1 + length > data.length
      )
        throw new Error("invalid-flight-text");
      rows.set(
        id,
        decoder.decode(data.subarray(comma + 1, comma + 1 + length)),
      );
      offset = comma + 1 + length;
      if (data[offset] === 10) offset += 1;
    } else {
      const next = data.indexOf(10, offset);
      const end = next < 0 ? data.length : next;
      const content = decoder.decode(data.subarray(offset, end));
      offset = end + 1;
      try {
        rows.set(id, JSON.parse(content) as unknown);
      } catch {
        rows.set(id, null);
      }
    }
    if (rows.size > 20_000) throw new Error("flight-row-limit");
  }
  return rows;
}
export function flightObjects(
  rows: ReadonlyMap<string, unknown>,
): readonly Readonly<Record<string, unknown>>[] {
  const found: Readonly<Record<string, unknown>>[] = [];
  const visited = new Set<unknown>();
  let count = 0;
  function resolve(value: unknown, depth: number): unknown {
    if (depth > 100 || ++count > 100_000) throw new Error("flight-graph-limit");
    if (typeof value === "string") {
      if (value.startsWith("$$")) return value.slice(1);
      const match = /^\$(?:@)?([a-f0-9]+)$/u.exec(value);
      return match && rows.has(match[1]!)
        ? resolve(rows.get(match[1]!), depth + 1)
        : value;
    }
    if (!value || typeof value !== "object") return value;
    if (visited.has(value)) return null;
    visited.add(value);
    if (Array.isArray(value))
      return value.map((entry) => resolve(entry, depth + 1));
    const record = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolve(entry, depth + 1),
      ]),
    );
    found.push(record);
    return record;
  }
  for (const value of rows.values()) resolve(value, 0);
  return found;
}
export function flightActionState(
  source: string,
): FlightActionState | undefined {
  for (const object of flightObjects(decodeFlightRows(source))) {
    if (
      !["SUCCESS", "ERROR", "UNSET"].includes(String(object["status"])) ||
      typeof object["message"] !== "string" ||
      !object["fieldErrors"] ||
      typeof object["fieldErrors"] !== "object" ||
      Array.isArray(object["fieldErrors"])
    )
      continue;
    const errors = object["fieldErrors"] as Record<string, unknown>;
    if (
      Object.values(errors).every(
        (value) =>
          Array.isArray(value) &&
          value.every((entry) => typeof entry === "string"),
      )
    )
      return object as unknown as FlightActionState;
  }
  return undefined;
}
