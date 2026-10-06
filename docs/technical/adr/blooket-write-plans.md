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

Progress uses a version-two checkpoint containing the exact plan ID, the next
operation index, and the opaque remote set ID after Create Set succeeds. The
checkpoint advances only when the executor confirms the exact next operation ID.
Cross-plan, skipped, out-of-order, and unbound advanced progress fail
explicitly.

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

Write-ahead recovery uses a separate version-three attempt journal bound to the
exact plan, operation ID, and operation index. An `attempting` record has no
receipt. A confirmed Create Set record stores the opaque remote set receipt;
question confirmations store `null`. Corrupt or cross-plan evidence is retained.

Version three may also persist a non-sensitive verification baseline captured
before mutation. The baseline contains only a collection kind, item count, and
lowercase SHA-256 digest. It must never contain provider content, credentials,
cookies, or raw browser/session state. Version-one and version-two journals
decode with `baseline: null`; recovery never invents missing pre-attempt
evidence.

Collection hashing uses versioned JSON framing that preserves observed order and
duplicates, avoiding delimiter-based or concatenation ambiguity.

Local recovery treats `attempting` as ambiguous and requires reconciliation.
An explicit resolver may apply externally verified evidence for the exact
operation: confirmed outcomes first persist their receipt and reuse normal
recovery, while verified non-confirmation clears only the pending journal.

Inconsistent progress, operation mismatches, invalid receipts, and lock
conflicts preserve recovery evidence. Only a durably `confirmed` journal may
advance a missing checkpoint step automatically.

Persisted execution serializes the full recovery-to-cleanup transaction with an
exclusive execution lock. Standalone recovery acquires that same lock, whose
path is derived by the attempt-journal adapter, so recovery cannot race a remote
write using the same journal.

The persisted path reuses the canonical executor as explicit
prepare/attempt/complete phases. Session readiness is established first. When a
verification port is available, its pre-attempt baseline is captured and durably
journaled before the remote mutation. Only then may the remote attempt begin.

`confirmed` is persisted immediately after remote success. Only then may the
checkpoint advance and the journal be cleared. Concurrent callers cannot observe
stale progress and issue a duplicate mutation.

A non-confirmed remote outcome deliberately leaves the `attempting` journal in
place and returns reconciliation-required instead of a retryable result. Session
stop states occur before journal creation. A confirmed journal whose checkpoint
save fails remains sufficient for deterministic local recovery on the next call.

Concrete browser mutation mechanics, the provider-specific verifier that feeds
explicit reconciliation, normal pacing, and retry classification remain
dependent on verified browser behavior rather than guessed selectors or timing
constants.

Authenticated build evidence shows that Create Set returns an opaque remote set
identifier and continues at `/edit?id=<id>`. Confirmed execution now persists
that receipt in the journal before checkpoint advancement, then carries the same
binding into checkpoint version two before the journal is cleared.

Recovered edit client evidence distinguishes question creation from set
creation. Module `35211` submits Add Question through server-action reference
`9898.Xv` and treats form status `SUCCESS` as the client success signal, but
does not expose a remote question ID. Recovery therefore must not infer a
question write from a matching toast, current page, or duplicate-able content.

A concrete verifier should compare a post-attempt collection against the
persisted pre-attempt count/digest. It may confirm only when removing the one
expected effect reproduces the exact baseline and all other observed state is
unchanged. Multiple candidates, concurrent changes, absent baselines, or weak
page matches remain `inconclusive`.

Subsequent question writes receive the checkpoint's remote set ID explicitly.
Recovery refuses legacy advanced checkpoints, legacy confirmed Create Set
journals, premature bindings, and receipt/checkpoint mismatches instead of
inventing or changing the target.

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
