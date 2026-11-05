// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: LicenseRef-Proprietary
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns: Deterministic compilation and validation of dependency DAGs.
// - Must-Not: Perform I/O, mutate input, or use wall-clock ordering.
// - Allows: Canonical node IDs, explicit prerequisites, and bounded graph search.
// - Split-When: Cyclic scheduling acquires separately defined semantics.
// - Merge-When: Another kernel owns this exact dependency DAG contract.

/** A dependency-aware operation, independent of the domain executing it. */
export interface DependencyNode {
  readonly id: string;
  readonly requires: readonly string[];
}

export type DependencyGraphResult =
  | { readonly ok: true;
      /** Stable lexically ordered strata of mutually independent nodes. */
      readonly stages: readonly (readonly string[])[];
      readonly ordered: readonly string[] }
  | { readonly ok: false;
      readonly code: "invalid-node" | "duplicate-node" | "missing-node"
        | "cycle" | "graph-limit";
      readonly nodes: readonly string[] };

/**
 * Kahn compilation with stable lexical tie-breaking, explicit graph limits,
 * and duplicate-edge elimination. A rejected plan has no execution schedule.
 * Runs in O(V log V + E + E log E) for bounded graphs; never recurses.
 */
export function compileDependencyGraph(
  nodes: readonly DependencyNode[],
  maximumNodes = 4096,
): DependencyGraphResult {
  if (!Number.isSafeInteger(maximumNodes) || maximumNodes < 1 ||
      nodes.length > maximumNodes)
    return { ok: false, code: "graph-limit", nodes: [] };
  const dependencies = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (typeof node.id !== "string" || node.id.trim() !== node.id ||
        node.id.length === 0 || node.id.length > 512 ||
        /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069]/u.test(node.id))
      return { ok: false, code: "invalid-node", nodes: [String(node.id)] };
    if (dependencies.has(node.id))
      return { ok: false, code: "duplicate-node", nodes: [node.id] };
    dependencies.set(node.id, new Set(node.requires));
  }
  const successors = new Map<string, Set<string>>();
  const degree = new Map<string, number>();
  for (const [id, requires] of dependencies) {
    degree.set(id, requires.size);
    for (const required of requires) {
      if (!dependencies.has(required))
        return { ok: false, code: "missing-node", nodes: [id, required] };
      const destinations = successors.get(required) ?? new Set<string>();
      destinations.add(id);
      successors.set(required, destinations);
    }
  }
  let ready = [...degree].filter(([, count]) => count === 0)
    .map(([id]) => id).sort();
  const stages: string[][] = [];
  const ordered: string[] = [];
  while (ready.length > 0) {
    stages.push(ready);
    ordered.push(...ready);
    const next: string[] = [];
    for (const id of ready) {
      for (const child of successors.get(id) ?? []) {
        const count = degree.get(child)! - 1;
        degree.set(child, count);
        if (count === 0) next.push(child);
      }
    }
    ready = next.sort();
  }
  if (ordered.length !== nodes.length) {
    const blocked = [...degree].filter(([, count]) => count > 0)
      .map(([id]) => id).sort();
    return { ok: false, code: "cycle", nodes: blocked };
  }
  return { ok: true, stages, ordered };
}
