# blooket-api TODO

Only unfinished work belongs here. The roadmap is ordered by dependency depth:
later layers may depend on earlier layers, while foundations must not depend on
unfinished presentation or integration layers. P1 is the current implementation
horizon.

## P1 — Projects, settings, security, and media

### TODO - Wire media intake surfaces and capture verified limits

Connect paste, drag-and-drop, file, and browser-extension host adapters to the
capability-bound durable image-import operation once the localhost boundary is
available. Populate the version-two canvas, pixel, and upload-byte fields only
from verified Blooket evidence; unknown values continue to fail closed.

## P2 — Blooket execution boundary

### TODO - Complete verified Blooket capabilities

Extend the dated official-document fixture with authenticated browser
observations for upload constraints, account-dependent behavior, navigation
states, and other facts that official documentation does not establish.

### TODO - Implement concrete browser session adapter

Connect the reuse-first session application to the teacher's local browser.
Derive page classification and login-field selectors only from verified
authenticated observations. Keep credential submission inside the trusted
browser boundary and preserve all human-stop states.

### TODO - Complete browser read adapters and set content retrieval

Implement concrete browser probes for capability inspection, My Sets listing,
and set metadata detail. Extend set retrieval to question and media content only
after authenticated observations establish an exact versioned read shape.

### TODO - Complete concrete create/edit execution and recovery

Implement the browser mutation adapter for set/question operations. Add a
write-ahead attempt journal so a process crash between remote confirmation and
checkpoint persistence becomes an explicit reconciliation state. Add bounded
normal pacing and retry classification only from verified behavior. Durable
checkpoint files and persisted one-step execution are already in place.

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
