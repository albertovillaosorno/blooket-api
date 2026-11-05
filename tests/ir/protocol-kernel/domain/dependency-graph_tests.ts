// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: LicenseRef-Proprietary
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns: Executable DAG compilation, determinism and adversarial graph cases.
// - Must-Not: Invoke Blooket, browser, network or persistence APIs.

import assert from "node:assert/strict";
import test from "node:test";
import { compileDependencyGraph } from
  "../../../../src/ir/protocol-kernel/domain/dependency-graph.ts";

test("diamond fan-out/fan-in scheduling is stable regardless of input order", () => {
  const nodes = [
    { id: "join", requires: ["branch-b", "branch-a"] },
    { id: "branch-b", requires: ["root"] },
    { id: "root", requires: [] },
    { id: "branch-a", requires: ["root", "root"] },
  ];
  const expected = {
    ok: true,
    stages: [["root"], ["branch-a", "branch-b"], ["join"]],
    ordered: ["root", "branch-a", "branch-b", "join"],
  };
  assert.deepEqual(compileDependencyGraph(nodes), expected);
  assert.deepEqual(compileDependencyGraph([...nodes].reverse()), expected);
});

test("duplicate node IDs, missing prerequisites and invalid identities fail closed", () => {
  assert.deepEqual(compileDependencyGraph([
    { id: "same", requires: [] }, { id: "same", requires: [] },
  ]), { ok: false, code: "duplicate-node", nodes: ["same"] });
  assert.deepEqual(compileDependencyGraph([
    { id: "child", requires: ["missing"] },
  ]), { ok: false, code: "missing-node", nodes: ["child", "missing"] });
  for (const id of ["", " leading", "trailing ", "\u0000", "x\u200b", "x".repeat(513)]) {
    assert.deepEqual(compileDependencyGraph([{ id, requires: [] }]), {
      ok: false, code: "invalid-node", nodes: [id],
    });
  }
});

test("cycles and self-dependencies fail with inspectable blocked nodes", () => {
  assert.deepEqual(compileDependencyGraph([
    { id: "a", requires: ["b"] }, { id: "b", requires: ["a"] },
  ]), { ok: false, code: "cycle", nodes: ["a", "b"] });
  assert.deepEqual(compileDependencyGraph([
    { id: "self", requires: ["self"] },
  ]), { ok: false, code: "cycle", nodes: ["self"] });
});

test("thousands of ordered dependencies compile without recursion", () => {
  const nodes = Array.from({ length: 2048 }, (_, index) => ({
    id: "node-" + String(index),
    requires: index === 0 ? [] : ["node-" + String(index - 1)],
  }));
  const result = compileDependencyGraph(nodes);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stages.length, nodes.length);
  assert.deepEqual(result.ordered, nodes.map(node => node.id));
});

test("budget controls cannot be bypassed with a malformed threshold", () => {
  const nodes = [{ id: "a", requires: [] }, { id: "b", requires: [] }];
  for (const budget of [-1, 0, 1, 1.5, Infinity, NaN]) {
    assert.deepEqual(compileDependencyGraph(nodes, budget), {
      ok: false, code: "graph-limit", nodes: [],
    });
  }
  assert.deepEqual(compileDependencyGraph([], 1), {
    ok: true, stages: [], ordered: [],
  });
});
