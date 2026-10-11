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

For the specifically observed 2026-10-10 build, an extension-local
decoder can compare the initial unfiltered `LIBRARY` component's `allSets`
and `sets` identities against visible cards.
This comparison does not prove pagination or remote collection completeness;
raw Flight and non-identity props remain inside the extension. Other builds
and unavailable initial model data cannot upgrade `unknown`.

The extension worker compares the native document time origin before and after
each paired DOM/initial-model observation, including after the second stable
read. A same-route replacement between injected scripts invalidates the
candidate even when the URL and set cards appear unchanged.

Saved set and question reads require a fresh document even when the owned tab
already has the requested URL. Before navigation or reload, the worker checks
the existing unsaved-form guard on the exact source route. A same-route reload
bypasses the browser cache; a changed route uses ordinary tab navigation.

The host compares positive native `performance.timeOrigin` observations before
and after the operation. A stale `complete` tab reply, unchanged document
origin, late inspection, or manual route change cannot admit a saved-state read.
Session observation remains non-navigating and does not need document
replacement.

Saved Set Detail reads likewise pin the native document origin through the
sidebar baseline, metadata editor, and cancellation check. Their cleanup must
never click a replacement document at an unchanged edit URL.

The question-inspection host also pins the native document origin through its
visible enumeration, each saved-question modal, optional image evidence,
and final question-list comparison. When a document is replaced at the same
URL, all collected question candidates fail and the host must not click
Cancel in the replacement document's possible teacher-owned editor.

The implementation was checked on 2026-10-10 against
[Chrome tabs][chrome-tabs] and [MDN timeOrigin][document-origin]. These sources
establish browser primitives, not successful Blooket publication. Synthetic
tests cover reload admission, stale document refusal, and unsaved-form guards.

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

[chrome-tabs]: https://developer.chrome.com/docs/extensions/reference/api/tabs
<!-- jig-ignore-next-line: Keep the exact official source URL intact. -->
[document-origin]: https://developer.mozilla.org/en-US/docs/Web/API/Performance/timeOrigin
