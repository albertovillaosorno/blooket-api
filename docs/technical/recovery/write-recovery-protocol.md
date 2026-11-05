# Deterministic mutation recovery protocol

The product contains a **headless, pure recovery protocol engine**, independent
of the Blooket browser and desktop host. It is not merely a CLI around browser
selectors: a validated desired-state plan compiles into immutable operation IDs
and checkpoints, and a write-ahead journal records the remote mutation window.

## Executable boundaries

The following components participate in the same production workflow:

1. `src/projects/blooket-write-plans/domain/write-plan.ts` lowers verified
   project state to a deterministic sequence of write operations.
2. `src/projects/blooket-write-plans/domain/checkpoint.ts` provides the exact
   monotonic checkpoint reducer and receipt-binding rules.
3. `src/projects/blooket-write-plans/domain/recovery-automaton.ts` implements
   the **pure crash-recovery transition classifier**, which never infers remote
   success from an ambiguous write-ahead attempt. Its bounded model checking
   **calls the independent** `src/ir/protocol-kernel/domain/model-checker.ts`
   rather than maintaining a special-purpose BFS. The immutable operation
   dependencies are checked by the shared DAG compiler through
   `src/projects/blooket-write-plans/domain/plan-protocol.ts`.
4. `src/api/blooket-write-execution/application/recover-persisted.ts` calls
   that classifier in the actual locked recovery path, then uses durable
   adapters for confirmation persistence, checkpoint advancement or cleanup.
   `execute-persisted.ts` also calls `compileSequentialWriteProtocol` before
   acquiring its execution lock: invalid graphs never reach an I/O boundary.
5. `src/platforms/write-attempt-files/adapter-outbound/file.ts` and
   `src/platforms/file-locks/adapter-outbound/file-lock.ts` own the journal and
   filesystem lock. Recovery never makes provider requests or removes an
   ambiguous journal to force a retry.

The headless SDK at `src/sdk/headless.ts` exports both
`decideWriteRecovery` and `analyzeWriteRecoveryProtocol`; neither requires a
browser, local service, network access, or file system.

## Crash windows and modeled invariants

A sequential write operation has the following modeled durable cuts:

| Cut | Checkpoint | Attempt record | Safe recovery result |
| --- | --- | --- | --- |
| Before dispatch | Current | Missing | Ready |
| Browser outcome unknown | Current | Attempting | Requires independent reconciliation |
| Confirmation durable | Current | Confirmed | Persist exact next checkpoint |
| Checkpoint durable | Next | Confirmed | Clear redundant confirmed attempt |
| Cleanup durable | Next | Missing | Ready for next operation |

A separate **externally verified** negative resolution can return an
attempting window to ready without declaring the remote mutation successful.
The model checker explores these reachable states using a queue and a visited
set, evaluates the **same classifier used by production**, and tests the
expected decision and checkpoint for every reachable cut. It also rejects
unreachable plan steps and duplicate operation identities, with a 4,096-step
limit to bound diagnostic resource use.

The tested properties are monotonic progress, no automatic retry from unknown
remote outcomes, exact operation binding, and cleanup only after confirmed
progress. This is a **bounded model of the local sequential journal protocol**;
it is not a proof that Blooket observed or committed a remote mutation. Remote
verification and ambiguous-result reconciliation remain explicit obligations.
The implementation does not claim a distributed consensus system or a DB.

## Reproduce

```sh
npm run check
node --test \
  tests/projects/blooket-write-plans/domain/recovery-automaton_tests.ts \
  tests/api/blooket-write-execution/application/recover-persisted_tests.ts \
  tests/api/blooket-write-execution/application/reconcile-persisted_tests.ts \
  tests/sdk/headless_tests.ts
npm test
```

The focused fixtures cover one-to-100-operation crash-cut exploration,
create/append plans, forged receipts, stale checkpoints, mismatched plan IDs,
duplicate operation IDs, impossible plans, and persisted journal recovery.

The reusable core can be imported independently using
`@blooket-api/repository/protocol-kernel`. Its BFS verifier retains shortest
failure traces, explicit state and edge budgets, and terminal-reachability
checks; a budget-limited result is never treated as a safety proof. The
sequential write protocol checker uses the DAG compiler without permitting
parallel browser mutations. See
[the actual import/production call graph](protocol-kernel-and-execution-graph.md)
and the core contract tests for reproducible evidence.
