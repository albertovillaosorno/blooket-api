# blooket-api TODO

The target is one teacher using a Mac: ChatGPT creates and changes quizzes, the
browser UI manages settings and media, and the local service publishes to
Blooket through authenticated MCP and the user's Cloudflare Tunnel. This is a
working development prototype; publication and macOS delivery are incomplete.

The numbered tasks below are the implementation order. Continue from the
existing code and validated behavior, complete each task's acceptance checks,
and update this file with evidence. A supplied configuration, connected tunnel,
or passing portable suite does not complete an unfinished product workflow.

## Current development state

The user has prepared the repository-root `.env` and provisioned the Cloudflare
hostname/tunnel. These are existing development resources; reuse them. Never
copy their credentials, personal values, or private lesson content into docs,
source fixtures, logs, or commits.

The canonical development variables are `BLOOKET_EMAIL`, `BLOOKET_PASSWORD`,
`LOCAL_HTTP_PORT`, `MCP_PUBLIC_URL`, and `CLOUDFLARE_TUNNEL_TOKEN`. The quoted
`.env.example` documents their purpose and URL format. Passwords/tunnel tokens
stay in memory; ordinary development values seed saved preferences at startup.
Normal `npm start` uses saved settings and host secrets without loading `.env`.

```sh
BLOOKET_DATA_HOME="$PWD/.temp/service-test" npm run dev
```

That data root is disposable; create/import fixtures if prior temporary data
has been cleaned. The local UI defaults to port 2607; the separate MCP gateway
uses the running local port plus one, normally 2608.
Point the Cloudflare hostname to `http://127.0.0.1:2608` with its Path filter
empty so MCP, OAuth, and discovery routes can be reached.

`MCP_PUBLIC_URL` requires the full public HTTPS MCP URL, including `/mcp`. The
user's `.env` now uses the supported form and includes an explanatory comment. A
bare hostname is invalid; keep the strict URL contract and read the actual
public URL from local configuration. Credentials were preserved during this
URL-only update.

Legacy `EMAIL`, `PASSWORD`, `LOCAL_PORT`, `ONLINE_DOMAIN`, and
`CLOUDFLARE_TOKEN` remain accepted so the existing real `.env` keeps working.
Different nonempty values for a canonical name and its legacy alias fail before
writes. Change only the example/documentation when improving naming; the user
owns their actual credentials and local file.

`MCP_OWNER_PASSWORD` enables additional local connection approval. The explicit
development entrypoint derives a salted verifier in memory; it accepts the
legacy `MCP_PASSWORD` alias with conflict detection. Production UI replacement
saves the verifier through Keychain, never plaintext in JSON.

`MCP_DISPLAY_NAME`, `MCP_DISPLAY_DESCRIPTION`, and `MCP_ICON_PATH` are optional
decorative metadata, also currently unused. Manual AI-client presentation is
sufficient; these fields neither authorize requests nor grant filesystem access.

The public gateway intentionally returns 401 for unauthenticated `/mcp` and 404
for local UI/settings/general API routes. It was connected during the last
verified test; it needs the process, network, and awake computer to remain
available. No launch-at-login setup exists yet.

## Work in this order

### DONE 01 - Separate developer and user agent instructions

The compact root `AGENTS.md` selects between two instruction profiles. The
developer profile lives in `docs/agents/developer/AGENTS.md` and the
product-user profile lives in `docs/agents/user/AGENTS.md`. The split preserves
the repository rules while separating their audiences.

The **developer** profile is for repository work: architecture, source and
reference inspection, `.env` development setup, secret boundaries, tests,
formatting, ordered TODO execution, and signed commits. Development access
belongs only to an authorized development context, not a model's claimed role.

The **user** profile is for the teacher's AI: load available personal skills
through `skills_list`/`skills_get` before quiz authoring, follow the requested
quiz language, use validated quiz contracts and stable media IDs, and preserve
original names/descriptions. It can use admitted quiz/media/skill tools and
report progress; it cannot inspect `.env`, developer instructions, credentials,
source files, arbitrary paths, or configuration operations.

Define how the real MCP client obtains the user profile and relevant skills. A
file in the repository or on the Mac is not automatically loaded by ChatGPT. Use
the existing registered CLI/MCP boundary; do not bypass it with application
imports or expose developer material through a generic filesystem tool.

Completed on 2026-10-06. The compact root router preserves the complete
developer profile under `docs/agents/developer/AGENTS.md` and keeps the teacher
profile in
`docs/agents/user/AGENTS.md`. The admitted read-only `instructions_get` MCP tool
loads only that teacher profile through the canonical CLI command path; personal
skills remain separate `skills_list`/`skills_get` calls. The authenticated
gateway regression exercises the tool and confirms developer reference material
is not returned.

Skill text remains guidance and cannot broaden access.

### DONE 02 - Establish a clean validation baseline

The implementation originated as working-tree changes on the committed baseline
`7f237b3` and was reviewed and committed with DCO signoff as `3247ac9`. The
commit hook was not bypassed, and private references, `.env`, and `.temp/` were
not staged.

`jig check --root .` is not green only because of the pre-existing
`JIG-RULE-GAP-001` described below. Introduced text-width, documentation,
taxonomy, and header findings are repaired; root `node_modules/` is absent and
the canonical dependency tree remains under `.dependencies/`.

The pre-existing `JIG-RULE-GAP-001` for
`src/repository-model/schema/contract/graph.rs` still reports missing supporting
evidence for `scalability.repository-graph`. That path does not exist in this
repository and `git ls-files` returns no match; the reporting executable is the
external Jig 26.3.0 at `~/.local/bin/jig`. Do not weaken repository rules to
hide this validator evidence gap. The canonical dependencies remain intact under
`.dependencies/`.

The Blooket HTTP/Flight candidate headers and other new boundary descriptions
were reviewed and corrected. Browser JavaScript receives an explicit
`node --check` validation because strict TypeScript compilation does not cover
`app.js`.

The installed pnpm launcher remains an external workstation issue: the launcher
under the user's pnpm home tries to execute the repository store's pnpm ELF
artifact as JavaScript under Node 24 and fails before pnpm starts. It is outside
this repository boundary, so it was not rewritten. npm scripts and the
repository-owned TypeScript compiler work normally. Fresh validation passes 485
portable tests plus strict TypeScript and `node --check` for the browser script;
these do not establish unfinished macOS behavior.

Completed on 2026-10-06 with commit `3247ac9`. Strict TypeScript,
`node --check src/ui/teacher-workspace/adapter-inbound/app.js`, and all 485
portable tests pass on the committed HEAD. Jig configuration is valid and every
introduced finding is repaired; Jig itself remains non-green only for the
external `JIG-RULE-GAP-001` evidence gap documented above.

### TODO 03 - Finish settings and the development configuration contract

Schema-3 preferences, local Save, EN/ES controls, masked secret replacement,
online enablement, public MCP URL, media-root selection, and export defaults are
implemented. Password configuration uses the canonical `blooket.password` secret
key; the configured session boundary supplies saved email without exposing
credentials or changing unrelated legacy secret contracts.

The portable configuration work was completed on 2026-10-06. Startup honors
saved IPv4/IPv6 loopback binding and fixed/automatic port policy, handles the
final bind race, and durably saves a selected automatic port. The online gateway
uses the running local port even when a changed port awaits restart; port 65535
cannot silently redirect the gateway to an unrelated default.

Settings Save validates every replacement's UTF-8 byte limit before writes,
holds an aggregate writer lock, and reports secret/settings partial failures.
Ordinary preference writes have their own lock and recovery copy; initial
defaults use create-if-absent instead of overwriting a concurrent save. Changing
the library root initializes the selected location without moving old assets.

The configured session entrypoint uses ordinary saved email with the canonical
password secret. Existing callers retain their legacy login-key behavior.
Light/dark/system themes and automatic-port controls are available in both UI
languages. Language changes and diagnostic reruns preserve unsaved settings.

Explicit startup remains a background process without automatically opening a
browser. Preserved lifecycle flags do not install autostart; bootstrap reports
an enabled but unimplemented launch-at-login preference. Visible native
lifecycle implementation remains task 13.

Portable checks cover byte limits, partial host/filesystem failures, concurrent
saves, library-root preservation, URL rejection, configured login, and actual
port collisions. Strict TypeScript and browser-script syntax pass; all 493 tests
pass. Chrome verified saving the dark theme and changing EN/ES without losing
an unsaved synthetic email.

**External blocker:** no recipient macOS host is available. Native Keychain
read/write, folder selection, Safari appearance, and filesystem/port behavior
still require the actual Mac. Keep this task pending for those checks; continue
independent authorization work in task 04 rather than claiming native coverage.

Keep `MCP_PUBLIC_URL` as a full HTTPS `/mcp` URL and preserve its explanatory
comment in the development template. Test rejection of bare hostnames,
credentials, unexpected paths, query/fragment values, and unsafe schemes;
normalization of a bare hostname is outside the agreed configuration.

Complete when ordinary settings migrate safely, local Save reports partial
failures accurately, valid development configuration starts, and global export
defaults remain separate from every individual image recipe. Record native
Keychain/folder tests as pending until they actually run on macOS.

### TODO 04 - Finish OAuth and additional owner-password approval

Portable authorization implementation was completed on 2026-10-06. Online
startup requires a configured owner verifier; local approval checks the owner
password before issuing a code. Development retains the verifier only in
memory. Production configuration writes a fixed-parameter salted scrypt
verifier through the host store and exposes only configured/missing status.

The local UI shows the exact connection ID, client registration ID, untrusted
name, redirect URL, and requested scope. It supports rejection and individual
revocation of access and refresh tokens. Password attempts share a five-per-
minute budget and one in-flight verification; polling preserves typed input.
Owner replacement reloads/revokes existing access even after a partial settings
save.

OAuth does not replace the local password check.

Token issuance now preserves approved scope and creates refresh tokens only
for requested `offline_access`. Single-use codes, expiry, duplicate parameter
rejection, exact resource/redirect binding, refresh rotation, and individual
revocation have regression coverage. Repeated approval cannot replace a code.
Unused client registrations expire after 15 minutes instead of permanently
exhausting capacity.

Shutdown is serialized with reload and prevents later
restart through a racing request.

All 503 portable tests, strict TypeScript, and browser-script syntax pass. The
composition test exercises wrong/correct passwords through a real local gateway
with an in-memory tunnel double; no real credentials or public connection are
used. Native Keychain and actual ChatGPT compatibility are not established.

**External blocker:** acceptance still needs the recipient's Mac and actual
ChatGPT client. The chosen restart policy is to clear all in-memory clients,
codes, and tokens and require new registration/consent. Verify that client can
reauthorize after restart, sleep, and tunnel interruption before completing this
task. Continue independent library work in task 05 meanwhile.

The user prefers an additional password because a client could present a
misleading name or domain. Preserve OAuth/PKCE for client compatibility and
require the configured owner password as an additional approval check in the
local UI. Do not replace OAuth with a password in URLs, tool arguments, or an
assumed custom header that ChatGPT may not support.

Keep development owner overrides behind the explicit entrypoint. Preserve the
masked local replacement workflow and Keychain verifier boundary; never return
the password or verifier through UI/API/CLI/MCP results. Keep this credential
separate from Blooket and the tunnel token.

Treat registered client names and redirect domains as untrusted input, not proof
of identity. Show the exact client, redirect, requested access, and matching
connection identifier before approval. Verify the actual ChatGPT registration
and redirect contract; restrict allowed clients/redirects to the teacher's
explicit choices without guessing them from a display name.

Test PKCE, state round-tripping, resource/audience binding, exact redirects,
code reuse, expiry, access revocation, refresh rotation, hostile registration,
wrong passwords, and bounded attempts. A password alone does not prevent a
phishing page from asking for it. Retain HTTPS, exact origin checks, local
consent, and private settings isolation.

Preserve the implemented scope, expiry, single-approval, and revocation guards.
No broader access may be inferred from a client display name or redirect.

Current clients, codes, and tokens live only in memory. Test actual ChatGPT
reauthorization after
service restart, Mac sleep, and tunnel interruption. Do not replay ambiguous
Blooket writes on reconnection.

The user offered other repositories with MCP implementations as examples.
Inspect a user-identified repository if supplied; compare its actual client
compatibility and credential boundaries rather than copying an auth mechanism
blindly. No example repository has been selected or inspected yet.

Complete when approved clients receive only their admitted access, rejected or
revoked clients cannot call tools, owner-password verification works locally,
and the actual AI client completes a compatible authorization flow. Keep the
tunnel credential, owner password, and Blooket password independent.

### TODO 05 - Complete the library migration and personal skills

Mirrored `metadata/<full-original-filename>.yaml` and immutable user-named
`photos/` assets are implemented with bounded YAML parsing, atomic saves,
revision protection, stable IDs, and separate generated English metadata.
Complete existing JSONL migration and user rename/move with atomic recovery,
collision handling, preserved bytes/IDs, and mirrored paths.

Portable library foundations were extended on 2026-10-06. Logical IDs now admit
legacy dots and 128-character IDs while preserving current UUIDs. MCP search
uses bounded pages with a stable-ID continuation cursor; the legacy small-list
command remains compatible and rejects oversized results explicitly.

Filesystem enumeration bounds depth, entries, records, per-file YAML size, and
aggregate metadata bytes. Regression checks cover duplicate YAML keys, aliases,
symlink metadata, large paginated results, same-stem files with different actual
formats, and legacy IDs. Invalid saved drafts fail their exact decoder.

Service startup installs the bundled quiz-authoring and media-enrichment skills
only when absent, preserving personal modifications. Tests exercise skill
retrieval and the bundled quiz example through the canonical command path. All
508 portable tests and strict TypeScript pass; Jig has only its documented
external evidence gap.

Next, implement recoverable legacy JSONL migration and user rename/move.
Preserve legacy English-verification information without treating it as an
inferred language or generated translation. Add interrupted-transaction,
collision, and concurrent-operation checks before calling migration complete.

Existing skill and draft tools have logical IDs, revision checks, and recovery
copies; verify how the actual ChatGPT client reads skills and follows the project
schema. Validate media/account semantics before publication, beyond draft
JSON syntax.

Complete when legacy IDs/bytes/text migrate without loss, user rename/move can
recover from interruption, AI updates preserve user-owned fields, and initial
skills are installed without overwriting personal skills. Verify the user
profile from task 01 can discover and read the resulting skills.

### TODO 06 - Polish the existing image/GIF editor

The prototype already has import naming/descriptions/topics, source previews,
zoom minus/plus and slider, drag pan, wheel zoom, saturation/contrast, blurred
or solid backgrounds, color input, native eyedropper/fallback canvas picker,
undo/redo, preparation, preview, and download. Preserve immutable originals and
per-image edit recipes in YAML; global settings contain export defaults only.

Finish Safari behavior, keyboard/accessibility and responsive checks, file
chooser/drag-and-drop, GIF preview parity, pixel picking, and both background
modes. Task 03 preserves unsaved configuration on language changes; retain that
behavior. Translate diagnostics, state, and failure
messages fully rather than showing raw English codes in the Spanish UI.

Rename the current `lossless` UI label to an accurate quality description for
GIF quantization, or provide a format-specific explanation. Changing export
defaults must not overwrite existing individual recipes. Confirm preview and
export geometry agree and stale prepared files cannot be offered for download.

Complete when source bytes remain unchanged, per-image recipes save/reopen,
preview/export agree, and import, zoom/drag, undo/redo, adjustments, both
backgrounds, and color picking work in the target browser. Keep native-browser
checks explicitly pending where no macOS test host is available.

### TODO 07 - Finish bounded exports and the strict media ceiling

Prepared GIF FPS is explicit, defaults to 10, and currently admits 1, 2, 5, 10,
20, 25, and 50 FPS. The implemented renderer resamples source timing and keeps
loop behavior, with duration/frame/pixel limits. Every output must remain
strictly below 2,500,000 bytes; an equal-sized file is rejected.

Expand tests for variable-delay GIFs, short clips, loop preservation, duration
within one frame interval, alternate FPS, frame/pixel ceilings, and prepared
cache invalidation. Add a bounded native-work timeout/isolation; rendering still
runs native work inside the service process. Make failures actionable and keep
independent service operations usable after an editor failure.

Provide bounded optimization or clear controls when media exceeds the ceiling;
block preparation/upload continuation until valid. Never silently change the
requested animation, assume 10 FPS guarantees size, or invent Blooket
dimensions. The current 1280-by-720 default is an application choice, not a
verified upstream pixel requirement.

Complete when explicit FPS, duration/loop/resource bounds, and failure recovery
are tested, and an output of 2,500,000 bytes or more cannot advance to upload.
Recheck actual bytes and recipe freshness at the eventual upload boundary;
metadata or a successful preview alone is insufficient.

### TODO 08 - Implement authenticated Blooket session and read adapters

Implement concrete macOS session, capability, My Sets, and set-detail surfaces
behind their existing ports. Reuse the teacher's confirmed browser session and
validate account capabilities, question/media reads, and navigation states
through the existing IR decoders. Keep unknown limits unknown.

Connect ordinary saved email and the secret-store credential boundary when login
is needed. Preserve CAPTCHA, organization selection, unfamiliar login, loading,
expired-session, and human-stop states. Session data and cookies must remain
inside the browser/security boundary.

Complete when fresh validated remote state can be read reliably, capability
changes are detected, and a missing/challenged session returns the appropriate
stop instead of fabricated data or a mutation. These reads establish the
baselines needed for publication and conflict detection.

### TODO 09 - Validate HTTP actions and implement the browser fallback

The current observed Blooket build is
`4e10e84779aaa361fd4310c02366e37ebee7b60d`. Keep this evidence distinct from
older captures in `reference/curated/`. Use the recovered references according
to `AGENTS.md`; never import their code into production.

Observed actions include create set, add question, and update question. Create
posts multipart fields to `/create`; add/update post to `/edit` with the set
context. The initial Flight form state is `UNSET` with message and field errors.
The private creation checkbox is omitted for a private quiz; its UI label is
inverted relative to the field name, so do not infer visibility from the name.

Record sanitized synthetic payload fixtures for title/description, set ID,
question JSON, answers/correct answers, `mc`/`typing`, match modes, and seconds.
Add tests for payload lowering, private/public semantics, update IDs, and media
unsupported cases. The candidate helper currently supports only text create/add;
update hashes alone do not implement editing.

The real action response body was not recovered: attempts to retrieve it through
the browser tool failed. HTTP 200 and UI read-back are not a decoded response
contract. Capture and validate actual response shapes before activating HTTP
writes, and never treat `SUCCESS` inferred from client code as observed
evidence.

Complete bounded Flight decoding: strict primitive validation, text byte-length
syntax, shared-reference resolution, cycles/limits, error/redirect records, and
synthetic tests. The current candidate coerces status through `String()` and
replaces repeated graph objects with null; neither is production-ready.

Implement concrete write surfaces using the session/read adapters from task 08.
Confirm authentication, current build, account capabilities, and the exact
payload before a mutation; preserve every human-stop state.

Prefer HTTP only for an admitted, currently verified operation. Use the browser
fallback for unsupported operations before sending a mutation. A timeout or
ambiguous primary result must enter journal reconciliation, never an immediate
fallback or retry that can duplicate a quiz/question.

Complete when every admitted transport has tested payload and response
contracts, unsupported cases select fallback before mutation, and ambiguous
writes enter reconciliation. Action hashes and HTTP 200 alone do not establish a
stable server API or confirmed write.

### TODO 10 - Add manual interaction pacing and challenge recovery

The user's request concerns Blooket interaction timing, not the MCP's writing
style. Navigate, fill, and submit in the normal browser sequence; wait for page
readiness and confirmation between actions instead of issuing a burst of work.
Apply the same conservative pacing to admitted HTTP actions.

Use one shared per-account mutation queue across MCP, CLI, and local UI, with
only one write in flight. Proposed application defaults are at least two seconds
between mutation starts and at most 20 starts in a rolling minute. These are
application choices, not verified Blooket limits or a guarantee against account
restrictions; use stricter verified provider limits when known.

Make pacing, mutations per minute, task mutation budget, and maximum task
duration configurable within bounded ranges. Persist progress and yield with a
clear status when a task budget is exhausted; do not silently drop operations.
Keep pause/cancel responsive and apply provider retry guidance when available.

Count attempts as well as confirmed writes, prevent parallel clients from
evading the shared limit, and never retry or switch transports after an
ambiguous mutation without reconciliation. Stop on rate-limit or challenge
states rather than accelerating, guessing success, or hiding automation.

Test serialization, rolling-window limits, task budgets, cancellation, restart,
and interruptions using an injected clock. Verify normal browser ordering and
read-back; pauses alone are not evidence that a mutation succeeded.

If a CAPTCHA or security challenge appears during the local browser workflow,
preserve the checkpoint, return `human-action-required`, and show the actual
page/origin that needs attention. Let the teacher complete the challenge locally
and resume only after observing legitimate completion. The user has not observed
a CAPTCHA; do not invent one or add a localhost CAPTCHA merely for first-use
diagnostics.

Any assistant attempt to solve a displayed CAPTCHA requires the user's explicit
confirmation at that moment; a general request to finish the workflow is not
advance approval. Provide assistance only within that confirmed interaction.
Never bypass the challenge, use solving services, forge validation, transfer
challenge/session secrets through MCP, or suppress unfamiliar login stops.

Test the stop/notification/resume behavior with synthetic challenge states,
including challenges reached from localhost that actually belong to Blooket or
another authentication provider. Revalidate session and remote write state
afterward, without automatically replaying an ambiguous operation.

Complete when all entrypoints share the mutation budget, waits/cancellation
preserve checkpoints, and challenge completion resumes only from verified
session and remote state. Treat the proposed pacing as application defaults, not
verified provider limits or protection against account restrictions.

### TODO 11 - Connect create/edit to journaled canonical execution

Use the existing validated IR, write-plan lowering, persisted attempt journals,
checkpoints, receipts, locks, read-back, and reconciliation. Do not add a second
unprotected publication loop. Extend remote reads to validated question/media
state and detect concurrent online edits before changing a quiz.

Expose canonical CLI commands and MCP tools for list/read/create/edit, question
type, per-question seconds, stable-ID media selection, progress, and recovery.
Fresh verified Blooket state and the teacher's online request drive changes;
local draft JSON remains private automatic recovery state.

Resolve prepared media by stable ID and validate current recipe revision, actual
file format, and actual bytes before every upload. Upload only a prepared
rendition strictly below 2,500,000 bytes, never a larger original or stale file.
Reuse the same guard in UI, CLI, HTTP, browser, and MCP execution.

Run an approved small publication through this application's actual MCP/CLI
runtime, read it back after refresh, and test interruption, recovery, ambiguity,
account limits, and unsupported types. The existing private UI test is useful
evidence but does not replace this missing end-to-end flow.

Complete when canonical execution can create and edit an admitted quiz, confirm
remote IDs/questions/media after reload, detect conflicts, and recover safely
from interruption. Require the same validation, media ceiling, and pacing for
MCP, CLI, HTTP, and browser entrypoints.

### TODO 12 - Finish AI media intake and browser quiz review

Verify actual AI image delivery: ChatGPT attachments do not automatically reach
an MCP server. Define the admitted upload/intake workflow, bounds, local review,
and metadata creation. The model enriches YAML English fields/topics; it never
chooses source filenames or overwrites original names/descriptions.

Expose validated quiz list/read/create/edit, question type/seconds/media,
progress, and recovery through registered CLI commands and MCP tools. Keep local
JSON as automatic private drafts/execution state rather than requiring manual
file management or treating it as authority over fresh Blooket state.

Finish quiz review, publication, progress, cancellation, and recovery in the
browser UI. The current draft view is read-only and explicitly says publication
is pending. Translate remaining states and actionable errors into English and
Spanish, preserving quiz and original-media language independently.

Complete when the teacher and AI can review a generated quiz with stable-ID
media, publish it through task 11, change its admitted fields, and see verified
results. Confirm remote skills and admitted image delivery with the actual
client rather than assuming files or attachments are available.

### TODO 13 - Finish diagnostics and background/tunnel lifecycle

The lightweight first-use check, persisted `diagnostics.json`, sanitized local
log, and manual rerun exist. It checks runtime, host, settings/storage, a tiny
native image round-trip, and secret-client presence. Complete settings linkage,
port and configured tunnel prerequisites, and meaningful Keychain availability
checks without saving real credentials or mutating Blooket.

Test that first-use runs once, failed attempts remain repairable, logs are
bounded, and the recipient sees useful translated failures. Existing macOS
status remains unverified until the actual Mac runs it.

Shutdown/reload serialization and terminal stop were implemented and tested in
task 04. Preserve useful
`cloudflared-unavailable`/timeout failure codes instead of overwriting them with
a generic close/offline state. Test disablement, restart, early exit, missing
executable/token, sleep/offline behavior, and process cleanup.

Add visible stop/start and optional, reversible launch-at-login through ordinary
macOS facilities.

Complete when first-use runs once, manual rerun repairs its status, start/stop
and opt-in login launch are visible/reversible, and disablement or shutdown
cleans up the gateway/tunnel. Sleep or reconnection must never replay an
ambiguous Blooket write.

### TODO 14 - Package the recipient's macOS architecture

Confirm chip and OS in About This Mac before final packaging; ARM64 is
provisional and x86-64 is needed only for an Intel recipient. Bundle runtime,
UI, canonical CLI, native Sharp/libvips artifacts, and the selected cloudflared
delivery method. Record actual signing/Gatekeeper status, third-party notices,
install/update/uninstall behavior, and user-data retention.

Complete when a package can be installed and started on the actual Mac, its
first-use diagnostic reports real results, and the UI, Keychain, native media,
browser session, and tunnel prerequisites work. Portable Fedora tests do not
establish macOS compatibility.

### TODO 15 - Accept the complete teacher workflow

Use the recipient's actual Mac and configured ChatGPT account to authorize, load
the user profile and personal skills, receive an admitted image, find and edit
media, prepare a quiz, publish it, and change question type/seconds/media. Read
the final Blooket state back after refresh.

Test restart, sleep/offline, interrupted writes, recovery, revoked access,
oversized media, and concurrent remote changes. Keep failures actionable and
logs sanitized. A first-use diagnostic establishes only its narrow checks.

Complete when this real workflow and recovery exercise pass, remaining release
blockers are resolved, and the user receives concise installation/usage
instructions. Only then call the initial product usable and complete.

## Recorded verification and evidence

On 2026-10-06, strict TypeScript compilation and 482 portable tests passed with
zero failures or skips. Jig was not green; task 02 records the outstanding
introduced and pre-existing findings. No new runtime test was performed merely
to reorganize this roadmap.

The actual configured tunnel passed OAuth/PKCE with local approval, MCP
initialization/tool discovery, and a `skills_list` call through the canonical
CLI. It used a synthetic client, not ChatGPT. Public UI/settings routes returned
404 and unauthorized MCP returned 401; the test did not visit the callback or
send its test code to another destination.

The Chrome UI loaded, switched EN/ES configuration, and prepared a disposable
static-image edit with zoom and solid background. Preview/download worked.
Import was exercised through the local API because the Chrome file chooser
lacked file URL permission; no browser security setting was changed.

A private one-question quiz was created through the authorized Blooket UI and
changed from multiple choice to typing with a 15-second limit. Its final type
and time persisted after reload. Request fields were observed; the action
response body and application-driven publication were not verified.

The private test quiz remains in the account; do not delete it automatically or
commit its ID/account content. Temporary captures and logs may be cleaned
between sessions. The durable conclusions are recorded here; do not assume an
ignored fixture still exists. The configuration regression log is currently
under `.temp/readme-ui-check/full-tests.log`.

### Implementation map

- Browser UI/API: `src/ui/teacher-workspace/` and `src/api/browser-service/`.
- Preferences/configuration: `src/settings/teacher-preferences/`,
  `src/api/teacher-configuration/`, and `src/platforms/user-storage/`.
- Library/skills/drafts: `src/api/teacher-library/` and
  `src/platforms/user-library/`.
- Image/GIF output: `src/media/image-renditions/` and `src/media/gif-timeline/`.
- CLI/MCP: `src/cli/json-command-process/` and `src/mcp/`.
- Background process/tunnel: `src/service/` and
  `src/platforms/cloudflare-tunnel/`.
- Unintegrated HTTP/Flight candidates: `src/api/blooket-http-actions/` and
  `src/ir/blooket-flight-records/`.

Existing MCP tools provide library search/read/enrichment, personal skill
list/read/write, and recoverable draft list/read/write. Drafts are not published
quizzes. Continue these implementations rather than recreating their already
validated foundations.
