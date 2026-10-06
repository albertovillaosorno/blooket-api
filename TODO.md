# blooket-api TODO

Only unfinished work belongs here. The target is one teacher using a Mac:
ChatGPT prepares and changes quizzes, the browser UI manages configuration and
media, and the local service publishes to Blooket through online MCP.

The user provisions Cloudflare Tunnel and the ChatGPT connection. macOS is the
only product target. Keep useful portable tests without requiring Linux
packaging, host behavior, or a VM.

## P1 — User settings, library, and skills

### TODO - Define user storage and migrate settings

Resolve the macOS user Application Support directory and place `settings.json`,
`skills/`, private execution state, and diagnostics under its `blooket-api/`
subdirectory. Use a versioned, atomically persisted settings contract. Default
media storage to `media/` beside settings and allow the teacher to select
another library root without moving existing assets silently.

Settings include Blooket email, Keychain secret references, local port, UI
locale (`en` or `es`), online MCP enablement, public MCP URL, media root, and
advanced editor defaults. Store the password and Cloudflare tunnel token in
Keychain, not JSON. The UI saves both kinds of values through one local
operation and shows configured/missing status without returning stored secrets.

Migrate existing theme, port mode, lifecycle, and credential settings
explicitly. Validate filesystem targets, port collisions, and partial
secret/settings saves. Expose no remote settings or secret-management tool.

### TODO - Implement configuration UI in English and Spanish

Provide English/Spanish i18n for labels, actions, status, and validation errors.
Offer email, masked password, local port, media-folder selection, and an Online
MCP toggle. Enable the public URL and masked Cloudflare token fields only when
online MCP is enabled; accept the user's HTTPS URL including `/mcp`.

Support only Cloudflare Tunnel for online connectivity. Preserve saved online
configuration while disabled, stop the tunnel when disabled, and start it only
from an explicitly enabled valid configuration. Show Save results and useful
field errors in the selected UI language. UI locale does not change quiz or
original media-description language.

### TODO - Implement mirrored YAML media metadata

Store user-named source assets under `media/photos/` and one YAML document under
`media/metadata/` with the same relative directories. Append `.yaml` to the full
asset filename so `cat.jpg` and `cat.gif` cannot share a metadata path. Preserve
source bytes and stable asset identity independently of filenames.

Define a versioned YAML contract with stable ID, service-owned asset reference,
original name/description/language, topics, generated English name/description,
source revision, and generation/verification status. Preserve original text in
any language. AI enrichment adds English text without overwriting originals,
renaming files, or claiming human verification.

User rename/move operations update the mirrored YAML and references atomically;
AI metadata operations address stable IDs and cannot choose filesystem paths.
Reject filename traversal and handle collisions visibly. Migrate existing JSONL
records without losing assets; an optional search index is derived from YAML,
not a second authoritative metadata store. Use a reviewed YAML parser with
bounded input and exact runtime decoding rather than a homemade YAML parser.

### TODO - Store and expose personal teacher skills

Ship initial quiz-authoring skills and store personalized skills under the
user-data `skills/` directory. Allow authorized MCP operations to list, read,
create, and update skill text through logical IDs with local history/recovery.
No arbitrary shell, file paths, executable installation, or secret access is
part of these tools.

Teach the AI to use the library's stable IDs, topics, original text, and
generated English metadata. Verify how the actual ChatGPT connection supplies
skill text; placing files on the Mac alone does not make ChatGPT discover them.
Treat skill content as user guidance, never as permission to change access or
leak secrets.

## P2 — Shared image and GIF editor

### TODO - Add simple zoom, drag, and color controls

Use a visible zoom slider with minus/plus buttons; mouse-wheel zoom remains an
optional equivalent input. Dragging the image moves its foreground inside the
shared canvas. Static images and GIFs use the same pan, zoom, saturation,
contrast, preview, and undo/redo controls.

Offer blurred-background fill and solid-color fill with a color input and an
eyedropper. Feature-detect browser eyedropper support and provide a canvas pixel
picker when unavailable. Picking a color must work on the recipient's browser.
Keep source bytes untouched and save edits as settings plus prepared renditions.

### TODO - Normalize GIFs to an explicit frame rate

Define the output frame rate in Advanced settings, defaulting to 10 FPS. Every
prepared GIF uses that selected rate; do not implicitly preserve source timing.
At 10 FPS, encode 100 ms per output frame and resample the source timeline so
playback duration and loop behavior remain stable within the selected frame
interval. Changing FPS invalidates affected cached renditions, not originals.

Validate allowed FPS and resource bounds. Apply the same canvas/background/edit
state to each output frame. Bound frame count, total pixels, duration, output
bytes, and native work. Add meaningful tests for variable-delay input, short
clips, loop behavior, resampling, and byte-limit failures.

### TODO - Prepare media for verified Blooket limits

Produce a consistent target aspect ratio from verified capability dimensions for
both static and animated media. Keep unknown Blooket canvas/pixel limits
unknown. Optimize prepared bytes within bounded work and the verified upload
ceiling; return an actionable failure if the selected GIF cannot fit without
changing requested behavior. Do not promise every GIF will fit merely by using
10 FPS.

## P3 — Verified Blooket transport and quiz operations

### TODO - Validate HTTP-first integration and browser fallback

Prefer verified authenticated HTTP operations, including dashboard server
actions where their current request/response contract is established. Keep the
existing browser execution boundary as fallback for unsupported operations.
Record build, route, method, arguments, authentication requirements, response
shape, confirmation, and expiry/change behavior for each admitted operation.

Current evidence finds dashboard RSC reads, internal image API paths, and
Next.js server-action references; it does not establish a public or beta quiz
API. Continue from real client/network evidence instead of guessed endpoints.
Before mutation, establish session reuse and the exact payload decoder.

Never fall back after an ambiguous write without reconciliation: the primary
request may already have succeeded. Preserve remote set receipts, persisted
baselines, checkpoints, verification, and human-stop navigation states.

### TODO - Complete capabilities, reads, create, and edit

Complete concrete session and set reads, including questions and media when
verified. Bind account-dependent capabilities and unknown limits explicitly.
Implement create/edit operations, admitted question types, answers, per-question
time, media selection, and read-back confirmation from the same validated IR.

Online requests are the teacher's active workflow, while local quiz JSON is a
recoverable draft/cache and execution record. Keep local copies private and
automatic; do not require the teacher to manage files or treat stale local
content as authority over fresh verified remote state. Resolve concurrent edits
before writes rather than silently replacing online changes.

## P4 — Local API, canonical CLI, and online MCP

### TODO - Complete canonical transport coverage

Extend the CLI over the shared executor and serve browser UI plus HTTP API from
one loopback origin. Map local and remote MCP tools to registered CLI commands
in JSON mode; online clients use Streamable HTTP. Keep parity for validation,
media/metadata search, quiz operations, progress, and recovery.

### TODO - Connect the configured Cloudflare Tunnel

Run cloudflared against a dedicated MCP gateway using the saved tunnel token.
Use the user-provided HTTPS hostname/path and authorization configuration.
Publish only admitted MCP and required authorization routes; the local UI,
settings, credentials, and general API stay private. No cloud account or domain
provisioning is part of the application.

Show ready/offline/configuration-error state, allow local disablement, and read
secrets internally. Keep Blooket credentials, tunnel tokens, and MCP access
credentials separate. Sleeping or offline Macs must produce unavailable status
without replaying ambiguous writes.

### TODO - Implement online AI media and teacher workflow tools

Allow the AI to receive an image through a transport verified with ChatGPT,
register it locally, inspect/search metadata, enrich English descriptions and
topics, generate a quiz, change question types/timing, and select assets by ID.
Verify actual image delivery and permitted formats; do not assume attachments
arrive at an MCP server automatically.

Expose progress and diagnostics without secrets. Support authorized personal
skill updates beside the user's settings and media. Test the actual ChatGPT
connection through an authenticated read and an approved small quiz publication,
including read-back, failure, interruption, and recovery.

## P5 — Browser workflow and macOS delivery

### TODO - Complete the browser review and media workflow

Provide drag-and-drop import, user naming, descriptions in any language, topics,
media preview/editing, quiz review, and execution progress. Reuse UI behavior
between the local page and optional Safari extension; declare the browser host
in Jig before adding source and retire the unused desktop host declaration.

### TODO - Implement optional Safari intake and background lifecycle

Add direct web-image intake and an extension entrypoint that can open the same
UI. Add visible start/stop and opt-in launch-at-login behavior for the service.
The initial workflow requires no separate desktop window or permanent Dock icon.

### TODO - Package the recipient's macOS architecture

Confirm chip and OS version before final packaging; ARM64 is provisional and
x86-64 is needed only if her Mac is Intel. Bundle runtime, UI, CLI, native image
artifacts, and the selected cloudflared delivery method. Document actual
Gatekeeper/signing status and third-party notices accurately.

### TODO - Run first-use diagnostics once and retain repair logs

Run a bounded first-launch check of architecture/runtime, settings decoding,
user-data/media storage, local port, native image decode, Keychain availability,
and configured service/tunnel prerequisites. Missing configuration is distinct
from a dependency failure. Do not change Blooket or write real credentials.

Persist check version, outcome, timestamp, stable failure codes, and log
reference in settings after the first attempt. Keep logs sanitized and bounded,
with a manual rerun action after repair; do not run the full suite every launch.
No VM provisioning is required. Label macOS behavior unverified until it runs on
her Mac and keep independent features usable when one prerequisite fails.
