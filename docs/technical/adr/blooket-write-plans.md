# Blooket write plans

## Status

Accepted.

## Decision ID

`blooket-api.execution.validated-write-plans`

## Context

Remote writes must never consume raw model output or partially validated project
state. Retrying an interrupted write also needs stable operation identities that
do not change merely because unrelated local metadata changed.

Capability evidence can be incomplete or account-dependent. A structurally valid
project therefore is not automatically safe to execute against Blooket.

## Decision

Write-plan construction accepts untrusted project JSON, media JSON Lines, and an
untrusted capability snapshot. It first decodes the project bundle, rejects
unresolved image requests, decodes the capability snapshot, and applies
fail-closed project compatibility rules before producing a plan.

Only explicit supported capability facts admit optional question and answer
images. Multiple-choice answer counts use verified minimum and maximum bounds,
multiple-correct questions require explicit support, typing match modes must be
listed, project visibility must be admitted, and omitted cover images require
verified optionality.

The plan is remote-neutral. It contains one set operation followed by ordered
question operations, stable local question IDs, and stable media IDs, but no
Blooket selectors, URLs, guessed remote IDs, media descriptions, or vault paths.

The plan ID is the SHA-256 digest of the lowered execution-relevant desired
state, prefixed as an operation identifier. Operation IDs derive from that plan
ID. Retrying the same desired state therefore reuses identities, while changing
remote-visible content creates a new plan.

Progress uses a version-one checkpoint containing the exact plan ID and the next
operation index. A checkpoint advances only when the executor confirms the exact
next operation ID. Cross-plan checkpoints, skipped operations, out-of-order
operations, and advancement after completion all fail explicitly.

Remote execution consumes at most one planned operation per application call.
The checkpoint is decoded before any browser, credential, or mutation side
effect. A completed checkpoint returns without touching the browser. A confirmed
mutation advances exactly one operation; rate limiting, session expiry, human
stop states, browser failures, and otherwise unconfirmed outcomes preserve the
existing checkpoint.

The executor intentionally does not sleep, loop, or auto-retry. Confirmed
progress is persisted through an atomic, writer-locked checkpoint file. Missing
files mean index zero; durable saves may hold the current index or advance by
exactly one and reject regressions, skips, and cross-plan state.

The persisted application composition loads progress before browser side effects
and stores a confirmed advancement before returning success. If a remote write
is confirmed but checkpoint persistence fails, it returns an explicit recovery
state rather than treating the operation as retryable.

Write-ahead recovery uses a separate version-one attempt journal bound to the
exact plan, operation ID, and operation index. A new attempt journal is created
without overwrite in the `attempting` phase and may be atomically promoted to
`confirmed`. Corrupt, cross-plan, or symbolic recovery evidence is never deleted
automatically.

Local recovery treats `attempting` as ambiguous and requires reconciliation.
Only a durably `confirmed` journal may advance a missing checkpoint step
automatically. If the checkpoint already contains that confirmed advancement,
recovery clears the redundant valid journal.

Persisted execution serializes the full recovery-to-cleanup transaction with an
exclusive execution lock. Standalone recovery acquires that same lock, whose
path is derived by the attempt-journal adapter, so recovery cannot race a remote
write using the same journal.

The persisted path reuses the canonical executor
as explicit
prepare/attempt/complete phases: session readiness is established first, the
`attempting` journal is created immediately before the remote attempt, and
`confirmed` is persisted immediately after remote success. Only then may the
checkpoint advance and the journal be cleared. Concurrent callers cannot observe
stale progress and issue a duplicate mutation.

A non-confirmed remote outcome deliberately leaves the `attempting` journal in
place and returns reconciliation-required instead of a retryable result. Session
stop states occur before journal creation. A confirmed journal whose checkpoint
save fails remains sufficient for deterministic local recovery on the next call.

Concrete browser mutation mechanics, provider-specific reconciliation of an
ambiguous `attempting` journal, normal pacing, and retry classification remain
dependent on verified browser behavior rather than guessed selectors or timing
constants.

Authenticated build evidence also shows that Create Set returns an opaque remote
set identifier and continues at `/edit?id=<id>`. The current success result does
not yet persist that provider receipt. The concrete create path therefore must
not rely on remaining on the same browser page: the remote set binding must be
durable and plan-bound before subsequent question operations are enabled.

## Consequences

- Raw or malformed project data cannot reach a write plan.
- Unknown or account-dependent capabilities remain blocking when used.
- Local media descriptions, names, and vault paths cannot perturb operation IDs.
- Unresolved media requests block planning before any remote side effect.
- Checkpoints can be persisted later without changing plan semantics.
- Remote create/edit executors can be idempotent around stable operation IDs.

## Rejected Alternatives

- Hashing the complete local bundle was rejected because local-only media
  metadata would invalidate otherwise identical remote work.
- Using random operation IDs was rejected because retries could not recover the
  same idempotency identity after interruption.
- Storing only a completed-operation count without a plan ID was
  rejected because progress could be applied to a different desired state.
- Allowing account-dependent capabilities optimistically was rejected because it
  would turn missing evidence into an unsupported remote write attempt.

## Verification

Write-plan tests prove invalid projects, unresolved media, invalid capability
snapshots, and account-dependent answer images cannot produce plans. They also
prove execution-relevant content changes plan identity while local-only media
metadata does not.

Checkpoint tests prove progress binds to one exact plan, advances one confirmed
operation at a time, rejects skipped and cross-plan operations, and
distinguishes completion from mismatch.
