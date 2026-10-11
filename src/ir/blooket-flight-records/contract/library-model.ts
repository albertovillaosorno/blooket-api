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
//   - Bounded decoding of the observed My Sets server-rendered model.
// - Must-Not:
//   - Infer collection completeness, execute scripts, or expose other props.
// - Allows:
//   - Inputs: One bounded Flight document and its observed provider build.
//   - Outputs: Normalized allSets and displayed-set identity candidates.
//   - Side effects: None.
// - Split-When:
//   - Another build requires independent model admission evidence.
// - Merge-When:
//   - The provider exposes an equivalent stable library read contract.
// - Summary:
//   - Reads only the exact observed unfiltered library component model.
// - Description:
//   - The allSets property is evidence, not a server completeness guarantee.
// - Usage:
//   - Compare candidates inside the authenticated extension boundary.
// - Defaults:
//   - Changed builds, ambiguous components, and malformed references fail.
//
import { decodeFlightPageRows } from "./flight.ts";

export const BLOOKET_LIBRARY_MODEL_BUILD =
  "349b82c80fc4a5a2001e609136cfed32747ba3f4";
const MODULE_CHUNK = "static/chunks/1958-3beff819112074ac.js";
const PROP_KEYS = [
  "allSets", "filter", "folders", "hasFolderOrSearch", "hasPlus",
  "isMerging", "isStudent", "numQuestions", "numSets", "query",
  "sets", "setsFolder", "type",
].sort().join();
const SET_KEYS = [
  "_id", "author", "coverImage", "date", "favoriteCount", "numQuestions",
  "playCount", "plusOnly", "private", "title", "verified",
].sort().join();

export interface BlooketLibraryModelCandidate {
  readonly allSets: readonly { readonly id: string; readonly title: string }[];
  readonly displayedSets:
    readonly { readonly id: string; readonly title: string }[];
}

export function decodeBlooketLibraryModel(
  source: string,
  build: string,
): BlooketLibraryModelCandidate | undefined {
  if (build !== BLOOKET_LIBRARY_MODEL_BUILD) return undefined;
  try {
    const { models, modules } = decodeFlightPageRows(source);
    let values = 0;
    const candidates: Record<string, unknown>[] = [];
    function inspect(value: unknown, depth: number): void {
      if (++values > 100_000 || depth > 100)
        throw new Error("library-model-limit");
      if (Array.isArray(value)) {
        if (value.length === 4 && value[0] === "$" &&
            typeof value[1] === "string" && value[2] === null) {
          const moduleId = /^\$L([a-f0-9]+)$/u.exec(value[1])?.[1];
          if (moduleId && admittedModule(modules.get(moduleId))) {
            const props = value[3];
            if (!record(props) || Object.keys(props).sort().join() !==
                PROP_KEYS) throw new Error("invalid-library-props");
            candidates.push(props);
          }
        }
        for (const child of value) inspect(child, depth + 1);
      } else if (record(value)) {
        for (const child of Object.values(value)) inspect(child, depth + 1);
      }
    }
    for (const model of models.values()) inspect(model, 0);
    if (candidates.length !== 1) return undefined;
    const props = candidates[0]!;
    if (props["type"] !== "LIBRARY" || props["isMerging"] !== false ||
        props["hasFolderOrSearch"] !== false ||
        !["query", "filter", "setsFolder"].every(
          key => props[key] === "$undefined",
        ) || !Array.isArray(props["folders"]) ||
        props["folders"].length !== 0 ||
        typeof props["hasPlus"] !== "boolean" ||
        typeof props["isStudent"] !== "boolean" ||
        !["numSets", "numQuestions"].every(key => {
          const value = props[key];
          // Module 52644 falls back to zero for absent count props. Flight
          // serializes undefined as a tagged value, not JSON undefined.
          return value === null || value === "$undefined" ||
            (typeof value === "number" && Number.isSafeInteger(value) &&
              value >= 0);
        }))
      return undefined;

    function resolve(value: unknown, visited = new Set<string>()): unknown {
      if (typeof value !== "string") return value;
      if (value.startsWith("$$")) return value.slice(1);
      const id = /^\$([a-f0-9]+)$/u.exec(value)?.[1];
      if (!id) {
        if (value.startsWith("$"))
          throw new Error("unsupported-library-reference");
        return value;
      }
      if (visited.size >= 100 || visited.has(id) || !models.has(id) ||
          models.get(id) === undefined)
        throw new Error("invalid-library-reference");
      visited.add(id);
      return resolve(models.get(id), visited);
    }

    function summaries(value: unknown) {
      const list = resolve(value);
      if (!Array.isArray(list) || list.length > 200)
        throw new Error("invalid-library-list");
      const ids = new Set<string>();
      return list.map(item => {
        const set = resolve(item);
        if (!record(set) || Object.keys(set).sort().join() !== SET_KEYS)
          throw new Error("invalid-library-set");
        const id = resolve(set["_id"]);
        const title = resolve(set["title"]);
        if (typeof id !== "string" || id.length < 1 || id.length > 8_192 ||
            typeof title !== "string" || title.trim().length < 1 ||
            title.length > 1_000 || ids.has(id))
          throw new Error("invalid-library-identity");
        ids.add(id);
        return { id, title };
      });
    }
    return {
      allSets: summaries(props["allSets"]),
      displayedSets: summaries(props["sets"]),
    };
  } catch {
    return undefined;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value);
}

function admittedModule(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 3 || value[0] !== 52644 ||
      value[2] !== "default" || !Array.isArray(value[1]) ||
      value[1].length > 200 || value[1].length % 2 !== 0)
    return false;
  let matched = false;
  const seen = new Set<string>();
  for (let index = 0; index < value[1].length; index += 2) {
    const id = value[1][index];
    const chunk = value[1][index + 1];
    if (typeof id !== "string" || !/^[0-9]+$/u.test(id) ||
        seen.has(id) || typeof chunk !== "string" ||
        chunk.length > 4_096 ||
        !chunk.startsWith("static/chunks/")) return false;
    seen.add(id);
    if (id === "1958" && chunk === MODULE_CHUNK) matched = true;
  }
  return matched;
}
