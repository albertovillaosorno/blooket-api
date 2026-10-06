# blooket-api TODO

Only unfinished work belongs here. The roadmap is ordered by dependency depth:
later layers may depend on earlier layers, while foundations must not depend on
unfinished presentation or integration layers.

The initial product is one teacher's macOS workflow: prepare quizzes with online
AI, review them in the local browser UI, and publish them to Blooket. Online MCP
is required for the first usable release. Linux distribution and host/browser
behavior are outside scope; useful portable tests may still run on Fedora.

## P1 — Projects, settings, security, and media

### TODO - Wire media intake surfaces and capture verified limits

Connect paste, drag-and-drop, file, and browser-extension host adapters to the
capability-bound durable image-import operation once the localhost boundary is
available. Populate remaining canvas and pixel fields only from verified Blooket
evidence. Unknown values continue to fail closed.

### TODO - Extend settings for local service and tunnel configuration

Add a versioned, atomically persisted settings shape for the public MCP
hostname, tunnel enablement, secret references, and first-run diagnostic status.
The local UI accepts the hostname and Cloudflare tunnel token with a Save
action; the user provisions the domain and tunnel. Store the token through the
macOS Keychain capability and persist its reference, not its value, in ordinary
settings.

Separate tunnel credentials, MCP authorization credentials, and Blooket secrets.
Return configured/missing status without reading secret values back into the UI.
Handle partial settings/secret saves explicitly and never report an unusable
configuration as saved.

Define migration from existing desktop-oriented settings without resetting
projects, theme, port selection, or secret references.

## P2 — Blooket execution boundary

### TODO - Complete verified Blooket capabilities

Continue extending the dated capability fixture with authenticated browser
observations for remaining canvas/pixel constraints, account-dependent behavior,
navigation states, and other facts that official documentation does not
establish. Upload bytes and set title/description limits are now observed.

### TODO - Implement concrete browser session adapter

Connect the reuse-first session application to the teacher's local browser.
Derive page classification and login-field selectors only from verified
observations. Keep credential submission inside the trusted browser boundary and
preserve all human-stop states. A web UI alone cannot control another origin.

### TODO - Complete browser read adapters and set content retrieval

Implement concrete probes for capabilities, My Sets, and set metadata. Extend
retrieval to question/media content only after observations establish a
versioned read shape. Inspect actual dashboard requests before choosing browser
probes or HTTP-backed reads. The `/api` path by itself is not a verified public
API; do not invent set CRUD endpoints, cookie forwarding rules, or server-action
contracts.

### TODO - Complete concrete create/edit execution

Implement the mutation adapter and provider-specific `captureBaseline`/`verify`
methods from observations. Preserve persisted count/digest baselines and
explicit reconciliation. Prefer a verified usable endpoint where evidence
establishes its authentication and behavior; otherwise use the browser boundary.
Add normal pacing and retry classification only from verified behavior.

## P3 — Canonical CLI and localhost API

### TODO - Complete canonical blooket CLI coverage

Extend the initial CLI with remaining shared operations, predictable
subcommands, exit codes, human output, `--json` output, and secret-free
diagnostics.

### TODO - Implement localhost API and browser UI hosting

Serve the local UI and its API from the same configurable loopback origin. Route
requests to the canonical executor without a second semantic implementation.
Keep credential configuration local, validate local request origins, and expose
no secret-read endpoint. Keep the general API and UI outside tunnel ingress.

### TODO - Implement transport parity tests

Run equivalent fixtures through direct execution, CLI JSON mode, and HTTP and
compare normalized results. Treat semantic divergence as a release blocker.

## P4 — Required online MCP

### TODO - Implement MCP facade over CLI

Map tools to canonical commands, execute CLI JSON mode, and decode results
without importing application internals. Add Streamable HTTP for online clients;
local-only stdio support does not complete this requirement. Restrict tool
execution to registered commands and admitted project/media targets.

### TODO - Connect the user-provisioned Cloudflare Tunnel

Run the configured tunnel against a dedicated loopback MCP gateway using the
saved token. The user supplies the domain, tunnel, and remote-client setup; do
not automate account provisioning or assume a new cloud deployment is needed.
Publish only approved MCP and required authorization/discovery routes.

Keep the browser UI, settings, secrets, and general API private. Preserve the
canonical CLI execution path and bind local listeners to loopback.

The gateway must authenticate and authorize actual tool calls. Integrate the
user's MCP-compatible authorization setup; do not assume a tunnel token, an
interactive Access page, or arbitrary custom headers authenticate ChatGPT.
Support revocation and stopping the tunnel locally.

Show service/tunnel status without leaking tokens. No tunnel is started before
the user saves and enables its configuration.

### TODO - Prove the online teacher workflow

Verify the actual ChatGPT account can connect to the configured remote MCP and
complete an authenticated read-only tool call. Then exercise an explicitly
approved small quiz through generation, validation, local review, publication,
and read-back. Confirm equivalent CLI/MCP results and denial of unauthorized
calls and non-MCP routes. Test sleep/disconnect recovery without blindly
replaying a mutation; show unavailable status when the Mac or tunnel is offline.

### TODO - Author teacher workflow skills

Add English skills for age/level discovery, quiz language, distractor quality,
image placement, difficulty, media selection, and teacher review. Skills guide
agents; they do not own selectors or protocol implementation.

## P5 — Local browser UI and optional Safari extension

### TODO - Implement the local browser interface

Build one UI for projects, quiz review, validation, media editing, Blooket
session state, settings, tunnel configuration, diagnostics, and execution
progress. Preserve system light/dark appearance. Opening the local page should
not require a native desktop window or a permanent Dock icon.

### TODO - Share browser UI behavior and declare its host boundary

Keep reusable state, components, validation rendering, and media intake in
`src/ui/general/`. Declare a web host component in Jig before adding source and
retire the unused desktop host declaration when that boundary is implemented.
The page and extension share browser-safe code; secrets and filesystem access
remain in the local service.

### TODO - Implement optional Safari extension intake

Add paste, drag-and-drop, and direct web-image intake into the local service.
The extension may open the same browser UI rather than maintaining another full
editor. It never receives stored Blooket credentials or implements quiz rules.

### TODO - Implement macOS background-service lifecycle

Add visible, opt-in launch at login, start/stop controls, local status, and
clean uninstall behavior. A menu-bar helper is optional; a native desktop shell
is not required. The browser UI may open on demand while the service continues
locally.

## P6 — macOS packaging and first-run diagnostics

### TODO - Confirm the recipient's Mac and choose packaging inputs

Record the chip, actual macOS version, and browser in About This Mac. ARM64 is
provisional; add x86-64 only if the recipient uses Intel. Establish a minimum OS
from the selected runtime and native dependencies rather than guessing Big Sur
compatibility from appearance. Metal acceleration is not required.

### TODO - Package the macOS background service

Bundle the runtime, UI assets, CLI, required Sharp/libvips artifacts, and the
chosen cloudflared delivery method for the selected architecture. Preserve
third-party notices and document Gatekeeper behavior accurately. Signing and
notarization remain explicit packaging decisions, never unverified claims. No
Linux/Windows package or VM setup is required for the prototype.

### TODO - Run a lightweight diagnostic once on first launch

Implement a bounded first-run check on the recipient's Mac: OS/architecture,
settings decoding, disposable application-data read/write, local port, tiny
native image decode, Keychain client availability, and configured service/tunnel
readiness. Missing optional configuration is distinct from a broken dependency.
Do not publish a quiz, change Blooket, write real credentials, or run the full
repository test suite. Do not require remote access before a tunnel is enabled.

Persist the diagnostic schema/check version, outcome, timestamp, stable failure
codes, and local log reference in settings after the first attempt. Show
failures and a manual Run diagnostics action; do not rerun the first-use suite
on every launch. Logs contain bounded, useful environment/version facts and
failure codes, never raw tokens, passwords, cookies, authorization headers, or
private quizzes. Keep independent features usable when one capability fails.

Development may remain theoretical for macOS integration until that first real
run. Record untested behavior honestly; Fedora checks are portable checks, not
macOS release evidence. There is no VM provisioning prerequisite.

## Deferred ideas

- Native desktop window or an optional menu-bar convenience helper.
- Linux or Windows distribution and host/browser integration.
- Experimental content-aware or generative media fill.
- Native media acceleration only after measurements show a concrete need.
