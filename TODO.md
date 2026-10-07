# blooket-api TODO

Only unfinished work is indexed here. Read the linked record for acceptance,
dependencies, blockers, and evidence; preserve its stable ID when completing it.
Execute entries in the displayed order; reordering or splitting requires
synchronized record metadata and dependencies.

## Foundations

### TODO - Settings and development configuration

Verify native settings and Keychain behavior while preserving the validated
development configuration contract.

[Record](docs/todo/open/settings/configuration.mdc)

### TODO - OAuth and owner approval

Accept the OAuth/PKCE and owner-password flow on the actual Mac and ChatGPT
client, including revocation and restart recovery.

[Record](docs/todo/open/security/authorization.mdc)

### TODO - Library migration and AI metadata

Finish native library and client acceptance, preserving two-field intake,
original teacher text, and revision-safe AI normalization.

[Record](docs/todo/open/media/library.mdc)

### TODO - Image and GIF editor

Verify shrinkable zoom, drag framing, Gaussian or solid backgrounds, color
selection, and preview/export parity in the target browser.

[Record](docs/todo/open/media/editor.mdc)

### TODO - Bounded media exports

Accept automatic optimization on the native host with one shared canvas and
actual prepared bytes strictly below 2,500,000.

[Record](docs/todo/open/media/exports.mdc)

## Blooket publication

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

### TODO - AI intake and quiz review

Finish admitted AI image delivery and browser review, publication, progress,
cancellation, and recovery through the canonical operations.

[Record](docs/todo/open/teaching/ai-review.mdc)

## Delivery

### TODO - Diagnostics and launch at login

Implement visible, reversible native launch-at-login and accept first-use
checks, service ownership, and tunnel lifecycle on the Mac.

[Record](docs/todo/open/delivery/lifecycle.mdc)

### TODO - Native packages and release acceptance

Complete real macOS and Safari acceptance, Apple signing/notarization, and both
Mac architectures while retaining Linux package tests and gated releases.

[Record](docs/todo/open/delivery/packaging.mdc)

### TODO - Safe automatic application updates

Implement and verify opt-in public GitHub updates with trusted artifacts, safe
restart, retained data, and independent login-startup preferences.

[Record](docs/todo/open/delivery/updates.mdc)

## Teacher acceptance

### TODO - Complete teacher workflow acceptance

Run authoring, media, publication, update, and recovery acceptance on the
recipient Mac and actual ChatGPT account before declaring the product complete.

[Record](docs/todo/open/acceptance/teacher.mdc)

### TODO - Adaptive teacher workflow skills

Accept scoped personal workflow learning and English description normalization
with the real client, preserving revisions and human checkpoints.

[Record](docs/todo/open/teaching/skills.mdc)
