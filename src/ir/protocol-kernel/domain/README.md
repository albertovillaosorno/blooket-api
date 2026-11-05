# Finite protocol kernel

This module implements two reusable, side-effect-free algorithms independent of
Blooket and the desktop application. `dependency-graph.ts` compiles bounded
prerequisite DAGs into deterministic topological stages, detects duplicate
nodes, unknown dependencies, and cycles. `model-checker.ts` performs exhaustive
BFS exploration over a caller-defined finite transition system, tests safety
invariants on each reachable state, verifies terminal reachability, and reports
shortest failure witness traces. Hard state and transition budgets prevent
unbounded searches from being reported as successful.

Production integration: `projects/blooket-write-plans/domain/recovery-automaton.ts`
uses this general-purpose engine to verify every journal interruption cut
against the **same** `decideWriteRecovery` function called by the actual
persisted write execution. Neither verifier grants external commit authority.

Direct tests: `tests/ir/protocol-kernel/domain/`. The headless SDK also exports
the algorithms for other offline transaction and deployment protocols.

`durable-recovery.ts` is the third domain-independent runtime primitive:
caller-supplied storage adapters commit an explicitly authorized state change
before finalization of write-ahead evidence. It supports hold, ready, commit,
finalize and commit-and-finalize paths, plus precise error-phase propagation.
In production, Blooket uses it to recover ambiguous journaled browser writes;
the signed desktop-update installer uses the same engine to persist
installation-phase transitions. Both call sites have independent integration
tests. A storage adapter must enforce its own CAS/locking and durability; this
is not a distributed transaction coordinator or a replacement for fsync.
