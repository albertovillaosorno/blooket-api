// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: MIT
// Public, side-effect-free planning/verification domain boundary.
// No browser, updater, desktop process, network transport, or secret loading.

export {
  BLOOKET_WRITE_PLAN_VERSION,
  buildBlooketAppendPlan,
  buildBlooketWritePlan,
  buildPreparedBlooketWritePlan,
  sameRemoteCreateSetMetadata,
} from "../projects/blooket-write-plans/domain/write-plan.ts";
export type {
  BlooketWritePlan,
  BlooketAppendTarget,
  BlooketAppendWritePlan,
  BlooketCreateWritePlan,
  BlooketReplaceWritePlan,
} from "../projects/blooket-write-plans/domain/write-plan.ts";
export { buildBlooketReplacementPlan } from
  "../projects/blooket-write-plans/domain/replacement-plan.ts";
export {
  BLOOKET_WRITE_VERIFICATION_BASELINE_VERSION,
  decodeBlooketWriteVerificationBaseline,
  sameBlooketWriteVerificationBaseline,
  frameBlooketWriteVerificationCollection,
} from "../projects/blooket-write-plans/domain/verification-baseline.ts";
export type {
  BlooketWriteVerificationBaseline,
  BlooketWriteVerificationBaselineKind,
} from "../projects/blooket-write-plans/domain/verification-baseline.ts";

export {
  analyzeWriteRecoveryProtocol,
  decideWriteRecovery,
} from "../projects/blooket-write-plans/domain/recovery-automaton.ts";
export type {
  WriteRecoveryAttempt,
  WriteRecoveryDecision,
  WriteRecoveryProtocolReport,
  WriteRecoveryProtocolState,
} from "../projects/blooket-write-plans/domain/recovery-automaton.ts";

// Domain-independent graph compilation and exhaustive transition verification.
export {
  compileDependencyGraph,
  verifyFiniteStateProtocol,
} from "./protocol-kernel.ts";
export type {
  DependencyGraphResult,
  DependencyNode,
  FiniteStateProtocol,
  FiniteStateProtocolReport,
  ProtocolCounterexample,
  ProtocolTransition,
} from "./protocol-kernel.ts";

export { compileSequentialWriteProtocol } from
  "../projects/blooket-write-plans/domain/plan-protocol.ts";
