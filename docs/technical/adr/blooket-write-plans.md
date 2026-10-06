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
