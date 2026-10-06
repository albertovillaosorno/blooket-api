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
//   - Exact runtime payload decoding for admitted teacher commands.
// - Must-Not:
//   - Read files, execute commands, or accept arbitrary paths.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Exact runtime payload decoding for admitted teacher commands.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { isRecord } from "../../runtime-decoding/domain/exact-object.ts";

export const LIBRARY_COMMANDS = [
  "profile.get",
  "library.list",
  "library.search",
  "library.get",
  "library.enrich",
  "skills.list",
  "skills.get",
  "skills.put",
  "drafts.list",
  "drafts.get",
  "drafts.put",
] as const;
export type LibraryCommandName = (typeof LIBRARY_COMMANDS)[number];
export type LibraryPayload =
  | { readonly kind: "profile" }
  | { readonly kind: "list"; readonly query: string }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly limit: number;
      readonly after: string | null;
    }
  | { readonly kind: "get"; readonly id: string }
  | {
      readonly kind: "enrich";
      readonly id: string;
      readonly revision: number;
      readonly name: string;
      readonly description: string;
      readonly topics: readonly string[];
    }
  | {
      readonly kind: "skill-put";
      readonly id: string;
      readonly text: string;
      readonly expectedRevision: string | null;
    }
  | {
      readonly kind: "draft-put";
      readonly id: string;
      readonly document: unknown;
      readonly expectedRevision: string | null;
    };
export function decodeLibraryCommand(
  name: LibraryCommandName,
  value: unknown,
): LibraryPayload {
  if (!isRecord(value)) throw new Error("invalid-command-payload");
  if (name === "profile.get") {
    keys(value, []);
    return { kind: "profile" };
  }
  if (name === "library.search") {
    keys(value, [
      "query",
      ...("limit" in value ? ["limit"] : []),
      ...("after" in value ? ["after"] : []),
    ]);
    const limit = "limit" in value ? value["limit"] : 50;
    const after = "after" in value ? value["after"] : null;
    if (
      !string(value["query"], 500) ||
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (after !== null && !logicalId(after))
    )
      throw new Error("invalid-search");
    return { kind: "search", query: value["query"], limit, after };
  }
  if (name.endsWith(".list")) {
    keys(value, name === "library.list" ? ["query"] : []);
    if (name === "library.list" && !string(value["query"], 500))
      throw new Error("invalid-search");
    return {
      kind: "list",
      query: name === "library.list" ? (value["query"] as string) : "",
    };
  }
  if (!logicalId(value["id"])) throw new Error("invalid-logical-id");
  const id = value["id"];
  if (name.endsWith(".get")) {
    keys(value, ["id"]);
    return { kind: "get", id };
  }
  if (name === "library.enrich") {
    keys(value, ["id", "revision", "name", "description", "topics"]);
    if (
      !Number.isSafeInteger(value["revision"]) ||
      Number(value["revision"]) < 1 ||
      !string(value["name"], 200) ||
      !string(value["description"], 10_000) ||
      !Array.isArray(value["topics"]) ||
      value["topics"].length > 50 ||
      !value["topics"].every((item) => string(item, 100))
    )
      throw new Error("invalid-enrichment");
    return {
      kind: "enrich",
      id,
      revision: value["revision"] as number,
      name: value["name"],
      description: value["description"],
      topics: value["topics"] as string[],
    };
  }
  const expectedRevision = value["expectedRevision"];
  if (
    expectedRevision !== null &&
    (!string(expectedRevision, 64) || !/^[a-f0-9]{64}$/u.test(expectedRevision))
  )
    throw new Error("invalid-revision");
  if (name === "skills.put") {
    keys(value, ["id", "text", "expectedRevision"]);
    if (!string(value["text"], 64_000) || !value["text"].trim())
      throw new Error("invalid-skill-text");
    return { kind: "skill-put", id, text: value["text"], expectedRevision };
  }
  keys(value, ["id", "document", "expectedRevision"]);
  return {
    kind: "draft-put",
    id,
    document: value["document"],
    expectedRevision,
  };
}
function logicalId(value: unknown): value is string {
  return (
    string(value, 128) && /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}$/u.test(value)
  );
}
function keys(
  record: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (
    Object.keys(record).length !== allowed.length ||
    allowed.some((key) => !(key in record))
  )
    throw new Error("unknown-or-missing-field");
}
function string(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" && value.length <= limit && !value.includes("\0")
  );
}
