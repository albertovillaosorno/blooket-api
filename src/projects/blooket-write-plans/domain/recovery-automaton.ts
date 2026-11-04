// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: LicenseRef-Proprietary
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
 * Enumerate all modeled interruption cuts of a sequential write plan.
 *
 * The graph includes a lost response after dispatch ("attempting"), an
 * external confirmation, a durable checkpoint save, and journal cleanup.
 * An externally verified negative resolution loops back to ready. All
 * reachable states are checked against the *same* recovery classifier used
 * by production. No branch assumes that ambiguity means remote failure.
 *
 * The state count is O(operations), rather than enumerating remote content;
 * an operation cap prevents a hostile plan from exhausting local analysis.
 */
export function analyzeWriteRecoveryProtocol(
  plan: BlooketWritePlan,
): WriteRecoveryProtocolReport {
  const violations: string[] = [];
  if (plan.operations.length > 4096 || plan.operations.length === 0) {
    return { ok: false, exploredStates: 0, exploredTransitions: 0,
      reachedTerminal: false, violations: ["unsupported-operation-count"] };
  }
  const operationIds = new Set<string>();
  for (const operation of plan.operations) {
    if (operationIds.has(operation.operationId)) {
      return { ok: false, exploredStates: 0, exploredTransitions: 0,
        reachedTerminal: false,
        violations: ["duplicate-operation-id:" + operation.operationId] };
    }
    operationIds.add(operation.operationId);
  }
  // Construct each exact checkpoint with the production checkpoint reducer.
  // A fixed *symbolic* receipt stands only for a valid set-binding witness.
  const checkpoints: BlooketWriteCheckpoint[] = [
    initialBlooketWriteCheckpoint(plan),
  ];
  for (const operation of plan.operations) {
    const previous = checkpoints.at(-1);
    if (!previous) break;
    const receipt = operation.kind === "set"
      ? { kind: "set-created" as const, remoteSetId: "protocol-witness" }
      : null;
    const result = advanceBlooketWriteCheckpoint(
      plan, previous, operation.operationId, receipt,
    );
    if (!result.ok) {
      violations.push("unreachable-plan-operation:" + operation.operationId);
      break;
    }
    checkpoints.push(result.value);
  }
  if (violations.length > 0) {
    return { ok: false, exploredStates: 0, exploredTransitions: 0,
      reachedTerminal: false, violations };
  }

  const first: WriteRecoveryProtocolState = {
    nextOperationIndex: 0, phase: "ready",
  };
  const queue = [first];
  const seen = new Set([key(first)]);
  let transitions = 0;
  let terminal = false;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    if (!state) break;
    const index = state.nextOperationIndex;
    const operation = plan.operations[index];
    const checkpoint = checkpoints[index];
    if (!checkpoint) {
      violations.push("missing-checkpoint:" + index);
      continue;
    }
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
      plan,
      state.phase === "checkpointed" ? checkpoints[index + 1]! : checkpoint,
      state.phase === "ready" ? null : attempt,
    );
    const expected = {
      ready: "ready",
      attempting: "reconcile",
      confirmed: "persist-confirmed",
      checkpointed: "clear-confirmed",
    }[state.phase];
    if (decision.action !== expected) {
      violations.push("wrong-decision:" + key(state));
    } else if (state.phase === "attempting" &&
        (decision.action !== "reconcile" ||
         decision.reason !== "ambiguous-attempt")) {
      violations.push("unsafe-ambiguous-decision:" + key(state));
    } else if (state.phase === "confirmed" &&
        (decision.action !== "persist-confirmed" ||
         JSON.stringify(decision.checkpoint) !==
           JSON.stringify(checkpoints[index + 1]))) {
      violations.push("incorrect-confirmation:" + key(state));
    }
    if (index === plan.operations.length && state.phase === "ready") {
      terminal = true;
      continue;
    }
    const next: WriteRecoveryProtocolState[] = state.phase === "ready"
      ? [{ nextOperationIndex: index, phase: "attempting" }]
      : state.phase === "attempting"
        ? [
            { nextOperationIndex: index, phase: "confirmed" },
            { nextOperationIndex: index, phase: "ready" },
          ]
        : state.phase === "confirmed"
          ? [{ nextOperationIndex: index, phase: "checkpointed" }]
          : [{ nextOperationIndex: index + 1, phase: "ready" }];
    for (const successor of next) {
      transitions += 1;
      const identity = key(successor);
      if (!seen.has(identity)) {
        seen.add(identity);
        queue.push(successor);
      }
    }
  }
  return {
    ok: terminal && violations.length === 0,
    exploredStates: seen.size,
    exploredTransitions: transitions,
    reachedTerminal: terminal,
    violations,
  };
}

function key(state: WriteRecoveryProtocolState): string {
  return state.nextOperationIndex + ":" + state.phase;
}
