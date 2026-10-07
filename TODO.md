# blooket-api TODO

The target is one teacher using a Mac: ChatGPT creates and changes quizzes, the
browser UI manages settings and media, and the local service publishes to
Blooket through authenticated MCP and the user's Cloudflare Tunnel. This is a
working development prototype; publication and native delivery are incomplete.
The shared service must also have a Linux x64 package for developer testing.
Prepare separate macOS ARM64 and Intel packages for the recipient.

The numbered tasks below are the implementation order. Continue from the
existing code and validated behavior, complete each task's acceptance checks,
and update this file with evidence. A supplied configuration, connected tunnel,
or passing portable suite does not complete an unfinished product workflow.

## Accepted media corrections - implement before further feature work

The human clarified the media workflow on 2026-10-06. Record these requirements
first, then reopen the relevant parts of tasks 05-07, 12, and 16 in their
existing order. The current four-field import form and manual oversize workflow
do not satisfy this correction; previous passing checks do not complete it.

Import asks only for an image name and description supplied by the teacher.
The AI owns topic selection and English semantic normalization, including text
originally
written in English. The teacher must see the framed image/GIF immediately and
be able to make it smaller or larger, drag it, and choose blurred or solid
backgrounds before accepting the image.

Static images and GIFs share one enforced output canvas resolution and aspect
ratio. Automatic preparation must produce an actual file strictly below
2,500,000 bytes; resolution/detail optimization comes first, GIF FPS reduction
second when relevant, and color/encoding optimization afterward. The editor
must retain that shared final geometry throughout optimization.

These are pending product changes, not claims about the current implementation.
Keep teacher-authored text intact. New intake source blobs are ephemeral and the
library retains only its optimized canonical WebP/GIF asset; legacy migration
continues preserving historical files for recovery.

Retain actual-byte validation and never label an oversized or unverified
candidate ready for download or publication. The detailed acceptance checks
belong below.

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
read/write, folder selection, native Safari appearance, and filesystem/port
behavior
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

**Pending import and enrichment correction:** every intake path, including
file selection, dragging, and clipboard image/link import, asks only for name
and description. Remove the language selector and comma-separated topic field
from intake; do not move the same questions into another required dialog.
Teacher-authored text remains unchanged; canonical asset paths are internal and
must not become another teacher-facing naming task.

Do not infer the original text language from the workspace's EN/ES setting.
Language identification and topics belong to AI enrichment; missing analysis
stays unknown rather than being invented during import. Review the admitted
metadata contract before allowing an AI language update.

Normalize every description into useful, generalized, descriptive English,
even when the original is already English. Use the description skill from task
16 for consistent semantic ordering and image-grounded topics. Keep normalized
English name/description separate from the teacher's originals.

An English original is not proof that AI normalization has occurred. Record
normalization completion only after the AI's actual output has been validated
and durably saved for the current original revision. Failed, absent, or stale
outputs remain pending/stale; completion is distinct from human verification.
Concurrent original edits must prevent an older result being marked current.

Acceptance includes the two-field form on all intake paths, unchanged original
English and non-English text, generated topics, actual English normalization,
failed-save/revision-race handling, and correct pending/completed/stale states.

Two-field intake was implemented on 2026-10-06. File selection, drag/drop, and
clipboard admission all converge on the same import dialog; that dialog now asks
only for the teacher's name and description. The import application contract
accepts no language or topics, records original language as unknown (empty
string), and starts topics empty instead of inferring either value from the UI
locale.

Revision-safe AI enrichment was implemented on 2026-10-06. `library.enrich`
requires detected language, normalized English name/description, topics, and the
exact current record revision. Completion is derived only after the atomic save:
current generated English plus detected language is `completed`; missing
analysis is `pending`; an older source revision is `stale`.

Teacher text edits clear derived language/topics and make older English stale.
The local media UI shows that state, and manual language/topic maintenance was
removed.

New intake rejects filename authority and keeps only service-owned canonical
WebP/GIF assets with UUID-backed paths. Temporary upload, drag/drop, clipboard,
and downloaded source blobs are discarded after canonicalization. The ordinary
editor no longer exposes filename/folder renaming. Legacy JSONL migration and
its local rename/recovery machinery remain intentionally separate: they preserve
historical files, IDs, paths, and provenance through the durable transfer
journal.

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

Portable migration and rename recovery were implemented on 2026-10-06.
Schema-1 YAML remains readable; migrated schema-2 records retain the legacy
English-verification flag, original revision, source path, and index digest.
Unknown original language stays empty; no translation is invented.

Migration preflights the complete bounded plan before publication, preserves
legacy sources, and archives the exact JSONL bytes as `media.jsonl.migrated`.
User rename preserves IDs, canonical media bytes, text, recipes, and provenance
while invalidating prepared downloads. Neither operation is admitted through
MCP.

Transfer replay runs under the shared library lock at startup or before another
locked operation. A pending journal blocks ordinary library reads, checks hashes
and metadata conflicts, and resumes idempotently without overwriting unrelated
files. Source changes retain the journal for repair instead of guessing success.

Regression tests exercise interrupted publication/archival, unchanged source
bytes, late invalid records, collisions, traversal, symlinks, concurrent
renames, and forbidden remote commands. All 519 portable tests, strict
TypeScript, and
browser-script syntax pass; Jig retains only its external evidence gap.

**External blocker:** no recipient Mac or actual ChatGPT client is available.
Native case/Unicode filesystem behavior and real skill/schema consumption remain
unverified.

Chrome previously passed the now-legacy local rename operation and a prepared
export using synthetic media. Its native migration confirmation stalled browser
inspection;
the complete visual migration workflow remains unverified. Continue independent
editor work in task 06; keep client acceptance pending.

Existing skill and draft tools have logical IDs, revision checks, and recovery
copies; verify how the actual ChatGPT client reads skills and follows the
project
schema. Validate media/account semantics before publication, beyond draft
JSON syntax.

Complete when legacy IDs/bytes/text migrate without loss, legacy rename/move
can recover from interruption, AI updates preserve teacher-authored text, and
initial skills are installed without overwriting personal skills. Verify the
user profile from task 01 can discover and read the resulting skills.

### TODO 06 - Polish the existing image/GIF editor

The intake framing correction was implemented on 2026-10-06. File selection,
drag/drop, clipboard, and downloaded images now open directly in the same editor
used by saved media, using a temporary browser object URL and the current export
defaults. Name, description, zoom, pan, background, adjustments, and export
recipe are visible together before the first durable write.

The import request requires that exact validated `EditRecipe`, and the first
metadata publication stores it atomically with the canonical asset. Cancel
revokes the temporary object URL and publishes nothing. The separate import
dialog and its second pre-editor phase were removed; one canvas/recipe now spans
intake, preview, saved edits, and preparation.

Provide visible minus/plus buttons and a zoom slider that support both
shrinking and enlarging the foreground. A small foreground must remain usable
inside the fixed canvas instead of being forced to cover it. Mouse dragging
moves the foreground; wheel zoom may remain an additional gesture.

Keep saturation and the other individual adjustments in the editor. Show a
background choice between a full-canvas Gaussian-blurred version of the image,
with the intended WhatsApp-like appearance, and a solid color. The foreground
stays sharp and independent of the blurred background's fill transform.

Choosing a solid background should generate a suitable initial color from the
image immediately, using bounded deterministic color analysis. Specify and
test its palette/contrast criteria; do not claim one universally optimal color.
Keep a visible color picker and eyedropper, and preserve the teacher's manual
color override in the recipe rather than replacing it on every preview.

Static-image solid backgrounds now use an 8-by-8 preview sample. Opaque pixels
are grouped into deterministic 4-bit RGB palette bins; the dominant bin wins,
ties use the lower palette key, and extreme luminance is brought into a bounded
48-208 range. The suggestion runs once when entering solid mode, only while
the recipe still has its initial white color. It never replaces a persisted
non-default color, manual color, or eyedropper choice.

Animated representative sampling was implemented on 2026-10-06. The isolated
native worker first validates the whole source, selects at most five frames
spread deterministically across the animation, and reduces each selected frame
to 8-by-8 RGBA before returning samples. The browser computes one dominant
bounded-luminance color across those samples, so the solid background does not
change as the GIF advances.

Pending GIF analysis is tied to the active editor identity. A late result cannot
replace a manual color, an eyedropper choice, or a different image. New GIF
intake reuses its in-flight base64 read for import and retains the one computed
suggestion after canonicalization while that editor remains open. Preview and
preparation use the same selected color, framing, blur, and adjustment recipe.

Acceptance includes a reduced foreground surrounded by both background types,
plus/minus and slider zoom in both directions, drag pan, automatic solid-color
selection and manual overrides, animated previews, and matching final geometry
for static images and GIFs. Preserve keyboard/accessibility checks below.

The prototype already has unified two-field intake/framing, canonical media,
source previews, zoom minus/plus and slider, drag pan, wheel zoom,
saturation/contrast, blurred or solid backgrounds, color input, native
eyedropper/fallback canvas picker, undo/redo, preparation, preview, and
download. Preserve canonical optimized media and per-image edit recipes in YAML;
global settings contain export defaults only.

Finish Safari behavior, keyboard/accessibility and responsive checks, file
chooser/drag-and-drop, GIF preview parity, pixel picking, and both background
modes. Task 03 preserves unsaved configuration on language changes; retain that
behavior. Translate diagnostics, state, and failure
messages fully rather than showing raw English codes in the Spanish UI.

Portable editor changes on 2026-10-06 add live recipe controls with grouped
undo history, keyboard pan/zoom, translated accessible labels and diagnostic
states, and a one-pixel fallback color sample without a full-image canvas.
The stored `lossless` value stays compatible; its visible label now explains
full-color PNG versus the standard GIF palette.

Prepared downloads revalidate the current revision, rendition identity, actual
bounded bytes, format, and canvas dimensions under the shared library lock.
Regression checks reject stale URLs, incorrect format/size, mismatched asset
identity, and a file at the exact 2,500,000-byte ceiling. All 520 portable
tests, strict TypeScript, and browser-script syntax pass.

Changing export defaults must not overwrite existing individual recipes.
The browser framing preview directs the teacher to the prepared file
for final colors, compression, and GIF timing; it does not claim pixel parity.

Chrome subsequently passed zoom buttons, keyboard pan, solid-background
selection, the legacy rename path, preparation, and download readiness
with synthetic media. Editing and rename controls freeze during preparation to
prevent stale asynchronous results replacing a newer image or recipe. The
prepared file was below the byte ceiling; this was not a real Blooket upload.

**Pending:** Safari accessibility, full preview/export
geometry, GIF preview, color picking, and responsive visual acceptance remain
unverified. Continue independent export work in task 07 and retain these
acceptance checks.

Complete when canonical media remains stable, per-image recipes save/reopen,
preview/export agree, and import, zoom/drag, undo/redo, adjustments, both
backgrounds, and color picking work in the target browser. Keep native-browser
checks explicitly pending where no macOS test host is available.

### TODO 07 - Finish bounded exports and the strict media ceiling

**Pending automatic optimization correction:** the teacher should edit the
image and receive a usable prepared result, without manually managing oversized
files. Do not present an invalid candidate as a downloadable/prepared asset or
ask the teacher to solve its byte size through trial and error.

Enforce one configured final canvas width, height, and aspect ratio for both
static images and animated GIFs. Image-specific zoom, pan, backgrounds, and
adjustments remain individual recipes. Define a revision-safe transition for
existing differently sized recipes and invalidate affected prepared results;
never alter original media to migrate the shared canvas policy.

Optimization follows the requested order: lower working/source raster detail
first, then GIF FPS if necessary, then palette/color and encoder compression.
Working-detail reduction must preserve the configured final canvas dimensions
and framing; it must not silently produce different output resolutions for
different files. Record effective parameters rather than claiming the requested
quality/FPS was retained after automatic reduction.

A portable candidate-policy foundation was added on 2026-10-06. It emits a
bounded cumulative sequence: requested settings, working-detail scales of 85%,
70%, 55%, and 40%, lower admitted GIF FPS values, then compact compression only
when the recipe requested lossless output. Static candidates never invent FPS.
The policy does not claim byte success; integration must encode each candidate
in order, preserve final canvas geometry, and persist the effective winner.

Normalize static prepared images to JPEG with the chosen background flattened.
Keep animated media animated and detect actual source frame delays, duration,
and cadence before choosing an explicit output FPS. Variable-delay sources
must not be described as having one uniform detected FPS when they do not.
Use the configured default, initially 10 FPS, and bounded automatic reductions
when required; preserve duration/loop behavior within the documented tolerance.

Make the compression/quality control dynamically admit only prepared choices
that can satisfy the strict byte ceiling. Recompute admission when framing,
background, adjustments, source, or output defaults change; an estimate alone
cannot certify size. Use bounded candidate searches, cancellation, and revision
checks so a slower old calculation cannot replace a newer edit.

Keep the last valid result while a new candidate is being optimized. Show
processing state until actual encoding and byte checks establish the new valid
result; do not expose failed temporary files or enable continuation early.
Remove the ordinary workflow's manual size-warning text once automatic
optimization is implemented.

The output must remain strictly below 2,500,000 bytes, including GIF animation;
2,500,000 bytes exactly fails. If an input is malformed, exceeds admitted
resources, or cannot be represented under the invariant canvas and bounded
quality policy, explain that processing could not finish and retain editable
source state. Do not relax the ceiling or fabricate a valid output.

Acceptance covers static and animated oversize inputs, detected variable GIF
timing, the ordered optimization stages, JPEG normalization, the same final
resolution/aspect ratio for all outputs, dynamically admitted slider values,
rapid edit cancellation, and actual-byte revalidation before every downstream
use. This supersedes manual trial-and-error oversize handling below.

Prepared GIF FPS is explicit, defaults to 10, and currently admits 1, 2, 5, 10,
20, 25, and 50 FPS. The implemented renderer resamples source timing and keeps
loop behavior, with duration/frame/pixel limits. Every output must remain
strictly below 2,500,000 bytes; an equal-sized file is rejected.

Portable export isolation was implemented on 2026-10-06. Image intake,
preparation, legacy editor commands, prepared-download checks, and the native
first-use probe now run untrusted decoding/rendering in a temporary worker.
It receives bytes and bounded values over IPC, without user paths, descriptions,
credentials, or inherited development variables.

Each job has a 20-second deadline, a minimal environment, a 256-MB JavaScript
heap, disabled Sharp cache, and one native processing thread. Heap size is not
a native-memory sandbox; source/output pixel and frame bounds remain explicit.
Timeout, cancellation, malformed replies, and crashes wait for child cleanup
before releasing the caller. Independent service requests remain usable.

Tests cover variable-delay fixed-FPS output, preserved loop state, all admitted
FPS values, duration within one frame interval, frame expansion limits,
601-frame rejection before full decode, killed/stalled workers, cancellation,
secret exclusion, malformed replies, and a successful job after timeout.
Legacy redaction still renders correctly through the worker boundary.

Migration preflight has a 120-second aggregate deadline and shares the legacy
writer lock, including interrupted transfer replay. Canonical old vault records
select their immutable original rather than the prepared working image.
Missing or conflicting originals stop before publication; JPEG and AVIF bytes
survive without conversion and the exact old index remains recoverable.

All 533 portable tests, strict TypeScript, and browser-script syntax passed on
2026-10-06 after these changes. Jig reports only the external
`scalability.repository-graph` evidence gap; repository checks were not
weakened.
Chrome editor acceptance used synthetic local data, without changing Blooket.

**Pending:** native macOS worker/package behavior and accepted resource budgets
need a real target host. Native memory is bounded by admitted work, not an OS
quota. The eventual Blooket upload must independently reject oversized or stale
files in task 11; that concrete upload boundary is not implemented yet.

Implement the automatic optimization correction above and block continuation
until an actual valid file exists. Preserve animation while recording effective
FPS reductions, and never assume 10 FPS alone guarantees size. The current
1280-by-720 default is an application choice, not a verified upstream pixel
requirement; the shared-canvas policy must remain explicit.

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

Portable question-read foundations were added on 2026-10-06. The version-one
read contract normalizes question number/text, `mc`/`typing`, randomization,
seconds, answers/correct answers, typing match modes, and only the presence of
question image/audio media. It deliberately does not retain provider media URLs
or invent remote question IDs. Authenticated `listBlooketQuestions` validates
the opaque set ID before browser or secret access and decodes every adapter
result before returning it.

The field evidence comes from recovered build
`86784c3d4c38fcd559c92f38fbadd7a160947de2`: edit module 12048
(`page-720bc856ab06b26b.js`, factory
`b0c808b1bcf957f7a974ba0a27269e5c4eca8c3a3be0663f0207fc7ad04f8bb4`)
reads `set.questions` and each question's number, question, image, audio,
`qType`, random flag, and `timeLimit`; dependency module 35211
(`6749-987e303c90e94fbf.js`, factory
`b21ec449a8a5bbc90abd132bb6b08de90881ab45ba3654182a4d90690e98b90d`)
also reads answers, correct answers, and answer types. Neither module has a
recorded factory variant. The previously authorized Chrome observation on the
newer build confirmed that changing a private test question to typing with a
15-second limit persisted after reload; keep the two builds distinct.

Question write recovery now captures a normalized question-list digest and can
confirm one exact text-only addition only when removing that candidate
reproduces the pre-write collection. Unchanged state is `not-confirmed`; media
writes, concurrent edits, malformed reads, and ambiguous additions remain
`inconclusive`.

The local browser bridge has a versioned request/response contract, bounded
in-memory broker, bearer-authenticated loopback routes, and API port adapters.
The concrete Chrome worker and page extractor now support session observation,
nonempty My Sets summaries, and the observed private set-detail controls.

The extension discovers the workspace automatically through its isolated local
page relay. It never asks the teacher for an address, pairing code, Blooket
credentials, or a Connect action. The popup shows state and page shortcuts.

Authorized Chrome DOM inspection on 2026-10-06 confirmed My Sets article/h3/Edit
link structure and the detail controls: input#title[name="title"],
textarea#desc[name="desc"], and input#private[name="private"] with role=switch.
The observed unchecked switch displays "Private (Only playable by you)";
the adapter admits only that combination. No public mapping was inferred.

Inspecting the existing synthetic typing question confirmed its visible text,
answer, match mode, and seconds, but did not establish every required question
field. No edits or Save actions were submitted during this inspection.

The unpacked extension compiles with the pinned repository compiler and is
included in native package resources. Synthetic worker tests cover trusted
popup senders, exact loopback configuration, bounded replies, navigation,
unsupported commands, and signed-out page stops. Artifact tests verify emitted
JavaScript imports and the narrow permission set, with no server/secret modules.

Still pending: observed empty-account and pagination contracts;
public set details; capabilities and complete question/media facts; login and
organization-selection states; Safari worker lifecycle. These prevent completion
of task 08 and publication tasks 09-12. Portable doubles are not browser
acceptance, and no live question read-back is claimed.

Initial validation: 572 portable tests, strict TypeScript, browser-script
syntax, and compiled-extension assembly passed. Manual pairing controls were
removed at the human's request; that workflow is superseded by automatic local
workspace discovery, not a product requirement.

Jig reports only the existing external `JIG-RULE-GAP-001`. Package-release
freshness evidence was re-fetched from its configured registry providers.

**Installation blocker:** the browser-control URL policy rejects
`chrome://extensions/` and forbids bypassing it through another control surface.
The human loaded the development extension manually. Future reloads during
development also need that browser action. The real `.env` is unchanged.

The human loaded the extension and reported Chrome registration status 3:
"Top-level await is disallowed in service workers." The worker startup was
corrected to register its listener synchronously, restore session storage
asynchronously, and queue popup actions behind restoration. The artifact test
now requires a synchronous emitted ESM dependency graph, which rejects this
class of startup failure.

The human then confirmed the popup and Disconnected state, establishing worker
message handling. After the automatic-discovery
update, the human confirmed Ready without entering any configuration.

A real extension read through the application adapters returned two IR-validated
set
summaries and found the existing synthetic fixture. Its set-detail read also
passed the IR decoder and confirmed private visibility and the synthetic title,
without logging private lesson names or account values. No Blooket data was
changed.

Final portable checks pass 574 tests, strict TypeScript, and all three browser
script syntax checks. Emitted-worker tests require a synchronous module graph;
workspace relay tests reject unrelated origins, applications, malformed tokens,
and oversized responses. These were portable results; native package evidence
for subsequent revisions is recorded separately below.

The clean Linux archive for commit `eff0feb` subsequently passed extracted
package verification, including the updated automatic-discovery worker,
clipboard helper, icons, launcher, and native media preparation. This proves
that revision only; command composition received its own package check below.

Canonical read composition was implemented on 2026-10-06. The admitted
`blooket.session.inspect`, `blooket.sets.list`, and `blooket.sets.get` commands
share the existing validated application ports through the running local
service. Ordinary CLI syntax and the three matching MCP tools use that path;
MCP still executes the canonical CLI subprocess, never application internals.

Payload decoding rejects unknown fields, credentials, paths, wrong types,
control characters, and oversized IDs before service/browser access.

These reads reuse the existing session without retrieving secrets or
submitting a
login. Signed-out or expired sessions return `blooket-authentication-required`;
rate limits, organization prompts, and challenges preserve their wait/human
states. Missing or stale local instances fail closed. Local requests use exact
loopback discovery, bounded responses, correlation checks, CSRF admission, and
no redirects.

All 589 portable tests and strict TypeScript passed. A synthetic integration
exercised the actual CLI subprocess, local server, browser broker, and MCP tool
projection. The authorized installed Chrome extension then confirmed a ready
session, two IR-validated set summaries, and one private set detail through the
same CLI/MCP projection. No account content, credentials, or IDs were logged or
committed, and no Blooket mutation was performed.

This was a local tool
projection check, not actual ChatGPT or a new public OAuth acceptance run.

Extracted Linux package verification also passed launch/reuse, native media,
profile retrieval, and all three packaged read commands. The read check drives
only its disposable server's authenticated bridge with synthetic session/set
facts, exercises ordinary CLI syntax, and rejects token leakage. This proves
native package composition, not a packaged Chrome/Safari installation or live
Blooket publication.

The development service restarted normally, the workspace reconnected
without configuration, and the configured tunnel returned to connected.
Native Safari, complete questions/media, capabilities, empty accounts,
pagination, public detail, and login remain pending. Their absence still blocks
publication; do not expose unsupported read or write tools as if validated.

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

Apply the two-field intake and normalization requirements from tasks 05-07 to
AI-assisted review. The AI supplies detected language, topics, and structured
normalized English metadata through admitted enrichment operations, preserving
the teacher's original name and description. Canonical asset paths remain
service-owned. Import, English source text, or an unsaved generated response is
not completed normalization.

Verify actual AI image delivery: ChatGPT attachments do not automatically reach
an MCP server. Define the admitted upload/intake workflow, bounds, local review,
and metadata creation. The model enriches detected language, YAML English
fields, and topics; it never chooses asset paths or overwrites original
names/descriptions.

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

On 2026-10-06, managed startup acquired a shared service lock and published a
private instance record. The launcher checks the live instance before reuse,
supports browser opening, status, and CSRF-protected stop, and releases the lock
on shutdown. Linux archive verification passed launch/reuse, native preparation,
the actual packaged CLI, foreign-origin rejection, and owned shutdown with
synthetic data. The real development service and `.env` were not changed.

The packaged Cloudflare connector is resolved beside the runtime; missing-client
and connection-timeout status survive process close. Shutdown still closes the
gateway, local server, runtime record, and service lock when a connector stop
fails. Linux child processes keep only required host-session hints instead of
inheriting development credentials, including when opening the browser.
Launch-at-login and the recipient's native-host lifecycle remain pending.

Complete when first-use runs once, manual rerun repairs its status, start/stop
and opt-in login launch are visible/reversible, and disablement or shutdown
cleans up the gateway/tunnel. Sleep or reconnection must never replay an
ambiguous Blooket write.

### TODO 14 - Package Linux testing and both macOS architectures

The user expanded delivery on 2026-10-06: produce a Linux x64 package for local
development testing plus separate macOS ARM64 and Intel application bundles.
Keep shared behavior identical and label native Mac acceptance unverified.

The Mac app should be draggable to Applications and open the local workspace
on launch, with visible extension setup and service controls. Browser extension
installation requires browser consent. The user restored Safari packaging via
GitHub Actions macOS runners on 2026-10-06.

Release tags use three-month
quarters: vYYYY.Q.PATCH (for example v2026.4.0); macOS ARM64 and Intel are the
default release assets, with optional Linux delivery. Do not claim a download
button silently installs an extension.

The native assembler and quarterly tag validator now exist. Linux delivery has
passed the extracted-package smoke check locally. Hosted CI is deliberately
opt-in: ordinary branch pushes and pull requests do not run it. A `ci-*` tag
runs strict TypeScript, the full portable suite, native package assembly, and
extracted-package smoke checks on macOS ARM64, macOS Intel, and Linux x64 in
parallel.

A quarterly `vYYYY.Q.PATCH` tag runs the release pipeline in strict order. First
the tag and repository variable `RELEASE_ENABLED=true` are required. Next the
same reusable CI workflow validates that exact tagged commit with release mode
enabled; macOS additionally requires the packaged Safari extension, trusted
code signing, and Gatekeeper assessment. Only a green CI result allows the
publish job to download those already-tested artifacts and create the release.

Release itself does not compile, test, package, or reverify.

There is no automated changelog and no committed release-notes file. The
workflow creates empty release notes; the maintainer writes the human notes
manually in the GitHub Release UI. macOS ARM64 and Intel ZIPs are required
assets. Linux is always built and tested and is included only with
`RELEASE_INCLUDE_LINUX=true`.

**Release blockers:** implement and compile the real shared Safari extension;
configure Apple signing and notarization; then run the release workflow and
native acceptance. Release-mode CI currently rejects missing Safari or
untrusted signing. No workflow run, tag, push, signing success, or macOS
acceptance is claimed from Fedora.

Confirm the recipient's OS in About This Mac before installation: the pinned
Node 24 runtime requires macOS 13.5 or later. Bundle runtime,
UI, canonical CLI, native Sharp/libvips artifacts, and the selected cloudflared
delivery method. Record actual signing/Gatekeeper status, third-party notices,
install/update/uninstall behavior, and user-data retention.

Complete when a package can be installed and started on the actual Mac, its
first-use diagnostic reports real results, and the UI, Keychain, native media,
Safari browser session, and tunnel
prerequisites work. Portable Fedora tests do not
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

On 2026-10-06, the workspace gained clipboard image/direct-link intake and a
bounded gallery. It renders at most 12 random suggestions using a partial
shuffle with 12 selections, without copying or sorting the collection. Search
uses precomputed text and pages all matching records in groups of 12.

Chrome verified the supplied brand icon, 12 distinct cards from 25 synthetic
records, another selection, search pagination, and a direct-link clipboard
import through the dialog to the image editor. Ordinary text-field pastes remain
local text edits. Binary clipboard selection has portable component coverage;
native Safari clipboard permission behavior remains unverified.

The direct-link downloader rejects private DNS answers at every redirect, pins
the admitted address for a fresh connection, and sends no cookies or
credentials.
Regression checks cover mixed/private DNS, redirect changes, HTML rejection,
oversized responses, and HTTPS downgrade. It remains a local UI operation,
outside remote MCP commands.

Artwork now feeds workspace/MCP presentation, the compiled extension icons,
and a PNG-backed Mac ICNS. Portable icon checks validate actual dimensions and
ICNS records; Finder appearance still requires macOS acceptance.

Strict TypeScript, browser-script syntax, and all 582 portable tests passed
after these changes, with no failures or skips.

Jig retains the pre-existing `JIG-RULE-GAP-001` for the nonexistent external
`src/repository-model/schema/contract/graph.rs` evidence target. Repository
rules and commit hooks remain enforced; this external finding is not hidden.

On 2026-10-06, strict TypeScript compilation and 482 portable tests passed with
zero failures or skips. Jig retained its external evidence gap. No new runtime
test was performed merely
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

### TODO 16 - Add adaptive teacher workflow skills

**Pending description skill correction:** add a focused description-normalizing
skill and link it from the master workflow and media-enrichment guidance. It
must normalize English originals as well as other languages, without changing
teacher-owned text or naming files.

Use consistent semantic order: primary subject, visible attributes/actions,
setting/composition, then relevant teaching context only when supported. Write
generalized descriptive English suitable for search and quiz matching, derive
useful topics, and avoid invented visual facts or guessed identities.

The skill must read current original metadata and admitted image evidence,
save actual normalized outputs with optimistic revision protection, and mark
completion only after confirmed persistence. If image evidence is unavailable,
report the limitation rather than claiming image-grounded analysis. A later
original-text change invalidates completion for that older source revision.

Verify already-English inputs are genuinely normalized and saved, missing AI
work remains pending, failed saves do not set completion, and original text,
canonical asset identity, and human-verification flags remain intact.

Portable skill foundations were implemented on 2026-10-06. Startup now seeds a
small master index plus workflow-learning, human-validation, browser-image
search, image-bank research, media-analysis, media-description-normalization,
and Codex-access guidance without overwriting personal changes. The description
skill normalizes English and non-English source text with a fixed semantic
ordering, requires admitted evidence for visual claims, and persists only
through revision-protected `library.enrich`. Actual client behavior and
long-term
teacher acceptance remain pending.

Build a lightweight `master-workflow` skill that indexes stable teacher defaults
and points to narrower task-specific skills. Do not put personal information,
credentials, lesson secrets, or account identifiers in repository defaults.
Runtime personal skills remain in the teacher's private data root.

When a teacher explains a reusable workflow, save it as personal guidance so it
does not need to be re-asked on later sessions. For example, a vocabulary
activity may default to one term, one matching GIF, and four options containing
one correct answer plus three distractors. Scope such a rule to that activity
type unless the teacher explicitly makes it universal.

Treat corrections as learning evidence, not automatic permanent rules. Record
provenance and revision history. If the scope of a correction is clear, update
the narrow skill; if it is ambiguous, ask one casual question about whether to
remember it for that type of activity. Ask more setup questions early when
needed, then rely on learned preferences instead of repeating them.

Add task skills for quiz authoring, human validation, direct browser image
search, image-bank research/metadata, media analysis, and Codex repository
access. Image research should use bounded requests, normal provider-supported
access where available, useful source metadata, and respectful request pacing.
Analyze candidate images immediately when admitted tools permit it.

CAPTCHA, security challenge, unfamiliar login, organization selection, consent,
browser permission, or another explicit human checkpoint is always a
human-validation boundary. Preserve the checkpoint, explain the legitimate
local action required, wait for confirmation, then re-read session and remote
state before continuing. Do not solve, bypass, outsource, or silently replay a
CAPTCHA merely because it is surfaced through localhost.

Codex configuration may use broad repository permissions only after explicit
user authorization for that workspace. Skill text cannot itself grant access,
silently escalate permissions, expose secrets, or broaden host authority.

Keep Blooket semantics accurate: Blooket has no remote draft object in this
product model. Local drafts are private recovery/authoring state only. Once
canonical create/edit execution is validated, requested publication should
proceed autonomously unless a real human-validation boundary, ambiguity, or
safety stop is reached.

Complete when the teacher profile reads the master skill first, discovers only
relevant task skills afterward, learns scoped preferences through revision-safe
personal skill updates, preserves corrections without overgeneralizing them,
and resumes autonomous work after explicit human checkpoints without asking
the same settled questions again.
