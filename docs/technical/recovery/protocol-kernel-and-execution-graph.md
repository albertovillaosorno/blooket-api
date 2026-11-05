# Protocol kernel: product-critical implementation and import graph

This architecture exists as **working TypeScript imports and executable tests**,
not disconnected signal snippets. The reusable kernel is the basis of the
headless SDK and is invoked in production before browser writes and during
crash recovery.

## Computational core (no browser dependency)

- `src/ir/protocol-kernel/domain/dependency-graph.ts`: deterministic DAG
  compiler (Kahn traversal, duplicate-edge elimination, cycles, missing nodes,
  resource bounds, stable topological strata)
- `src/ir/protocol-kernel/domain/model-checker.ts`: generic exhaustive BFS
  state verifier with safety invariants, terminal reachability, hard state/edge
  budgets and minimal failure traces
- `src/ir/protocol-kernel/domain/durable-recovery.ts`: a reusable, typed
  write-ahead recovery engine. It admits explicit state transitions,
  executes storage-owned CAS/persistence, and finalizes only after durable
  commitment. It refuses to guess any unknown remote outcome and cannot
  silently clear an ambiguous attempt. The caller owns locking/fencing.
- `src/sdk/protocol-kernel.ts`: separate `./protocol-kernel` package entrypoint
  exporting the algorithms and their generic TypeScript types

## Actual imports and production execution path

```text
node/browser/MCP/CLI adapters
  └── src/api/blooket-write-execution/application/command.ts
      └── execute-persisted.ts
          ├── plan-protocol.ts                         [pre-I/O validation]
          │   ├── dependency-graph.ts                 [generic compiler]
          │   └── write-plan.ts                        [immutable plan identity]
          ├── file-lock.ts                            [real execution lock]
          └── recover-persisted.ts                    [locked recovery]
              ├── durable-recovery.ts                [generic journal commit]
              ├── recovery-automaton.ts              [real recovery classifier]
              │   ├── plan-protocol.ts                [shared graph compiler]
              │   ├── model-checker.ts                [offline checker]
              │   ├── checkpoint.ts                   [monotonic state reducer]
              │   └── write-plan.ts                   [plan contract]
              └── file-lock.ts                        [lock for standalone path]

reconcile-persisted.ts
  ├── recover-persisted.ts                            [same classifier]
  └── file-lock.ts                                    [same durable lock]

src/api/application-updates/application/install.ts
  ├── durable-recovery.ts                            [same core as Blooket]
  └── installation.ts                                [update-specific CAS]

src/sdk/headless.ts
  ├── protocol-kernel.ts                              [generic public API]
  ├── recovery-automaton.ts                           [Blooket protocol]
  └── write-plan.ts                                   [compiler of desired state]
```

The `file-lock.ts` source has no product-domain dependency *by design*; it is
reused by execution and reconciliation. The DAG compiler likewise has no
product dependency. These are **outbound-agnostic dependency roots**, not
unused source files. Runtime imports (rather than references in this document)
connect the layers. Source is TypeScript with `.ts` specifiers under NodeNext.

## Executable evidence and limits

Run the following at repository root:

```sh
npm run check
node --test \
  tests/ir/protocol-kernel/domain/*_tests.ts \
  tests/api/application-updates/application/install_tests.ts \
  tests/api/blooket-write-execution/application/recover-persisted_tests.ts \
  tests/sdk/protocol-kernel_tests.ts \
  tests/projects/blooket-write-plans/domain/recovery-automaton_tests.ts \
  tests/api/blooket-write-execution/application/execute-persisted_tests.ts
npm test
```

- `tests/ir/protocol-kernel/domain/dependency-graph_tests.ts`: cycles, diamond
  DAG, duplicate IDs and edges, missing dependencies, 2,048-node chains
- `tests/ir/protocol-kernel/domain/durable-recovery_tests.ts`: independent
  CAS failures, commit/cleanup ordering, in-doubt evidence retention, restart
  and cleanup retry after confirmed commit
- `tests/api/application-updates/application/install_tests.ts`: real signed
  updater journal transitions, abort, rollback, and interrupted recovery
- `tests/api/blooket-write-execution/application/recover-persisted_tests.ts`:
  real durable write-ahead journal recovery and failure isolation
- `tests/ir/protocol-kernel/domain/model-checker_tests.ts`: finite loops,
  minimal counterexample traces, unreachable terminals, explicit budget failure
- `tests/sdk/protocol-kernel_tests.ts`: import the **package subpath**, not a
  relative repository source path; exercise an unrelated transaction model
- `tests/projects/blooket-write-plans/domain/recovery-automaton_tests.ts`:
  exercise the same generic engine through Blooket checkpoint crash cuts
- `tests/api/blooket-write-execution/application/execute-persisted_tests.ts`:
  a duplicate-ID plan is rejected **before lock creation, journals, or writes**

This is not a distributed database or provider-neutral execution service. The
kernel supports any finite protocol supplied by a caller; the actual browser
transport and its remote commit semantics are specific to Blooket. External
ambiguous results remain unresolved until corroborated, and successful local
model checking cannot establish remote provider success.
