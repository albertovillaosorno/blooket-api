// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: MIT
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns: Validate sequential execution as a dependency-constrained protocol.
// - Must-Not: Call a browser, persist progress, or reorder user-visible writes.
// - Allows: Compile immutable operation identities through the shared DAG core.

import { compileDependencyGraph, type DependencyGraphResult } from
  "../../../ir/protocol-kernel/domain/dependency-graph.ts";
import type { BlooketWritePlan } from "./write-plan.ts";

/**
 * Refuse duplicate/invalid/oversized operation identities before dispatch.
 * Every operation requires its immediate predecessor; the shared DAG compiler
 * checks the entire dependency relation. Execution remains strictly sequential
 * because the browser-backed commit protocol supports one in-flight write.
 */
export function compileSequentialWriteProtocol(
  plan: BlooketWritePlan,
): DependencyGraphResult {
  const graph = compileDependencyGraph(plan.operations.map((operation, index) => ({
    id: operation.operationId,
    requires: index === 0 ? [] : [plan.operations[index - 1]!.operationId],
  })));
  if (!graph.ok) return graph;
  if (graph.stages.some(stage => stage.length !== 1) ||
      graph.ordered.some((id, index) =>
        id !== plan.operations[index]?.operationId))
    return { ok: false, code: "invalid-node", nodes: [] };
  return graph;
}
