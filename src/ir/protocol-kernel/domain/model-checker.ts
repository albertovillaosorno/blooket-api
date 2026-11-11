// Copyright (c) 2026 Alberto Villa Osorno.
// SPDX-License-Identifier: MIT
// Confidential: true
// License-File: LICENSE
//
// Boundary-Contract:
// - Owns: Finite-state exhaustive BFS checking with shortest failure witnesses.
// - Must-Not: Send operations, access files, or infer external state from events.
// - Allows: Pure model transitions and invariants supplied by calling domains.
// - Split-When: Symbolic or probabilistic model checking requires a new core.
// - Merge-When: Another pure engine owns the same finite transition semantics.

/** An explicitly labeled state transition in a finite protocol. */
export interface ProtocolTransition<State> {
  readonly label: string;
  readonly to: State;
}

/** The model owner defines the key, transition relation and safety properties. */
export interface FiniteStateProtocol<State> {
  readonly initial: State;
  readonly key: (state: State) => string;
  readonly next: (state: State) => readonly ProtocolTransition<State>[];
  readonly invariant: (state: State) => string | null;
  readonly terminal: (state: State) => boolean;
  /** Total states retained in memory. Prevents unbounded accidental searches. */
  readonly maxStates: number;
  readonly maxTransitions: number;
}

export interface ProtocolCounterexample {
  readonly state: string;
  /** Shortest transition-label trace from the initial state to this failure. */
  readonly trace: readonly string[];
  readonly reason: string;
}

export interface FiniteStateProtocolReport {
  readonly ok: boolean;
  readonly exploredStates: number;
  readonly exploredTransitions: number;
  readonly reachedTerminal: boolean;
  readonly violations: readonly ProtocolCounterexample[];
}

/**
 * Exhaustively visit a reachable finite transition graph in BFS order.
 *
 * Record parent pointers only once so witnesses are minimal in edge count.
 * Every reachable state is checked, including cyclic/self-loop transitions.
 * Violation reporting is deterministic for deterministic callers. Failure
 * due to state/edge budgets is explicit, never mistaken for a proof.
 */
export function verifyFiniteStateProtocol<State>(
  protocol: FiniteStateProtocol<State>,
): FiniteStateProtocolReport {
  const violations: ProtocolCounterexample[] = [];
  if (!Number.isSafeInteger(protocol.maxStates) ||
      !Number.isSafeInteger(protocol.maxTransitions) ||
      protocol.maxStates < 1 || protocol.maxTransitions < 1)
    return { ok: false, exploredStates: 0, exploredTransitions: 0,
      reachedTerminal: false,
      violations: [{ state: "", trace: [], reason: "invalid-budget" }] };
  const start = protocol.key(protocol.initial);
  const queue = [protocol.initial];
  const parents = new Map<string, { readonly prior: string;
    readonly via: string } | null>([[start, null]]);
  let transitions = 0;
  let reachedTerminal = false;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor]!;
    const stateId = protocol.key(state);
    const violation = protocol.invariant(state);
    if (violation !== null) {
      violations.push({ state: stateId,
        trace: witness(stateId, parents), reason: violation });
    }
    if (protocol.terminal(state)) reachedTerminal = true;
    for (const edge of protocol.next(state)) {
      transitions += 1;
      if (transitions > protocol.maxTransitions)
        return { ok: false, exploredStates: parents.size,
          exploredTransitions: transitions, reachedTerminal,
          violations: [...violations, { state: stateId,
            trace: witness(stateId, parents), reason: "transition-limit" }] };
      const destination = protocol.key(edge.to);
      if (parents.has(destination)) continue;
      if (parents.size >= protocol.maxStates)
        return { ok: false, exploredStates: parents.size,
          exploredTransitions: transitions, reachedTerminal,
          violations: [...violations, { state: destination,
            trace: [...witness(stateId, parents), edge.label],
            reason: "state-limit" }] };
      parents.set(destination, { prior: stateId, via: edge.label });
      queue.push(edge.to);
    }
  }
  if (!reachedTerminal)
    violations.push({ state: start, trace: [], reason: "terminal-unreachable" });
  return { ok: violations.length === 0, exploredStates: parents.size,
    exploredTransitions: transitions, reachedTerminal, violations };
}

function witness(
  state: string,
  parents: ReadonlyMap<string,
    { readonly prior: string; readonly via: string } | null>,
): readonly string[] {
  const result: string[] = [];
  let node = state;
  for (let step = 0; step < parents.size; step += 1) {
    const record = parents.get(node);
    if (!record) break;
    result.push(record.via);
    node = record.prior;
  }
  return result.reverse();
}
