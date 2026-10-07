# blooket-api TODO

Only unfinished work is indexed here. Read the linked record for acceptance,
dependencies, blockers, and evidence; preserve its stable ID when completing it.
Execute entries in the displayed order; reordering or splitting requires
synchronized record metadata and dependencies.

## P1 - Foundations

## P2 - Blooket publication

### TODO - Authenticated Blooket reads

Finish verified questions, capabilities, pagination, and browser-session stops
without presenting incomplete reads as publication-ready state.

[Record](docs/todo/open/blooket/reads.mdc)

### TODO - Verified HTTP writes and browser fallback

Validate actual action payloads and responses, select supported transports
before mutation, and reconcile ambiguous outcomes without replay.

[Record](docs/todo/open/blooket/transports.mdc)

### TODO - Mutation pacing and human checkpoints

Share bounded account mutation budgets across transports and preserve
recoverable human-action stops for challenges and unfamiliar access states.

[Record](docs/todo/open/blooket/pacing.mdc)

### TODO - Journaled quiz publication

Connect canonical create/edit execution with fresh remote read-back, strict
media admission, conflict detection, pacing, and recovery.

[Record](docs/todo/open/blooket/publication.mdc)

### TODO - Autonomous AI quiz publication

Finish admitted AI image delivery, automatic publication, verification,
correction, progress, cancellation, and recovery through canonical operations.

[Record](docs/todo/open/teaching/ai-review.mdc)

## P3 - Delivery

### TODO - Diagnostics and launch at login

Implement visible, reversible launch-at-login and finish first-use checks,
service ownership, and tunnel lifecycle.

[Record](docs/todo/open/delivery/lifecycle.mdc)

### TODO - Safe automatic application updates

Implement and verify opt-in public GitHub updates with trusted artifacts, safe
restart, retained data, and independent login-startup preferences.

[Record](docs/todo/open/delivery/updates.mdc)

## P4 - Teacher workflows

## P5 - Final platform hardening

### TODO - macOS, Safari, and ChatGPT platform hardening

Keep all remaining platform-specific review in one final record. Official
platform documentation plus the opt-in ARM64 Safari CI job are sufficient;
recipient-machine or actual-client smoke tests do not block earlier work.

[Record](docs/todo/open/acceptance/teacher.mdc)
