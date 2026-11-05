// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: LicenseRef-Proprietary
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns: Verify the independent, packaged protocol-kernel public API.
// - Must-Not: Import the Blooket browser or desktop app.

import assert from "node:assert/strict";
import test from "node:test";
import { compileDependencyGraph, verifyFiniteStateProtocol } from
  "@blooket-api/repository/protocol-kernel";

test("domain-agnostic protocol kernel can validate non-Blooket workflows", () => {
  const graph = compileDependencyGraph([
    { id: "settle", requires: ["authorize"] },
    { id: "authorize", requires: ["accept"] },
    { id: "accept", requires: [] },
  ]);
  assert.deepEqual(graph, { ok: true,
    ordered: ["accept", "authorize", "settle"],
    stages: [["accept"], ["authorize"], ["settle"]] });
  const protocol = verifyFiniteStateProtocol({
    initial: "new",
    key: state => state,
    next: state => state === "new" ? [{ label: "accept", to: "accepted" }]
      : state === "accepted" ? [{ label: "settle", to: "settled" }] : [],
    invariant: state => state === "settled" ? null : null,
    terminal: state => state === "settled",
    maxStates: 5,
    maxTransitions: 5,
  });
  assert.equal(protocol.ok, true);
  assert.equal(protocol.reachedTerminal, true);
});
