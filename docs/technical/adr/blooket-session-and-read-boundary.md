# Blooket session and read boundary

## Status

Accepted.

## Decision ID

`blooket-api.execution.session-and-read-boundary`

## Context

Authenticated browser work must reuse the teacher's confirmed session when
possible and must not read stored credentials merely to answer a health query.
Browser page extraction is also untrusted runtime input: a page change must not
silently create new fields in the API contract.

Current public Blooket Help Center material, retrieved on 2026-10-05, identifies
"My Sets" as the management surface. The current question-set creation guidance
also establishes title, description, optional cover image, and public/private
visibility as set metadata. The public identity page observed on 2026-10-07
exposes `Log in`, `Username or email`, `Password`, and `Let's go!` on the exact
`https://id.blooket.com/login` route. These observations do not establish a
durable machine identifier grammar or a complete machine-readable question
payload.

## Decision

The browser-session port reports observed navigation facts and accepts
credentials only for an explicit authentication call. It does not own navigation
policy. Canonical navigation decisions remain in the IR.

Session inspection performs exactly one browser observation attempt. It never
authenticates and never reads the host secret store. This makes health/session
reads safe to expose later without causing login side effects.

Session establishment first inspects the current browser. Dashboard, create, and
edit states are reused without credential access. Signed-out or expired states
trigger security-domain credential retrieval. The application passes those
credentials directly to the browser-session port, discards them after the call,
and performs a fresh observation before reporting readiness.

The browser adapter may submit only the exact observed identity login surface;
submission itself is not evidence that authentication succeeded.

Rate limiting returns a wait state without a guessed delay. Organization
prompts, security challenges, and unexpected pages require human action.
Remaining signed out after a credential submission is an explicit authentication
failure rather than an inferred success.

Account capability and set-read adapters return untrusted candidates. The
application validates capability candidates through the versioned capability
snapshot decoder and set candidates through the versioned set-read decoder.
Invalid raw values are never returned to higher callers.

Set list summaries currently contain only an opaque non-empty remote ID and
title. Set detail adds description and public/private visibility. The ID has no
repository-invented grammar. Empty observed descriptions are admitted because
current evidence does not establish that descriptions must be non-empty.

Set-list probes also carry explicit `complete` or `unknown` collection
completeness. The current browser bridge reports `unknown` because client-side
My Sets evidence does not prove server-side completeness. Higher callers may
return those observational rows, but unknown collections cannot establish a
publication baseline or a reconciliation outcome.

Question payloads, cover-image read representation, remote-ID syntax, and other
set fields remain outside the read contract until authenticated browser evidence
establishes their shape.

## Consequences

- Health/session inspection can never cause credential access or login.
- Existing ready sessions avoid unnecessary secret-store reads.
- Credentials remain inside trusted security/application/browser boundaries.
- Identity-page permission is limited to `https://id.blooket.com/*`, and
  ordinary set/question reads remain dashboard-only.
- Browser exceptions become stable secret-free failure codes.
- Capability and set page data cannot bypass runtime decoding.
- Invalid set IDs fail before browser, secret-store, or set-read side effects.
- Detail reads fail when the returned opaque ID differs from the requested ID.
- Set-read contracts can grow only from verified evidence rather than guesses.

## Rejected Alternatives

- Reading credentials before inspecting the session was rejected because it
  touches secrets even when the teacher is already signed in.
- Returning raw browser extraction objects was rejected because page changes
  could silently expand transport-visible data.
- Assigning a regex or length limit to Blooket set IDs was rejected because no
  verified evidence currently establishes that grammar.
- Treating description as required non-empty text was rejected because current
  public guidance establishes the field but not that constraint.
- Adding question payload fields from assumptions was rejected until an
  authenticated observation fixture defines their exact read shape.

## Verification

Session tests prove confirmed sessions perform zero secret-store reads, login
reads credentials only when required, challenges stop for a human, and browser
exceptions never expose fixture credentials. Extension tests additionally prove
exact identity-origin admission, challenge refusal, prepared-value revalidation,
one submit click, and secret-free bridge replies.

Capability-inspection tests prove session gating, strict snapshot decoding, and
raw invalid-value containment. Set-read tests prove request-first validation,
opaque-ID preservation, strict list/detail decoding, mismatch detection, and
failure before side effects for invalid request IDs.
