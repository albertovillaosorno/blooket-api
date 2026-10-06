# blooket-api

> Project started: October 5, 2026

**A local-first TypeScript toolkit for teachers who want to build, validate,
prepare, and publish Blooket question sets without turning lesson authoring into
browser busywork.**

The initial product serves one teacher using a Mac: prepare a quiz with ChatGPT,
review it in the browser, and publish it to Blooket. Lesson projects, media,
settings, credentials, and browser execution remain on that Mac.

One local background service serves the browser UI and localhost API. The
optional Safari extension shares UI behavior and adds convenient media intake. A
native desktop window and permanent Dock icon are outside the initial scope.

The canonical `blooket` CLI remains the execution interface for MCP. Online MCP
access through an authenticated Cloudflare Tunnel is required for the first
usable release; online AI clients must be able to reach the local workflow.

macOS is the only product target. ARM64 is provisional until the recipient
confirms the chip and macOS version in About This Mac; x86-64 packaging is
needed only if that Mac is Intel. Linux can run portable development tests, but
no Linux binary or host/browser integration is required. Windows is out of
scope.

This project is not affiliated with or endorsed by Blooket. Blooket automation
is an unsupported integration boundary. The application must preserve local
projects when that boundary changes, stop for security challenges it does not
understand, and never expose credentials to an LLM, MCP caller, browser page, or
diagnostic output.

## Non-negotiable properties

- Never corrupt a teacher's project, settings, or media vault.
- Never disclose stored credentials through CLI, API, MCP, logs, or UI state.
- Never duplicate product logic in operating-system adapters.
- Never maintain separate semantic implementations for CLI, HTTP, and MCP.
- Never bypass a CAPTCHA, security challenge, or unknown authentication state.
- Never silently coerce malformed LLM output into a different question set.
- Never install hidden persistence or behave like unwanted background software.
- Bind local services to loopback and expose only the authenticated MCP gateway
  through the configured tunnel; keep the local UI and general API private.
- Prefer JavaScript and operating-system primitives over dependencies that do
  not have a compelling reliability or maintenance case.

## Repository layout

```text
blooket-api/
└── src/
    ├── api/          Local orchestration and localhost HTTP boundary
    ├── cli/          Canonical `blooket` command-line interface
    ├── ir/           Typed commands, results, and strict runtime contracts
    ├── mcp/          MCP facade that executes the canonical CLI
    ├── media/        Media vault, metadata, transforms, search, and renditions
    ├── platforms/    macOS host integration over existing capabilities
    ├── projects/     Lesson projects, question documents, and media references
    ├── security/     Credential and secret-storage contracts
    ├── settings/     User configuration, ports, startup behavior, and defaults
    └── ui/
        ├── extension/Optional Safari extension host
        └── general/  Browser UI behavior shared by the local page and extension
```

There is deliberately no generic `core` package. Responsibilities are named for
the problem they own. The repository has exactly one top-level `src/`; domain
packages never contain another `src/`. Product source follows Jig's canonical
`src/<domain>/<function>/<kind>/<part>` route; `kind` is the hexagonal role and
`function` names the capability being implemented.

`src/platforms/` is not a second implementation of the application. It
translates already-defined capabilities into Keychain, Secret Service,
launch-at-login, filesystem, notification, browser, and other host behavior. If
a rule can live outside `src/platforms/`, it must not be copied into per-OS
code.

## One behavior, several transports

`src/ir/` defines canonical commands, results, identifiers, and validation
errors. `src/api/` composes the owning domains and executes those contracts.
`src/cli/` parses command-line input into the same IR and calls the same
application executor.

MCP intentionally does not link another semantic implementation. MCP tools
execute the installed `blooket` CLI in machine-readable mode and decode its
result. That extra process boundary is intentional: an MCP action and the exact
CLI command it represents must be observable as the same operation.

The localhost service serves the browser UI and its HTTP API from the same
origin. HTTP requests decode into the same IR before execution and do not own
separate Blooket behavior. The web host must be declared in the Jig component
graph before UI source is added; the earlier desktop component declaration does
not require a native desktop implementation.

```text
Local browser UI / Safari extension
            |
            v
      localhost API
            |
            v
           api
            ^
            |
CLI --------+-------- canonical IR + executor
 ^
 |
MCP executes CLI
```

Parity tests will exercise equivalent fixtures through direct IR execution, CLI
JSON mode, localhost HTTP, and MCP-to-CLI projection. A transport-specific
semantic result is a defect.

## Required online MCP access

ChatGPT reaches a dedicated local MCP gateway through a stable HTTPS hostname
served by Cloudflare Tunnel. The gateway uses Streamable HTTP and invokes the
canonical CLI in JSON mode. The tunnel provides connectivity, while an
MCP-compatible OAuth flow authorizes access to the configured teacher's tools.

The user provisions the domain, tunnel, and remote-client setup. The gateway
integrates that authorization setup; a tunnel token is not an MCP access token.
Verify the actual account's custom-MCP access and complete a real authenticated
tool call before claiming the integration works.

Only approved MCP routes and required authorization/discovery endpoints are
published. The browser UI, general API, settings, credentials, and arbitrary
local files remain private. Remote writes obey the same validation, teacher
review, confirmation, persisted execution, and recovery rules as local writes.
The Mac must be awake with the service and tunnel running; a lost connection
must not trigger a blind replay of a quiz mutation.

These are product decisions and roadmap requirements, not implemented features.
See [the architecture decision][browser-mcp-adr] for platform verification,
configuration ownership, and integration checks.

## Project documents

A lesson is a directory-backed project. `project.json` owns lesson metadata,
question structure, media requests, and stable media references. The initial
contract is intentionally versioned from the first byte:

```json
{
  "schemaVersion": 1,
  "title": "Lesson 5",
  "description": "Vocabulary review for lesson 5.",
  "quizLanguage": "English",
  "visibility": "private",
  "mediaIndex": "media.jsonl",
  "coverImage": null,
  "questions": []
}
```

`quizLanguage` describes the material students should see. It is independent of
the language used by the teacher to communicate with an agent or the local
browser interface.

## Media vault and descriptions

Binary media never needs to be encoded as text for an LLM. The vault keeps
original assets and produces Blooket-ready renditions separately. Project media
can be represented in a simple JSON Lines index so an agent can inspect many
assets cheaply:

```jsonl
{"id":"sun","path":"media/sun.png","description":"A sun.","english":false}
{"id":"horse","path":"media/horse.png","description":"A horse.","english":false}
```

The canonical `description` is English even when the teacher, source page, file
name, or quiz uses another language. `english` defaults to `false`. It becomes
`true` only after the English description has been explicitly verified;
automatic translation alone does not silently assert that verification.

Origin URLs are not required metadata. The durable minimum is stable identity,
local path, canonical English description, and the verification state of that
description. Immutable source bytes live separately under
`originals/<id>.<source-extension>`; the searchable record points at the
prepared rendition under `media/<id>.<rendition-extension>`.

A question may contain an unresolved image request before a concrete asset has
been selected:

```json
{
  "description": "A clear side view of a yellow school bus.",
  "mediaId": null
}
```

The description states the pedagogical visual requirement. Media resolution can
later bind it to a vault asset without regenerating the question text.

### Agent media search

Agents do not need `rg` to understand the vault. `src/media/` owns a field-aware
searcher and the CLI exposes it in machine-readable form. The intended command
surface is:

```text
blooket media search "yellow school bus" --field description --json
blooket media search "sun" --field id --field description --json
blooket media search "stage" --field description --regex --json
```

Literal, case-insensitive search is the default. Regular expressions are an
explicit option. Field selection is explicit so an agent can search only
`description` without matching IDs, paths, or unrelated metadata. Results are
returned per media asset with its stable ID and file path.

The index remains ordinary UTF-8 text. `rg` therefore remains useful for humans,
diagnostics, and emergency inspection, but product behavior does not depend on
an external ripgrep installation.

## Strict LLM JSON validation

LLM output is untrusted input. TypeScript types do not validate runtime values,
so parsing and semantic validation are separate operations.

JSON syntax is parsed with the JavaScript runtime's native `JSON.parse`. The
project does not carry a third-party JSON parser. Repository-owned decoders in
`src/ir/` then validates the exact versioned contract and returns structured
failures with JSON paths.

Before any Blooket write, validation is fail-closed and proceeds through these
layers:

1. **JSON syntax** — malformed JSON is rejected without recovery guesses.
2. **Envelope** — schema version, document kind, and required top-level fields
   must be exact; unknown fields are rejected unless that schema version
   explicitly admits them.
3. **Primitive types** — strings, booleans, arrays, integers, nullability, and
   enumerations must match exactly. Numeric strings are not coerced.
4. **Question structure** — every question must match one supported question
   variant and contain the exact fields admitted for that variant.
5. **Blooket rules** — multiple-choice questions require primary question text,
   between two and four answer options, and at least one correct option. Typing
   answers carry an admitted matching mode and the required answer data. These
   rules track verified platform capabilities instead of model assumptions.
6. **Media references** — referenced media IDs must exist, resolve to a local
   asset, and have a prepared rendition satisfying the currently verified
   Blooket media capability before upload.
7. **Account capabilities** — features such as answer media are admitted only
   when the current account capability snapshot says they are available.
8. **Cross-field semantics** — mutually exclusive modes, impossible correct
   answer indexes, invalid True/False randomization policies, duplicate stable
   IDs, and other contradictions are rejected before side effects.
9. **Write plan** — decoded bundles, resolved media, and verified account
   capabilities are lowered into an explicit remote-neutral write plan. Plan and
   operation IDs are deterministic from execution-relevant desired state, and a
   versioned sequential checkpoint resumes only against the exact plan. A
   confirmed Create Set receipt durably binds later question operations to one
   opaque remote set ID. Optional verification captures only a pre-attempt item
   count and SHA-256 digest, never raw provider content.

   The Blooket adapter receives the plan, never raw LLM JSON. Stop states and
   ambiguous outcomes preserve progress and recovery data.

Current official Blooket documentation describes two question types: Multiple
Choice and Typing Answer. Multiple Choice currently requires 2–4 answer options
and at least one correct answer. Question images are documented generally, while
answer media is documented under Plus users; the dated official capability
fixture therefore keeps answer images account-dependent until the active account
is inspected.

The authenticated dashboard build verifies a 2,500,000-byte image-upload
ceiling, a 75-character set title limit, and a 300-character description limit.
Canvas dimensions and pixel ceilings remain unknown. These browser-observed
facts stay capability data because Blooket may change them independently of this
repository and the public guides do not publish those numeric limits.

Validation never performs a "helpful" semantic rewrite. An invalid quiz returns
precise diagnostics that the teacher or agent can fix and resubmit.

## Authentication and browser automation

Production credentials are managed locally through the host security capability.
macOS uses Keychain generic-password items. The background service reads needed
secret values internally; UI, CLI, API, and MCP responses never reveal stored
credentials. Tunnel credentials and MCP authorization tokens remain separate
from Blooket credentials and ordinary settings.

Secret values are sent to host tools through stdin rather than process
arguments, command stderr is never retained as diagnostic data, and successful
writes are read back before they are reported as durable. The existing Linux
Secret Service adapter remains development infrastructure, not a supported
product integration.

Development-only environment variables may exist for local testing, but
production credentials do not live in project files or ordinary settings.

Automation operates from the teacher's computer and uses the teacher's own
confirmed session. The browser adapter may behave at normal interactive pacing,
but it is not a CAPTCHA bypass or anti-bot evasion mechanism. A CAPTCHA,
unrecognized login page, unexpected account challenge, or ambiguous destructive
state stops the operation and requests human action.

Blooket navigation uses an explicit state machine rather than an assumed URL
sequence. Browser observations override the state callers expected. Signed-out
and expired sessions request authentication, rate limiting waits without a
guessed retry duration, and dashboard/create/edit states may continue.

The known Blooket organization-selection prompt, security challenges, unexpected
pages, and explicit escalation all require human action. The organization form
must not be filled or submitted automatically.

Session health inspection performs one browser observation and never reads
credentials. Session establishment reuses dashboard/create/edit states and reads
the security-domain Blooket credentials only after observing signed-out or
expired-session. Credentials are passed directly to the browser-session port and
are never included in session results.

Authenticated capability and set reads treat browser-adapter output as
untrusted. Capability observations must decode through the versioned capability
snapshot. Set lists currently expose only an opaque non-empty remote ID and
title; detail adds description and public/private visibility. No remote-ID
grammar, question payload shape, cover read shape, or additional set metadata is
invented without verified browser evidence.

## Settings and port collisions

The local service defaults to `127.0.0.1:2607`. Address and port are user
settings, not constants embedded across the codebase.

Startup probes the configured port before binding. If it is already occupied,
the UI reports the collision and offers either a manually chosen port or an
automatic available-port selection. An automatically selected port is persisted
so clients do not receive a different endpoint on every launch.

The extension must discover the configured local endpoint through an explicit
local contract; it must not assume that port 2607 is permanently available.

### Tunnel configuration and first-use diagnostics

The local UI provides a public MCP hostname field, a masked Cloudflare tunnel
credential field, and Save. Ordinary versioned settings keep the hostname,
enablement, and secret references; the Keychain keeps secret values. The process
reads both internally.

UI responses show configured/missing state without returning saved tokens.
Credential management is local, never an MCP tool.

A lightweight check runs once on first launch and records its check version,
outcome, timestamp, stable failure codes, and local log reference in settings.
It checks only bounded prerequisites such as OS/architecture, settings, local
storage, port availability, native image decoding, and configured service
readiness. It never changes Blooket or runs the full repository test suite.

Missing configuration is reported separately, and failures leave a sanitized
local log for repair. A manual Run diagnostics action can repeat the check. This
startup check is planned; it is not yet implemented.

## Media intake and editing

The local browser page and extension share paste and drag-and-drop behavior. The
Safari extension can send an image selected from a web page directly to the
local service; it never receives Blooket credentials.

Static images may arrive as JPEG, PNG, WebP, AVIF, or another explicitly
supported decoder format. Animated GIFs remain animated. Source bytes are
checked by repository format rules and then fully decoded through the reviewed
Sharp/libvips adapter before durable publication.

The media pipeline keeps the original and creates a fixed-dimension Blooket
rendition separately. Static images use an automatic blurred-background fill
when aspect ratios do not match, with pan and zoom controlling the foreground
crop. Capability snapshot version three carries nullable canvas, output-pixel,
upload-byte, and set-metadata length limits. Version-one and version-two
snapshots migrate facts they predate to unknown instead of guessing values.

Editor state is immutable and uses an explicit bounded undo/redo history. Zoom
one means neutral contain scaling. Pan coordinates are fractions of the canvas:
pan X of one shifts the foreground center by one full canvas width, and pan Y
uses the corresponding canvas height.

Editor rendering reopens the immutable vault original and applies bounded pan,
zoom, contrast, saturation, rectangular blur, and opaque-black redaction. Source
cropping happens before resize so extreme zoom cannot create an unbounded native
intermediate. Animated GIFs run the same bounded operation independently for
every frame, then preserve frame delays, loop state, and duplicate frames when
reassembled. Animated WebP rendition remains fail-closed until equivalent
preservation semantics are implemented and tested.

Edited renditions and metadata replace one another transactionally while the
original is never modified. Each edit is conditional on the media record and
rendition hash loaded before rendering. A concurrent edit therefore returns a
stable conflict instead of silently overwriting newer work. Changing a
description resets its English verification to false unless the caller
explicitly re-verifies the new text.

Media-record persistence is versioned independently of stable media identity.
Canonical version-two JSONL lines store an editable display name separately from
the stable ID used by project references and vault paths. Legacy unversioned
records migrate in memory with their ID as the display name and are not
rewritten merely by reading them. New writes serialize the canonical version-two
form.

The first editor surface is intentionally small: pan, zoom, keyboard nudging,
contrast, saturation, simple rectangular blur/redaction, naming, description,
and undo/redo. Generative fill is not part of the initial contract.

## Reliability and operating-system behavior

macOS is the only product target. Portable logic tests may run on the
development host, including Fedora, without creating a Linux release gate.

macOS-specific behavior still calls shared domain operations. There is no VM
provisioning requirement.

macOS integration remains unverified until first use on the recipient's Mac;
Fedora tests do not validate ARM64 packaging. Metal acceleration is not required
for the initial workflow.

Durable files use write-new, validate, flush, and atomic-replace patterns rather
than editing important JSON in place. Interrupted writes must leave the previous
valid state recoverable. Destructive operations require explicit targets and
must not recursively infer broader paths from LLM-provided text. The exact lock,
backup, temporary-file, flush, and recovery invariants are recorded in the
atomic local persistence ADR: `docs/technical/adr/atomic-local-persistence.md`.

Autostart is opt-in, visible in settings, reversible, and implemented through
the normal platform mechanism. The application must not hide processes, disguise
network listeners, install unrelated startup entries, or recreate disabled
persistence.

## Development

A repository-root `.env` may be used for development and tests only. It is
ignored by Git and is not part of end-user configuration. The supported
development variables are `EMAIL`, `PASSWORD`, and `LOCAL_PORT`. Production
credentials continue to use the host secret store, and persisted local-service
settings remain authoritative outside development/test entry points.

The repository uses a pnpm workspace and strict TypeScript. Dependencies belong
at the narrowest owning package and require a concrete reason to exist.

```sh
pnpm install
pnpm run check
pnpm run test
jig validate --root .
```

Repository documentation, code, identifiers, diagnostics, and commit messages
are written in English. Human communication follows the human's language. An
agent must distinguish that communication language from the requested quiz
language and ask for the quiz language only when it cannot be inferred safely.

See [TODO.md](TODO.md) for implementation order and [AGENTS.md](AGENTS.md) for
agent working rules.

[browser-mcp-adr]: docs/technical/adr/macos-browser-ui-and-online-mcp.md
