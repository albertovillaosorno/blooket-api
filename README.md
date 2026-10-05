# blooket-api

> Project started: October 5, 2026

**A local-first TypeScript toolkit for teachers who want to build, validate,
prepare, and publish Blooket question sets without turning lesson authoring into
browser busywork.**

blooket-api keeps lesson projects, media, settings, credentials, and browser
sessions on the teacher's own computer. One canonical command model is exposed
through the `blooket` CLI, a localhost API for interactive clients, and an
optional MCP facade. A desktop interface and optional browser extension make
media intake and ordinary classroom use convenient without creating another
implementation of the product.

The primary desktop target is macOS and the primary browser integration is
Safari. Linux is the portable development and test baseline and may initially
expose fewer host-specific conveniences. Windows is deferred until the macOS
contract is stable.

This project is not affiliated with or endorsed by Blooket. Blooket automation
is an unsupported integration boundary. The application must preserve local
projects when that boundary changes, stop for security challenges it does not
understand, and never expose credentials to an LLM, MCP caller, browser page,
or diagnostic output.

## Non-negotiable properties

- Never corrupt a teacher's project, settings, or media vault.
- Never disclose stored credentials through CLI, API, MCP, logs, or UI state.
- Never duplicate product logic in operating-system adapters.
- Never maintain separate semantic implementations for CLI, HTTP, and MCP.
- Never bypass a CAPTCHA, security challenge, or unknown authentication state.
- Never silently coerce malformed LLM output into a different question set.
- Never install hidden persistence or behave like unwanted background software.
- Bind the local service to loopback by default and make remote exposure an
  explicit future capability rather than an accidental bind-address change.
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
    ├── platforms/    macOS/Linux interpretation of existing capabilities only
    ├── projects/     Lesson projects, question documents, and media references
    ├── security/     Credential and secret-storage contracts
    ├── settings/     User configuration, ports, startup behavior, and defaults
    └── ui/
        ├── desktop/  Desktop-only UI and host integration
        ├── extension/Optional browser extension; Safari is the primary target
        └── general/  Browser-safe UI behavior shared by both interfaces
```

There is deliberately no generic `core` package. Responsibilities are named for
the problem they own. The repository has exactly one top-level `src/`; domain
packages never contain another `src/`. Product source follows Jig's canonical
`src/<domain>/<function>/<kind>/<part>` route; `kind` is the hexagonal role and
`function` names the capability being implemented.

`src/platforms/` is not a second implementation of the application. It
translates already-defined capabilities into Keychain, Secret Service,
launch-at-login,
filesystem, notification, browser, and other host behavior. If a rule can live
outside `src/platforms/`, it must not be copied into per-OS code.

## One behavior, several transports

`src/ir/` defines canonical commands, results, identifiers, and validation
errors. `src/api/` composes the owning domains and executes those contracts.
`src/cli/` parses command-line input into the same IR and calls the same
application executor.

MCP intentionally does not link another semantic implementation. MCP tools
execute the installed `blooket` CLI in machine-readable mode and decode its
result. That extra process boundary is intentional: an MCP action and the exact
CLI command it represents must be observable as the same operation.

The localhost HTTP API exists for the desktop UI and browser extension. HTTP
requests decode into the same IR before execution and do not own separate
Blooket behavior.

```text
Desktop / Safari extension
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
the language used by the teacher to communicate with an agent or the desktop
application.

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
name, or quiz uses another language. `english` defaults to
`false`. It becomes `true` only after the English description has been
explicitly verified; automatic translation alone does not silently assert that
verification.

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
9. **Write plan** — validated documents are lowered into an explicit write plan.
   The Blooket adapter receives the plan, never raw LLM JSON.

Current official Blooket documentation describes two question types: Multiple
Choice and Typing Answer. Multiple Choice currently requires 2–4 answer options
and at least one correct answer. Platform details are treated as capability data
because Blooket may change them independently of this repository.

Validation never performs a "helpful" semantic rewrite. An invalid quiz returns
precise diagnostics that the teacher or agent can fix and resubmit.

## Authentication and browser automation

Credentials are entered through the local application and stored through the
host security capability. Development-only environment variables may exist for
local testing, but production credentials do not live in project files or
ordinary settings.

Automation operates from the teacher's computer and uses the teacher's own
confirmed session. The browser adapter may behave at normal interactive pacing,
but it is not a CAPTCHA bypass or anti-bot evasion mechanism. A CAPTCHA,
unrecognized login page, unexpected account challenge, or ambiguous destructive
state stops the operation and requests human action.

The known Blooket organization-selection prompt is a recognized navigation state
that must not be filled or submitted automatically.

## Settings and port collisions

The local service defaults to `127.0.0.1:2607`. Address and port are user
settings, not constants embedded across the codebase.

Startup probes the configured port before binding. If it is already occupied,
the UI reports the collision and offers either a manually chosen port or an
automatic available-port selection. An automatically selected port is persisted
so clients do not receive a different endpoint on every launch.

The extension must discover the configured local endpoint through an explicit
local contract; it must not assume that port 2607 is permanently available.

## Media intake and editing

Desktop and extension surfaces both support paste and drag-and-drop. The Safari
extension can send an image selected from a web page directly to the local
service; it never receives Blooket credentials.

Static images may arrive as JPEG, PNG, WebP, AVIF, or another explicitly
supported decoder format. Animated GIFs remain animated. Source bytes are
checked by repository format rules and then fully decoded through the reviewed
Sharp/libvips adapter before durable publication.

The media pipeline keeps the original and creates a fixed-dimension Blooket
rendition separately. Static images use an automatic blurred-background fill
when aspect ratios do not match, with pan and zoom controlling the foreground
crop. Capability snapshot version two carries nullable canvas, output-pixel, and
upload-byte limits; legacy version-one snapshots migrate those facts to unknown
instead of guessing values.

Editor state is immutable and uses an explicit bounded undo/redo history. Zoom
one means neutral contain scaling. Pan coordinates are fractions of the canvas:
pan X of one shifts the foreground center by one full canvas width, and pan Y
uses the corresponding canvas height.

Static editor rendering reopens the immutable vault original and applies bounded
pan, zoom, contrast, saturation, rectangular blur, and opaque-black redaction.
Source cropping happens before resize so extreme zoom cannot create an
unbounded native intermediate. Edited renditions and metadata replace one
another transactionally while the original is never modified.

Each edit is conditional on the media record and rendition hash loaded before
rendering. A concurrent edit therefore returns a stable conflict instead of
silently overwriting newer work. Changing a description resets its English
verification to false unless the caller explicitly re-verifies the new text.

The first editor surface is intentionally small: pan, zoom, keyboard nudging,
contrast, saturation, simple rectangular blur/redaction, naming, description,
and undo/redo. Generative fill is not part of the initial contract. Animated
editing remains fail-closed, and persisted display names still need a versioned
schema separate from the stable media ID.

## Reliability and operating-system behavior

macOS is the product-quality target. Linux receives enough support to develop,
test, validate portable behavior, and exercise the application on a real host.
macOS-specific behavior must still call shared domain operations rather than
forking application logic.

Durable files use write-new, validate, flush, and atomic-replace patterns rather
than editing important JSON in place. Interrupted writes must leave the previous
valid state recoverable. Destructive operations require explicit targets and
must not recursively infer broader paths from LLM-provided text. The exact
lock, backup, temporary-file, flush, and recovery invariants are recorded in
the atomic local persistence ADR:
`docs/technical/adr/atomic-local-persistence.md`.

Autostart is opt-in, visible in settings, reversible, and implemented
through the normal platform mechanism. The application must not hide processes,
disguise
network listeners, install unrelated startup entries, or recreate disabled
persistence.

## Development

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
