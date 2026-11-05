// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: LicenseRef-Proprietary
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns: Public side-effect-free graph/compiler and model-checker APIs.
// - Must-Not: Import the Blooket/browser domain or request credentials.
// - Allows: Dependency DAGs and bounded finite-state transaction protocols.

export { compileDependencyGraph } from
  "../ir/protocol-kernel/domain/dependency-graph.ts";
export type { DependencyGraphResult, DependencyNode } from
  "../ir/protocol-kernel/domain/dependency-graph.ts";
export { verifyFiniteStateProtocol } from
  "../ir/protocol-kernel/domain/model-checker.ts";
export type {
  FiniteStateProtocol,
  FiniteStateProtocolReport,
  ProtocolCounterexample,
  ProtocolTransition,
} from "../ir/protocol-kernel/domain/model-checker.ts";
