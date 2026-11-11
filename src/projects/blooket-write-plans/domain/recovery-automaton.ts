// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: MIT
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns:
//   - Pure write-ahead recovery transition decisions and bounded crash-cut
//     state exploration for deterministic sequential mutation plans.
// - Must-Not:
//   - Read files, execute requests, authenticate provider receipts, or infer
//     whether an unconfirmed remote operation actually took effect.
// - Allows:
//   - Inputs: Validated plans, checkpoints and durable journal summaries.
//   - Outputs: One safe recovery action or explicit reconciliation requirement.
//   - Side effects: None; callers persist under their own durable lock.
// - Split-When:
//   - Parallel writes need independent causal and vector-clock semantics.
// - Merge-When:
//   - The sequenced plan protocol no longer persists an attempt journal.
// - Summary:
//   - Models crash windows of a journaled mutation as a finite transition
//     system and reuses its safe decisions in the real recovery executor.
//
import { compileSequentialWriteProtocol } from "./plan-protocol.ts";
// jig-ignore-next-line: TypeScript module specifier is indivisible.
import { verifyFiniteStateProtocol } from "../../../ir/protocol-kernel/domain/model-checker.ts";

import {
  advanceBlooketWriteCheckpoint,
  initialBlooketWriteCheckpoint,
  type BlooketWriteCheckpoint,
  type BlooketWriteReceipt,
} from "./checkpoint.ts";
import type { BlooketWritePlan } from "./write-plan.ts";

/** A pure projection of an already decoded durable write-ahead record. */
export interface WriteRecoveryAttempt {
  readonly planId: string;
  readonly operationId: string;
  readonly operationIndex: number;
  readonly phase: "attempting" | "confirmed";
  readonly receipt: BlooketWriteReceipt | null;
}

/** Recovery *intent*, not permission to execute another remote mutation. */
export type WriteRecoveryDecision =
  | { readonly action: "ready" }
  | { readonly action: "reconcile";
      readonly reason: "ambiguous-attempt" | "inconsistent-attempt-state" }
  | { readonly action: "persist-confirmed";
      readonly checkpoint: BlooketWriteCheckpoint }
  | { readonly action: "clear-confirmed" };

/** Decide a crash-safe action without touching disk or the remote provider. */
export function decideWriteRecovery(
  plan: BlooketWritePlan,
  checkpoint: BlooketWriteCheckpoint,
  attempt: WriteRecoveryAttempt | null,
): WriteRecoveryDecision {
  const inconsistent = {
    action: "reconcile",
    reason: "inconsistent-attempt-state",
  } as const;
  if (checkpoint.planId !== plan.planId ||
    !Number.isSafeInteger(checkpoint.nextOperationIndex) ||
    checkpoint.nextOperationIndex < 0 ||
    checkpoint.nextOperationIndex > plan.operations.length) return inconsistent;
  if (attempt === null) return { action: "ready" };
  if (attempt.planId !== plan.planId ||
    !Number.isSafeInteger(attempt.operationIndex) ||
    attempt.operationIndex < 0 ||
    plan.operations[attempt.operationIndex]?.operationId !== attempt.operationId)
    return inconsistent;

  if (attempt.phase === "attempting") {
    return checkpoint.nextOperationIndex === attempt.operationIndex
      ? { action: "reconcile", reason: "ambiguous-attempt" }
      : inconsistent;
  }
  if (attempt.phase !== "confirmed") return inconsistent;
  if (checkpoint.nextOperationIndex === attempt.operationIndex) {
    const advanced = advanceBlooketWriteCheckpoint(
      plan, checkpoint, attempt.operationId, attempt.receipt,
    );
    return advanced.ok
      ? { action: "persist-confirmed", checkpoint: advanced.value }
      : inconsistent;
  }
  if (checkpoint.nextOperationIndex !== attempt.operationIndex + 1)
    return inconsistent;
  const operation = plan.operations[attempt.operationIndex];
  if (operation === undefined) return inconsistent;
  if (operation.kind === "set") {
    if (attempt.receipt === null ||
      attempt.receipt.remoteSetId !== checkpoint.remoteSetId)
      return inconsistent;
  } else if (attempt.receipt !== null || checkpoint.remoteSetId === null) {
    return inconsistent;
  }
  return { action: "clear-confirmed" };
}

/** One reachable crash-cut state of the modeled sequential protocol. */
export interface WriteRecoveryProtocolState {
  readonly nextOperationIndex: number;
  readonly phase: "ready" | "attempting" | "confirmed" | "checkpointed";
}

/** Bounded structural verification, not a proof of real provider behavior. */
export interface WriteRecoveryProtocolReport {
  readonly ok: boolean;
  readonly exploredStates: number;
  readonly exploredTransitions: number;
  readonly reachedTerminal: boolean;
  readonly violations: readonly string[];
}

/**
 * Verify every modeled interruption cut using the shared finite-state engine.
 *
 * The protocol compiler first validates the real operation dependency DAG;
 * the verifier then checks all reachable crash cuts using the exact recovery
 * classifier that handles durable production write-attempt journals. A caller
 * cannot interpret budget exhaustion as a successful verification.
 */
export function analyzeWriteRecoveryProtocol(
  plan: BlooketWritePlan,
): WriteRecoveryProtocolReport {
  const failures = (violations: string[]): WriteRecoveryProtocolReport => ({
    ok: false, exploredStates: 0, exploredTransitions: 0,
    reachedTerminal: false, violations,
  });
  if (plan.operations.length > 4096 || plan.operations.length === 0)
    return failures(["unsupported-operation-count"]);
  const graph = compileSequentialWriteProtocol(plan);
  if (!graph.ok) {
    if (graph.code === "duplicate-node")
      return failures(["duplicate-operation-id:" + graph.nodes[0]]);
    return failures(["invalid-operation-graph:" + graph.code]);
  }
  // Sequential journal semantics require every planned operation to be a
  // distinct topological stratum, even though the graph engine supports DAGs.
  if (graph.stages.length !== plan.operations.length ||
      graph.ordered.some((id, index) =>
        id !== plan.operations[index]?.operationId))
    return failures(["invalid-operation-order"]);

  const checkpoints: BlooketWriteCheckpoint[] = [
    initialBlooketWriteCheckpoint(plan),
  ];
  for (const operation of plan.operations) {
    const previous = checkpoints.at(-1);
    if (!previous) return failures(["missing-initial-checkpoint"]);
    const receipt = operation.kind === "set"
      ? { kind: "set-created" as const, remoteSetId: "protocol-witness" }
      : null;
    const result = advanceBlooketWriteCheckpoint(
      plan, previous, operation.operationId, receipt,
    );
    if (!result.ok)
      return failures(["unreachable-plan-operation:" + operation.operationId]);
    checkpoints.push(result.value);
  }

  const result = verifyFiniteStateProtocol<WriteRecoveryProtocolState>({
    initial: { nextOperationIndex: 0, phase: "ready" },
    key,
    maxStates: 4 * plan.operations.length + 1,
    maxTransitions: 5 * plan.operations.length,
    terminal: state => state.nextOperationIndex === plan.operations.length &&
      state.phase === "ready",
    invariant: state => {
      const index = state.nextOperationIndex;
      const operation = plan.operations[index];
      const checkpoint = checkpoints[
        state.phase === "checkpointed" ? index + 1 : index
      ];
      if (!checkpoint) return "missing-checkpoint:" + index;
      const receipt = operation?.kind === "set"
        ? { kind: "set-created" as const, remoteSetId: "protocol-witness" }
        : null;
      const attempt = operation === undefined ? null : {
        planId: plan.planId,
        operationId: operation.operationId,
        operationIndex: index,
        phase: state.phase === "attempting" ? "attempting" as const
          : "confirmed" as const,
        receipt: state.phase === "attempting" ? null : receipt,
      };
      const decision = decideWriteRecovery(
        plan, checkpoint, state.phase === "ready" ? null : attempt,
      );
      const expected = {
        ready: "ready",
        attempting: "reconcile",
        confirmed: "persist-confirmed",
        checkpointed: "clear-confirmed",
      }[state.phase];
      if (decision.action !== expected)
        return "wrong-decision:" + key(state);
      if (state.phase === "attempting" &&
          (decision.action !== "reconcile" ||
           decision.reason !== "ambiguous-attempt"))
        return "unsafe-ambiguous-decision:" + key(state);
      if (state.phase === "confirmed" &&
          (decision.action !== "persist-confirmed" ||
           JSON.stringify(decision.checkpoint) !==
             JSON.stringify(checkpoints[index + 1])))
        return "incorrect-confirmation:" + key(state);
      return null;
    },
    next: state => {
      const index = state.nextOperationIndex;
      if (index === plan.operations.length && state.phase === "ready")
        return [];
      const successor = (phase: WriteRecoveryProtocolState["phase"],
        nextOperationIndex = index) => ({
        label: state.phase + "->" + phase,
        to: { nextOperationIndex, phase },
      });
      if (state.phase === "ready") return [successor("attempting")];
      if (state.phase === "attempting")
        return [successor("confirmed"), successor("ready")];
      if (state.phase === "confirmed") return [successor("checkpointed")];
      return [successor("ready", index + 1)];
    },
  });
  return {
    ok: result.ok,
    exploredStates: result.exploredStates,
    exploredTransitions: result.exploredTransitions,
    reachedTerminal: result.reachedTerminal,
    violations: result.violations.map(violation => violation.reason),
  };
}

function key(state: WriteRecoveryProtocolState): string {
  return state.nextOperationIndex + ":" + state.phase;
}
