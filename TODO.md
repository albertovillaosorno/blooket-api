# blooket-api TODO

Only unfinished work belongs here. The roadmap is ordered by dependency depth:
later layers may depend on earlier layers, while foundations must not depend on
unfinished presentation or integration layers. P0 is the current foundation
horizon.

## P0 — Repository and contracts

### TODO - Establish atomic local persistence

Define the project, settings, vault, temporary-file, lock, backup, flush, and
atomic-replace rules needed to guarantee interruption-safe local state.

## P1 — Projects, settings, security, and media

### TODO - Implement project persistence

Implement versioned `project.json` loading, validation, migration boundaries,
stable question identities, media requests, and media references.

### TODO - Implement media metadata and English descriptions

Store stable media IDs, local paths, canonical English descriptions, and
`english`, which defaults to false until explicitly verified.
Keep origin URLs outside the required contract.

### TODO - Implement field-aware media search

Provide a dependency-free media searcher with literal search by default,
optional regular expressions, explicit searchable fields, per-asset results,
and deterministic machine-readable CLI output. Keep the text index friendly to
manual `rg` inspection without depending on ripgrep at runtime.

### TODO - Implement media import and rendition pipeline

Accept paste, drag-and-drop, files, and browser-extension intake; preserve
originals; decode supported static and animated formats; produce the fixed
Blooket canvas; enforce byte limits; and retain GIF animation where supported.

### TODO - Implement media editor operations

Implement pan, zoom, keyboard nudging, contrast, saturation, rectangular
blur/redaction, naming, description editing, and undo/redo without generative
fill.

### TODO - Implement settings and port collision handling

Persist loopback address, preferred port, startup preferences, theme behavior,
and other user settings. Detect occupied ports before bind and support explicit
or automatically persisted alternatives.

### TODO - Implement host secret storage

Use macOS Keychain for the product-quality target and a standard Linux secret
store for development support. Define the interface so Windows Credential
Manager can be added later without changing callers.

## P2 — Blooket execution boundary

### TODO - Define verified Blooket capabilities

Record the currently observed question types, answer counts, media availability,
account-dependent features, upload constraints, navigation states, and other
facts as explicit capability data with fixtures and verification dates.

### TODO - Implement Blooket navigation state machine

Model signed-out, authenticating, authenticated, organization-prompt,
dashboard, create, edit, expired-session, rate-limited, security-challenge,
unexpected-page, and human-action-required states explicitly.

### TODO - Implement session reuse and login

Reuse the teacher's confirmed local browser session, obtain credentials only
through the security domain when login is actually required, and never expose
those credentials to higher transports.

### TODO - Implement read operations

Implement health/session state, set listing, set retrieval, and capability
inspection before writes.

### TODO - Implement validated write plans

Lower only fully validated project/question documents into explicit idempotent
Blooket write plans with operation identities and resumable progress.

### TODO - Implement create and edit operations

Create and update sets and questions through the Blooket adapter, with bounded
normal pacing, checkpoints, retry classification, and human stop conditions.

## P3 — Canonical CLI and localhost API

### TODO - Implement canonical blooket CLI

Provide predictable subcommands, exit codes, human output, `--json` machine
output, and no-secret diagnostics over the shared IR and executor.

### TODO - Implement localhost API

Expose the subset needed by desktop and extension clients over configurable
loopback HTTP without creating a second semantic implementation.

### TODO - Implement transport parity tests

Run equivalent fixtures through direct execution, CLI JSON mode, and HTTP and
compare normalized results. Treat semantic divergence as a release blocker.

## P4 — macOS desktop and Safari extension

### TODO - Implement desktop shell

Build the macOS-first desktop UI for service state, login state, settings,
port collisions, autostart, project access, and media-vault workflows while
preserving system light/dark appearance.

### TODO - Implement Safari extension

Build the optional Safari Web Extension for paste, drag-and-drop, and direct
web-image intake into the local media service. The extension must never receive
Blooket credentials or implement quiz semantics.

### TODO - Share general UI behavior

Keep reusable browser-safe UI state, components, validation rendering, and media
intake behavior in `ui/general`; desktop and extension packages may only add
host-specific surfaces.

### TODO - Implement visible macOS lifecycle integration

Implement opt-in launch at login, minimize/start behavior, tray or menu-bar
presence where appropriate, clean disable/uninstall behavior, and no hidden
persistence.

## P5 — MCP and agent pedagogy

### TODO - Implement MCP facade over CLI

Map MCP tools to canonical `blooket` commands, execute CLI machine mode, and
return decoded results without importing application internals.

### TODO - Implement MCP and CLI parity tests

For every MCP tool, prove that the emitted CLI invocation and normalized MCP
result are equivalent to the documented CLI operation.

### TODO - Author teacher workflow skills

Add English repository skills for age/level discovery, quiz-language selection,
distractor quality, image-placement policy, pedagogical difficulty, safe media
selection, teacher review, and other lesson-authoring guidance. Skills instruct
agents; they do not contain browser selectors or protocol implementation.

## P6 — Linux completion and distribution

### TODO - Maintain Linux development support

Keep portable execution, local API, CLI, project, media, settings, and test
flows working on Linux even where macOS receives richer desktop integration
first.

### TODO - Package unsigned macOS releases

Produce ARM64-first and x86-64 macOS artifacts with documented Gatekeeper
behavior, reproducible packaging inputs, and no claim of notarization or signing
until those capabilities are intentionally added.

### TODO - Evaluate Windows support

Add Windows only after the macOS contract is stable, reusing the same domains
and introducing platform adapters rather than Windows-specific product logic.

## Deferred ideas

- Authenticated remote relay that forwards to, rather than replaces, the local
  API.
- Experimental local content-aware or generative media fill.
- Optional native media acceleration only after measurements show that ordinary
  TypeScript/runtime facilities are insufficient.
