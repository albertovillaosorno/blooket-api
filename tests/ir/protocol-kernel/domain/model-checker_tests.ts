// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: LicenseRef-Proprietary
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns: Minimal counterexamples, finite-state safety and budget proofs.
// - Must-Not: Use browser, provider, filesystem or Blooket-specific plans.

import assert from "node:assert/strict";
import test from "node:test";
import { verifyFiniteStateProtocol } from
  "../../../../src/ir/protocol-kernel/domain/model-checker.ts";

test("protocol verification finds all reachable states including cyclic edges", () => {
  const result = verifyFiniteStateProtocol({
    initial: 0,
    key: String,
    maxStates: 5,
    maxTransitions: 6,
    terminal: state => state === 3,
    invariant: () => null,
    next: state => state === 3 ? [] : [
      { label: "advance", to: state + 1 },
      { label: "repeat", to: state },
    ],
  });
  assert.deepEqual(result, {
    ok: true, exploredStates: 4, exploredTransitions: 6,
    reachedTerminal: true, violations: [],
  });
});

test("shortest safety counterexample includes the exact transition trace", () => {
  const result = verifyFiniteStateProtocol({
    initial: "start",
    key: value => value,
    maxStates: 16,
    maxTransitions: 16,
    terminal: value => value === "terminal",
    invariant: value => value === "bad" ? "unsafe-confirmation" : null,
    next: value => {
      switch (value) {
        case "start": return [
          { label: "slow", to: "one" },
          { label: "fast", to: "bad" },
        ];
        case "one": return [{ label: "continue", to: "two" }];
        case "two": return [{ label: "fault", to: "bad" }];
        case "bad": return [{ label: "reset", to: "terminal" }];
        default: return [];
      }
    },
  });
  assert.deepEqual(result.violations, [{
    state: "bad", trace: ["fast"], reason: "unsafe-confirmation",
  }]);
  assert.equal(result.reachedTerminal, true);
  assert.equal(result.ok, false);
});

test("missing terminal is a failed liveness check even if invariants hold", () => {
  const result = verifyFiniteStateProtocol({
    initial: "pending",
    key: state => state,
    maxStates: 5,
    maxTransitions: 5,
    terminal: state => state === "committed",
    invariant: () => null,
    next: state => [{ label: "retry", to: state }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [{
    state: "pending", trace: [], reason: "terminal-unreachable",
  }]);
});

test("state-budget and transition-budget exhaustion never masquerade as proof", () => {
  const protocol = {
    initial: 0,
    key: String,
    terminal: (value: number) => value === 100,
    invariant: () => null,
    next: (value: number) => [{ label: "next", to: value + 1 }],
  };
  const stateLimit = verifyFiniteStateProtocol({
    ...protocol, maxStates: 3, maxTransitions: 10,
  });
  assert.equal(stateLimit.ok, false);
  assert.deepEqual(stateLimit.violations[0], {
    state: "3", trace: ["next", "next", "next"], reason: "state-limit",
  });
  const transitionLimit = verifyFiniteStateProtocol({
    ...protocol, maxStates: 10, maxTransitions: 2,
  });
  assert.equal(transitionLimit.ok, false);
  assert.equal(transitionLimit.violations[0]?.reason, "transition-limit");
});

test("invalid bounds refuse an incomplete state exploration", () => {
  for (const maximum of [0, -2, 1.1, NaN, Infinity]) {
    const result = verifyFiniteStateProtocol({
      initial: 0,
      key: String,
      maxStates: maximum,
      maxTransitions: 2,
      terminal: () => true,
      invariant: () => null,
      next: () => [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.violations[0]?.reason, "invalid-budget");
    assert.equal(result.exploredStates, 0);
  }
});
