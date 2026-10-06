# Blooket navigation state machine

## Status

Accepted.

## Decision ID

`blooket-api.navigation.explicit-state-machine`

## Context

Browser automation can be redirected by authentication expiry, rate limiting,
organization prompts, security challenges, or ordinary navigation. Treating an
expected URL sequence as authoritative would let automation continue after the
browser has entered a state that requires different handling.

Current repository evidence does not establish durable selectors, URLs, retry
durations, or account-specific navigation details. The navigation contract must
therefore encode only semantics the product already requires.

## Decision

The canonical IR models signed-out, authenticating, authenticated,
organization-prompt, dashboard, create, edit, expired-session, rate-limited,
security-challenge, unexpected-page, and human-action-required states.

Browser observations are authoritative and may replace any current workflow
state. Observation events deliberately cannot manufacture the internal
authenticating, authenticated, or human-action-required states; those are
entered only through explicit workflow events.

Authentication may begin only from signed-out or expired-session. Authentication
may be confirmed only from authenticating. These transitions prevent callers
from claiming an authenticated session without an explicit successful
authentication step.

Each state has one automation disposition. Signed-out and expired-session
request authentication; authenticating and authenticated request further
observation;
dashboard, create, and edit may continue; rate-limited waits. Organization
prompts, security challenges, unexpected pages, and explicit escalation require
human action.

No retry duration is attached to rate-limited. No organization option is chosen
automatically, and no security challenge or unexpected page is interpreted as a
login success.

## Consequences

- Browser adapters classify observed pages but do not own navigation policy.
- Unexpected redirects safely replace the workflow state that callers expected.
- Organization selection and security challenges cannot continue automatically.
- Session expiry re-enters authentication through an explicit transition.
- Rate limiting is represented without inventing timing evidence.
- Higher layers can expose state/disposition without exposing browser secrets.

## Rejected Alternatives

- A fixed URL transition graph was rejected because current evidence does not
  establish stable routes and redirects may differ by account or product change.
- Treating every unexpected page as signed-out was rejected because security
  challenges and organization prompts require distinct human handling.
- Guessing a retry delay for rate limiting was rejected because no verified
  duration is available.
- Inferring authenticated from any post-login redirect was rejected because a
  challenge or intermediate page could be misclassified as successful login.

## Verification

Domain tests enumerate every roadmap state and verify every state has one
deterministic disposition. They prove authentication transitions are narrow,
browser observations override expectations, human escalation is idempotent, and
rate limiting does not invent retry timing.
