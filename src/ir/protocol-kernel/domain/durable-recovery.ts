// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: MIT
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns: Durable transition ordering across opaque journal/storage adapters.
// - Must-Not: Infer remote success, access a filesystem, or grant lock authority.
// - Allows: Typed CAS/persist and idempotent journal finalization operations.
// - Split-When: Distributed commits require separate consensus semantics.
// - Merge-When: All persistence adapters guarantee a single atomic commit.

/** The caller's durable snapshot and explicit recovery decision. */
export type DurableRecoveryInstruction<State, Reason> =
  | { readonly kind: "ready"; readonly checkpoint: State }
  | { readonly kind: "hold"; readonly checkpoint: State;
      readonly reason: Reason }
  | { readonly kind: "commit"; readonly checkpoint: State;
      readonly next: State }
  | { readonly kind: "finalize"; readonly checkpoint: State }
  | { readonly kind: "commit-and-finalize";
      readonly checkpoint: State; readonly next: State };

/** A persistence result must be explicitly acknowledged by an adapter. */
export type DurableStepResult<Failure> =
  | { readonly ok: true }
  | { readonly ok: false; readonly cause: Failure };

/** Storage adapters must implement caller-owned locking/CAS and safe cleanup. */
export interface DurableRecoveryPorts<State, PersistFailure, FinalizeFailure> {
  /** Persist the next state durably; validate its expected original snapshot. */
  readonly persist: (before: State, after: State) =>
    Promise<DurableStepResult<PersistFailure>>;
  /** Idempotently remove only evidence for a durably committed operation. */
  readonly finalize?: (checkpoint: State) =>
    Promise<DurableStepResult<FinalizeFailure>>;
}

export type DurableRecoveryResult<State, Reason, PersistFailure,
  FinalizeFailure> =
  | { readonly ok: true; readonly kind: "ready" | "committed"
      | "finalized" | "recovered"; readonly checkpoint: State }
  | { readonly ok: true; readonly kind: "blocked";
      readonly reason: Reason; readonly checkpoint: State }
  | { readonly ok: false; readonly stage: "persist";
      readonly cause: PersistFailure }
  | { readonly ok: false; readonly stage: "finalize";
      readonly cause: FinalizeFailure; readonly checkpoint: State };

/**
 * Execute one authorized recovery transition, preserving crash-cut safety.
 *
 * `hold` never touches the adapters. `commit-and-finalize` MUST durably
 * persist the advanced state before discarding write-ahead evidence. A failed
 * persistence never calls finalize; a failed finalize preserves the advanced
 * state and yields an explicit cleanup failure. A caller must hold exclusive
 * local ownership (or the backend must supply CAS/fencing); this function
 * never assumes that an in-memory lock implies multi-process isolation.
 *
 * This primitive is used by both the journaled browser write executor and
 * the signed-update installation state machine, which supply different
 * persistence adapters and recovery decisions.
 */
export async function executeDurableRecovery<State, Reason, PersistFailure,
  FinalizeFailure>(
  instruction: DurableRecoveryInstruction<State, Reason>,
  ports: DurableRecoveryPorts<State, PersistFailure, FinalizeFailure>,
): Promise<DurableRecoveryResult<State, Reason, PersistFailure,
  FinalizeFailure>> {
  if (instruction.kind === "ready") {
    return { ok: true, kind: "ready", checkpoint: instruction.checkpoint };
  }
  if (instruction.kind === "hold") {
    return { ok: true, kind: "blocked",
      checkpoint: instruction.checkpoint, reason: instruction.reason };
  }
  const needsCommit = instruction.kind === "commit" ||
    instruction.kind === "commit-and-finalize";
  const checkpoint = needsCommit ? instruction.next : instruction.checkpoint;
  if (needsCommit) {
    const result = await ports.persist(instruction.checkpoint, checkpoint);
    if (!result.ok) {
      return { ok: false, stage: "persist", cause: result.cause };
    }
    if (instruction.kind === "commit") {
      return { ok: true, kind: "committed", checkpoint };
    }
  }
  if (!ports.finalize) {
    throw new Error("durable-recovery-finalize-port-required");
  }
  const finalized = await ports.finalize(checkpoint);
  if (!finalized.ok) {
    return { ok: false, stage: "finalize", cause: finalized.cause,
      checkpoint };
  }
  return { ok: true, kind: needsCommit ? "recovered" : "finalized",
    checkpoint };
}
