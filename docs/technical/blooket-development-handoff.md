# Blooket development without a browser

This guide records bounded evidence and the next implementation boundaries.
Read `AGENTS.md`, the complete developer profile, `TODO.md`, and the owning
record first. It does not declare quiz publication or automatic installation
complete. The human's current instructions determine account-mutation and Git
authority; this document cannot grant either to another session.

## Evidence and upstream documentation

Use Web Search when available to verify current external documentation before
changing provider behavior. Prefer official Blooket help, browser vendor/MDN
Web API documentation, Node documentation, GitHub documentation, and Apple
platform documentation. Record the exact supporting page and inspection date.
Third-party tutorials and search snippets do not establish private API payloads,
account entitlements, server limits, or successful product execution.

Useful starting points:

- [Blooket question sets][question-sets].
- [File selection][file-input].
- [GitHub releases](https://docs.github.com/en/rest/releases/releases).
- [GitHub release assets](https://docs.github.com/en/rest/releases/assets).

The [official question-type guide][question-types], checked on 2026-10-08,
describes multiple-choice and typing questions and marks audio as a Plus
feature. Resolve the actual account gate through the existing
capability probe; documentation alone cannot enable a feature for an account.
Use exact references in the capability fixture for the established limits.

Local `reference/curated/` may be available even when a browser is not. Follow
the developer profile's recovery-manifest, validation, build, module,
dependency, and variant instructions before using it. Never execute captures or
import them into the product.

Captured build
`86784c3d4c38fcd559c92f38fbadd7a160947de2` is distinct from subsequent browser
observations. Recovered server-action references do not contain the server's
implementation or prove a stable HTTP response contract.

## Authorized Chrome observations on 2026-10-08

Two private fictional development sets were created through the website UI.
No account name, set identifier, provider media URL, photo, or authenticated
capture belongs in this guide or a committed fixture.

| Surface | Verified website observation |
| --- | --- |
| Account menu | Unique hidden Logout and visible profile link. |
| Create Set | Checked switch says Public; unchecked says Private. |
| Edit header | Reloaded empty and two-card sets show 0 and 2 Questions. |
| Add Question | Two buttons; list button has Show all answers as a peer. |
| Existing question | Accessible card contains its nested Edit button. |
| Multiple choice | Two text answers and 15 seconds persisted. |
| Typing | Contains, its text answer, and 10 seconds persisted. |
| Question image | An owner-selected image persisted after save/reload. |
| URL image | Public repository PNG persisted in a third question. |
| Audio | This test account displayed the Plus upgrade drawer. |
| Image drawer | Advertises < 2.5 MB and gallery/URL/file sources. |

Use these observations to scope controls and check count/card agreement.
Keep the exact privacy inversion and question match/timing semantics.
UI persistence supports selector evidence; it does not prove canonical product
CLI/MCP publication or media identity.

A subsequent authorized Chrome check completed the public repository image
test through Upload by URL without opening the operating-system file picker.
Save Question returned a third card, and a fresh reload retained all three
questions, both images, and the original owner-selected photo.

Reopening the third card confirmed its fictional typing prompt, accepted
answer, Is Exactly mode, 20-second limit, and rendered repository icon.
The editor was canceled without changes. This verifies website persistence,
not the product's pending media transport or CLI/MCP publication.

Automatic local-file selection through the development browser tool was blocked
by the browser extension's file-access permission. The account owner selected
one image manually and explicitly requested its preservation. This failure is
separate from the product's unimplemented media transport. Do not use the
teacher's operating-system file picker as an unattended publication primitive.

## Where to continue

The current browser page functions live in
`src/platforms/blooket-browser/adapter-outbound/`; their serialized functions
must be self-contained. Mirror tests in the matching `tests/` route and rebuild
the actual worker closure with the distribution extension test. Direct calls
alone do not catch unavailable module variables after Chrome serialization.

The extension hosts live in
`src/service/browser-extension/adapter-inbound/`. Existing read-owned metadata,
question, and capability panels must yield to trusted human interaction.
Navigation must preserve existing editors; unconfirmed opener/Cancel outcomes
must not authorize route restoration. A model-controlled DOM marker does not
prove ownership.

Do not Save, submit, or dismiss a teacher-owned editor during
a read-only request.

Concrete text Create Set/Add Question surfaces already compose into
`src/api/browser-service/adapter-inbound/blooket-runtime.ts`. They are internal
ports. Canonical text-only creation now uses
`src/ir/blooket-publication-commands/contract/commands.ts` and
`src/api/blooket-write-execution/application/command.ts` over the persisted
executor. The saved draft ID and revision freeze an immutable recovery snapshot;
external callers cannot choose checkpoint paths.

CLI `publication step <draft-id> <revision> --json` performs at most one
journaled write. `publication status`, `publication reconcile`, and
`publication verify` accept a draft ID; only a successful fresh final verify
returns `published: true`. MCP exposes the corresponding
`blooket_publication_*` tools through its ordinary CLI subprocess boundary.

Portable integration crosses the actual MCP, CLI subprocess, localhost service,
journals, and simulated browser bridge. It is not live provider acceptance.
Media and editing existing quizzes remain pending. A legacy loaded extension
returning bare My Sets arrays fails `blooket-browser-incompatible`; replace it
with the current assembled worker before testing canonical publication.

As checked on 2026-10-08, Chrome can omit Origin on bridge GET while supplying
it on POST. The current worker sends `x-blooket-browser-client` with its
canonical runtime root on both requests; the loopback service refuses unlabeled
workers before dispatch. The bearer token remains the authentication boundary.
Update synthetic HTTP clients together with the worker, and do not infer a
verified extension version from this transport label.

The owner supplied Chrome DevTools CLI 1.10.1 for explicit development reloads.
It controls a separate Chrome for Testing profile, which may not share the
owner's authenticated window. A real installed/reloaded current worker passed
canonical signed-out inspection on 2026-10-08.

Authenticated reads stopped because the separate profile's login token request
returned 403. The site
reported "Could not get CSRF token". This requires a normal confirmed session,
not a security bypass or a fabricated token.

A later check on 2026-10-08 confirmed the owner's original Chrome session
still displayed its development sets while the local workspace reported an
incompatible extension. The dedicated CLI reconnected to an empty browser with
no extension worker. Do not confuse successful administration in its separate
profile with reloading the authenticated window.

The owner reported a Cloudflare verification in the separate testing workflow.
[Cloudflare's supported-browser guidance][challenge-browsers], checked on
2026-10-08, says automated browsers are unsupported for solving production
challenges; this does not establish the cause of this particular 403. Prefer
the existing confirmed session and preserve every provider/human stop.

Current acceptance needs a current worker in the authenticated window.
Browser control cannot administer its blocked internal extensions page, and
the dedicated CLI has not established control of that window. Do not copy
cookies, reuse clearance tokens, disguise automation, or relax compatibility
to substitute for the owner's normal extension update.

Browser-tool extension-management restrictions
remain applicable to that tool; use an explicitly authorized dedicated reload
operation rather than navigating a blocked internal browser page.

Use `src/api/blooket-write-execution/application/execute-persisted.ts`, the
shared mutation pacer, task budgets, prepared-media admission, journals,
checkpoints, and reconciliation. Caller/model data must never choose durable
paths. An uncertain write must retain its attempt journal and require explicit
reconciliation before replay or transport fallback.

Recovered module 89770 provides the image drawer and mutually exclusive
question media state. Its dependency 13286 assigns a File through DataTransfer
into a form file input, or stores an admitted URL as text. This is client
mechanics evidence only.

A future direct file adapter must carry the exact
prepared byte snapshot, validate the live form/slot, and prove the resulting
remote identity before reporting publication. Avoid opening a native chooser.
Do not treat `hasImage`, a URL hash, or a local preview as content equality.

On 2026-10-09, the emitted product image reader ran in the authenticated
Chrome tab's isolated world against an owned existing question modal. Its
credential-free CORS GET read 82,377 bytes from the saved test image and
reproduced the independently observed SHA-256 digest. The modal was canceled
without saving; the owner's separate question photo was preserved.

`question-image-page.ts` now performs this bounded read behind the existing
question inspection host. It admits only the exact HTTPS media origin, omits
credentials and referrers, refuses redirects, bypasses the browser cache, and
bounds time, bytes, and stream chunks. Check current Fetch behavior against
[MDN RequestInit][request-init], inspected on 2026-10-09.

Version-four question reads carry `imageEvidence` as byte length plus digest,
or explicit null when media is unreadable. Version-one/two migration and
version-three text reads preserve their existing representation; they never
gain fabricated identity. The reader rechecks its owned form, exact raw value,
human-interaction watch, authentication, route, and question facts across
asynchronous image extraction.

Differential write baselines now include saved question-image identity.
An image replacement cannot masquerade as an unchanged prior question;
presence-only images, unreadable images, audio, and answer images without
identity cannot establish a preservation baseline. Plain-text baselines retain
their old digest for existing recovery journals.

The authorized observation proves the emitted image reader on one saved
question, not a newly loaded extension, file upload, or canonical publication.
The corrected prepared-file transport still needs live acceptance, and initial
media capture remains pending. The durable identity composition described below
does not open the media gate; never remove it based on read evidence alone.

The internal Add Question bridge now admits one exact prepared PNG/JPEG/GIF
byte envelope. Only job delivery allows four megabytes for base64 expansion;
other responses retain their previous cap. The broker bounds the complete
serialized delivery before leasing a job.

Source paths, arbitrary filenames,
URLs, SVG, question audio, and answer images remain unadmitted. Canonical
publication still refuses new media mutations pending initial capture and live
prepared-file acceptance. Its version-two snapshot now binds immutable expected
identity into recovery and final verification.

My Sets nonempty collection completeness remains unknown. Do not turn a stable
visible subset into a complete baseline for ambiguous Create Set recovery.
The existing count-confirmed question reader does not resolve set pagination.

## Background execution

MCP invokes the bundled Node runtime directly with piped input/output and
`shell: false`. The launcher starts the service with ignored standard streams;
the native login helper also uses null streams and `--no-open`. Neither path
opens Terminal or grants a remote shell tool.

The main Mac executable is a compiled Swift wrapper rather than a shell script.
It queries/registers/removes its bundled agent through `SMAppService` only for
exact local login commands. The local Settings page shows actual approval and
supports removal; its portable tests inject native status explicitly and do not
claim a native Mac execution. Ordinary preference saves cannot register agents.

The [Node child-process contract][child-process], checked on 2026-10-08,
distinguishes direct process creation from shell invocation. Preserve this
background behavior when adding updater restart and lifecycle controls.
Native macOS/Safari visual assurance belongs to the final ongoing record.

`npm test` bounds independent test-process concurrency to four. The unbounded
run exhausted host capacity and produced deadline failures; bounding parallel
processes keeps the same tests, process isolation, and production deadlines.

## Updates and delivery

The `manifest.ts` adapter in `src/platforms/update-downloads/adapter-outbound/`
retrieves the fixed signed release manifest, bounded to one megabyte and ten
seconds, with local publisher trust. `download.ts` stages the authenticated
archive with byte/hash
checks. Both share anonymous restricted redirect transport and response cleanup.
These primitives do not install, replace, restart, or establish Apple trust.

The separate `update-signatures/adapter-outbound/apple.ts` adapter checks the
signed release context, a local Apple publisher Team ID, exact bundle metadata,
OS/runtime compatibility, strict code signing, and notarized Gatekeeper
acceptance. Its portable command doubles pass; no real Mac artifact has been
accepted. It requires private immutable staging and safe transactional
installation, and is not connected to product installation controls.

The extraction adapter in `src/platforms/update-extraction/` authenticates a
private ZIP snapshot, inventories paths/links/payloads, performs silent native
extraction, and validates/freezes the result. Portable tests inject Linux
decompression;
unsupported extra fields, foreign paths, corrupt bytes, and late writers fail
safely. This is staging evidence only, with no installation or Apple trust.

The `bundle-exchange` adapter and delivered C helper retain both app directories
through one atomic exchange. Its portable tests compile and execute Linux's
native exchange mechanism; Darwin uses `renameatx_np` and remains theoretical
until native assurance in P4. Lost acknowledgement and cancellation return the
observed orientation after the writer stops, never permission for blind replay.
Package assembly now requires the system C compiler (`cc` on Linux,
`xcrun clang` on macOS); no compiler/toolchain is downloaded or duplicated.

The update record owns product staging integration, Apple verification,
transactional replacement, restart, and rollback acceptance. Production
publisher keys and
signed manifest publication remain missing. The inspected repository Actions
secrets/variables were empty; do not fabricate release credentials. Current
Safari CI uses unsigned development compilation, not distribution signing.

Keep teacher data and the old usable application throughout failure recovery.
Do not enable installation or replace the application based only on a checksum,
a GitHub digest, a successful Linux build, or an unsigned development package.

## Reproducible portable checks

Run from the exact repository root on main and preserve existing changes:

```sh
npm run check
npm run roadmap:check
npm test
jig doctor --root "$PWD"
jig check --root "$PWD"
```

Use affected mirrored tests during development. The full test suite also checks
emitted browser code and cleans its own fixture directories. Reuse existing
repository dependencies/caches and avoid overwriting existing distributions.

The installed Jig currently reports no repository policy diagnostics, but its
repository-graph rule remains `not-evaluated` because the validator's graph
schema/migration contract is not authoritative. Doctor reports degraded absent
graph/install state. Report this exact limitation; do not weaken the gate or
modify a sibling repository to hide it.

A portable pass does not fulfill live extension/CLI/MCP publication or online
teacher acceptance. Required updater installation/restart/rollback behavior must
also have functional evidence; an implemented catalog checker alone is not an
updater. Native Mac/Safari checks belong to the final ongoing record and their
unavailability must not block completion of P2/P3 functional work.
[question-sets]:
  https://help.blooket.com/hc/en-us/sections/15973931458967-Question-Sets
<!-- jig-ignore-next-line: Preserve the exact official Blooket article URL. -->
[question-types]: https://help.blooket.com/hc/en-us/articles/36295087097751-Question-Types-Explained
[file-input]:
  https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/files

[child-process]: https://nodejs.org/api/child_process.html

[request-init]: https://developer.mozilla.org/en-US/docs/Web/API/RequestInit

<!-- jig-ignore-next-line: Preserve the official browser-support source URL. -->
[challenge-browsers]: https://developers.cloudflare.com/cloudflare-challenges/reference/supported-browsers/

## Human browser challenge handoff (2026-10-09)

Cloudflare's [supported browsers documentation][cf-supported] states that
browser automation frameworks are not supported for completing production
challenges. It also warns that embedded browsers have limited support and that
extensions changing the user agent, Canvas, or WebGL can interfere with
verification. Its [challenge troubleshooting guide][cf-troubleshooting]
identifies network issues, cookie or JavaScript restrictions, other extensions,
and detection errors as potential causes of challenge loops. These are provider
limitations, not evidence of a defective checkbox or license to spoof a
browser fingerprint.

The local Quizzes view now offers two explicit human actions. **Show connected
tab** sends a bounded, credential-free `browser.activate` job to the existing
paired extension, preserving that browser's ordinary account session. **Open
Blooket in my browser** uses only the operating system's default browser
opener with a fixed Blooket dashboard URL; it never supplies a profile,
user-agent override, debugging flag, cookie, or account secret. If the default
browser is different from the connected extension's browser, the user must
enable the extension in the browser where verification was completed; solving a
challenge in one profile does not authenticate a different one.

The extension additionally brings forward its owned Blooket tab when it first
observes a challenge interstitial title or confirms the challenge in a read.
Repeated observations do not repeatedly steal focus. This action never
clicks a provider challenge, sends credentials, or interprets window activation
as authenticated readiness. A native `WKWebView` was not selected as the main
verification surface because it would have separate cookies and weaker
provider compatibility; macOS still uses its existing lightweight native
launcher plus the already-installed system browser.

Positive evidence covers strict local request admission, synthetic worker
focus and duplicate-suppression tests, visible bilingual browser controls in
Chrome for Testing, the compiled extension closure, and extracted Linux package
smoke. No authenticated provider read after a solved Cloudflare challenge is
claimed. Final real-account acceptance remains dependent on a genuine human
session in a supported browser with the Blooket API extension enabled.

<!-- jig-ignore-next-line: Official browser-support URL is indivisible. -->
[cf-supported]: https://developers.cloudflare.com/cloudflare-challenges/reference/supported-browsers/
<!-- jig-ignore-next-line: Official challenge-support URL is indivisible. -->
[cf-troubleshooting]: https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/

## Paired-session read check and multiple-profile safety (2026-10-09)

The Quizzes panel includes **Check My Sets read**. It performs only an
explicit paired `session.observe`, then `sets.list` when the observed route
is recognized as ready. The response contains no set names, account IDs,
cookies, passwords, media, or URLs.

It reports human stops without a list attempt; unknown read completeness
stays explicitly unknown. The service
runs the canonical exact set-summary decoder before showing a count.

Separate browser profiles can have different Blooket cookies even when they
install the same Blooket API extension ID. The extension saves an anonymous
UUID in its own profile-local extension storage and sends it as a strictly
validated suffix to its existing browser-client label. The service tracks
short-lived identified client leases, rejects ambiguous new requests when
more than one distinct profile is actively polling, and exposes a safe
boolean UI warning.

In-flight dispatched jobs remain bound to their exact client label. Legacy
clients without a profile suffix are accepted for
compatibility but cannot be distinguished if they share an extension ID.

The extension also remembers the numeric ID of its product-created Blooket
tab in profile-local storage. After an extension reload, it reclaims that
tab only if the recorded ID still exists at an admitted Blooket origin.
It never adopts an arbitrary teacher-owned browser tab. The actual isolated
Chrome for Testing smoke confirmed that subsequent extension reloads kept
the same Blooket tab count instead of creating another challenge tab.

The read-check workflow is verified by synthetic bridge/HTTP tests and by
Chrome for Testing returning the provider's `security-challenge` state on
a real Blooket page. Those observations demonstrate an honest human stop,
not authenticated My Sets access, successful Cloudflare verification, or
permission to publish a quiz.

## Reconnection and challenge-classification follow-up (2026-10-09)

An exact `Just a moment...` document title at either admitted Blooket origin
is now an actionable `security-challenge` during `session.observe`, even when
Cloudflare has replaced the original verification heading after a manual
checkbox interaction. Other read operations remain failures; the old
authenticated shell cannot be read through an interstitial. This does not
click, automate, or bypass the challenge.

A healthy extension connection now refuses unsolicited workspace announcements
from a different local service. Announcements from the same service with a
rotated token remain valid, and a disconnected old service may be replaced.
The worker also confirms that its connected tab is still at an admitted
Blooket origin before reusing it after a workspace announcement; a tab that
was navigated elsewhere cannot become a read or write target.

The browser bridge command source previously contained literal ASCII control
bytes inside title/description character-class regular expressions.
Those bytes were changed to equivalent printable `\\xHH` escapes, and
regression tests cover rejected controls and allowed multiline descriptions.
The committed parent revision also contains raw controls, so text-mode Git
comparison (`git diff -a`) is still needed until the source is committed.

The isolated Chrome for Testing 155 smoke reached the provider's real
security-challenge stop; it did not produce authenticated My Sets data.
An additional Chrome DevTools daemon became unresponsive during an extension
reload probe and its exact owned processes were terminated. Neither that
unconfirmed reload probe nor synthetic snapshots establish successful human
challenge completion. Keep the first authenticated-read acceptance open.

## Tab recovery and workspace ownership (2026-10-09, later session)

The extension now validates the Blooket origin before reusing the current
connected tab or restoring a stored tab after a worker restart. A closed tab,
a replaced tab, or malformed session-storage connection cannot become the
target for authenticated reads or writes. The owner-created tab reference
remains profile-local and does not grant access to arbitrary teacher tabs.

A live connection also remains bound to its healthy local workspace when
multiple Blooket API workspace pages announce their services. An authorized
token rotation on that same origin is still admitted so a pairing reset can
retire old work safely; a failed or unavailable prior connection may be
replaced. Worker regressions cover a competing local service and interrupted
form actions during token rotation.

The observed provider page sometimes changes its visible verification heading
while retaining the exact Cloudflare `Just a moment...` title. The safe
classifier therefore treats this title at the two admitted Blooket origins as
a `security-challenge` human stop, never as authenticated set data. Actual
Chrome for Testing 155 still returned a human-action-required challenge,
not a successful authenticated read.

## Post-read challenge handoff and safe tab reuse (2026-10-09)

The local Quizzes readiness button now distinguishes a provider challenge
that appears **during** My Sets reading from a challenge observed **before**
that read. If the first read fails with the exact stable browser-failed code,
the service performs one non-mutating session observation.

A confirmed signed out, organization, unfamiliar-page, or
security-challenge result is surfaced
as an interrupted read with an actionable human stop. The failed set read is
never replayed and no credentials are accessed. Unavailable reads do not
trigger the extra observation, and an unconfirmed follow-up remains unknown.

The extension's explicit popup focus command now reports a failure when the
stored tab is no longer at Blooket instead of returning a false success. The
startup restoration path reports its validated saved connection as connected
without waiting for a new CLI job; stale or malformed stored connections
remain rejected even when optional storage cleanup fails.

An owned numeric tab ID retained in profile-local extension storage can be
recycled by Chrome across browser restarts. The extension therefore only
reclaims an old stored ID at an exact ordinary My Sets or login landing
route, with no unexpected search/hash. It does not reclaim a recycled ID at
Edit or Create, even if it is still a Blooket origin. A synthetic regression
confirms that an existing teacher editor is not adopted or navigated away.

Chrome for Testing 155 with a freshly built unpacked extension and isolated
local service confirmed the honest `security-challenge` UI stop in the local
Quizzes view and the extension popup's attention-required state. A synthetic
UI-only response confirmed the interrupted-read wording in both English and
Spanish. Neither result proves an authenticated My Sets read or Cloudflare
clearance. The Mac/Safari release target remains untested on this Linux host.

### Cloudflare query and tab restoration

Chrome may append a one-time `__cf_chl_rt_tk` query to the provider's My Sets
landing URL while the document title still reads `Just a moment...`. A tab
with that exact single query can now survive an extension reload without a
second challenge tab. The rule does not accept custom query names, duplicates,
search filters, Edit, Create, an unexpected hash, or arbitrary titles.

Synthetic worker tests cover both the retained provider challenge tab and
rejected teacher-editing or ambiguous routes. The provider query value is
neither persisted anew nor exposed in an API response. This does not mean the
challenge was solved or that the browser acquired an authenticated session.


## Prepared-file correction and current browser availability (2026-10-09)

An authorized emitted-host test submitted one fictional text question but
Blooket discarded its attempted image. Independent read-back rejected the
mutation, and no automatic replay occurred. The partial test question remains
identified as a fixture; the owner's existing photo was preserved. This is
failure evidence, not a successful product image publication.

A subsequent non-submitting browser diagnostic assigned the same repository
icon bytes to the provider's blank native file input and dispatched change.
No operating-system picker opened. Blooket's own handler displayed Remove Image,
created its hidden `coverImageFile` input, and stored its preview URL in the
serialized question. The diagnostic editor was canceled without saving.

The corrected isolated-world runner therefore assigns an immutable File only
to that uniquely observed input: empty name, single selection, exact accepted
formats, no foreign form association. It never appends its own upload field or
creates/revokes a provider preview URL. The host waits for the provider's hidden
file and visible Remove Image control, binds the exact file and preview,
finalizes canonical question semantics, and permits one Submit.

Human input,
changed forms/files/preview, delayed preparation, or an uncertain
acknowledgement
prevent replay. Remote byte length and SHA-256 still have to match independent
saved-question reads before this internal host reports success.

Portable regressions exercise delayed provider preparation, missing or altered
file state, changed bytes, foreign previews, cancellation before Submit,
serialized runner closure, and post-submit identity failure. The corrected
upload has not yet been demonstrated against the live provider. Do not promote
these synthetic fixtures into live acceptance or remove the media gate.

At this follow-up, the browser connector listed no connected Chrome and the
owner-supplied DevTools CLI reported that its daemon was not running. The helper
wrapper uses a separate profile rather than the previously authenticated
browser; it also creates directories outside this repository and uses Bash,
so it was inspected but not invoked under the current repository/zsh boundary.

No account secret, cookie, or challenge token was copied, and no challenge was
solved. A different profile explains different session state but does not prove
the cause of the provider challenge. Official Cloudflare guidance was checked
again on 2026-10-09 at [supported browsers][cf-supported] and
[challenge troubleshooting][cf-troubleshooting].

## Durable publication identity foundation (2026-10-09)

`publication-snapshot.ts` under the write-plan domain decodes exact version-one
text snapshots and version-two expected-media contexts. Text plan IDs are
unchanged; media plans hash the sorted frozen byte identities. No descriptive
media JSONL, path, current library resolution, or provider URL can redefine a
past attempted effect. Covers and answer images remain refused because the
remote read contract cannot yet establish their exact identity.

Canonical reconcile and verify now consume that durable context. Synthetic
fixtures prove interrupted question-image recovery and final comparison even
when today's local bytes change, plus refusal of changed hashes and cross-plan
checkpoints. These fixtures do not prove live upload or canonical publication.
Initial media capture and the real corrected native upload remain pending;
new and resumed media mutation steps continue to return the unsupported stop.

At this checkpoint the Chrome connector exposed no connected Chrome. The
additional DevTools MCP could not find its configured stable Chrome executable.
Those transport failures do not diagnose the earlier provider challenge and do
not authorize starting a different authenticated profile or weakening its gates.

## Installation sequencing and existing Chrome connection (2026-10-09)

`src/api/application-updates/application/install.ts` coordinates journaled
installation and guarded rollback from independently prepared local authority.
The mirrored targeted suite exercises real private journals and Linux atomic
exchange/inverse recovery, plus synthetic trust/lifecycle failures. Never supply
permissive production ports based on these doubles. Independent installer
composition, all writer fences, actual authenticated version/nonce health,
publisher provisioning, and opt-in product controls remain required.

At the next browser check Chrome for Testing was running, but neither
the Chrome connector nor the configured DevTools MCP could reach it. A separate
scoped owner-installed CLI connection attempted to attach to the existing
profile only; Chrome had no active remote-debugging endpoint.

No new browser,
profile, copied session, or challenge bypass was created. The owner was given
Chrome's own remote-debugging activation step so the existing working session
can be reused. A missing endpoint does not explain the earlier Cloudflare stop.

After the owner enabled remote debugging, the scoped CLI connected to the
existing Chrome for Testing profile. An actual accessibility snapshot showed
the authenticated acceptance quiz with its four preserved questions and no
Cloudflare challenge. This confirms restored browser access, not the cause of
the earlier challenge or successful corrected image upload. The CLI's managed
extension list was empty even though its page inventory exposed the existing
extension worker; reloading that unmanaged extension by ID was refused.

## Live private fixture write and bounded confirmation (2026-10-09)

A real authenticated browser-backed CLI Create Set step returned
`reconciliation-required` even though a fresh My Sets read found one new
private development fixture matching the exact unique title and description.
An independent detail read confirmed the private visibility and zero saved
questions. A second read-only reconciliation remained inconclusive because
the provider list reports unknown nonempty collection completeness and the
write attempt's baseline is null. This is not a successful journal receipt.

The earlier named CLI fixture also remains privately saved with zero
questions and an unresolved attempt. Neither the old attempts nor the new
fixture were automatically replayed, cleared, or adopted; the new write was
performed exactly once. No personal-photo question set was changed.

The provider may take longer than the broker's former ten-second write
response deadline to hydrate the Create Set edit redirect. The broker now
budgets thirty seconds specifically for create-question/create-set writes,
while ordinary reads retain ten seconds. The extension reserves a bounded
27-second local write window; late queued writes still expire before dispatch.
Create Set redirect observation allows up to fourteen seconds with two
matching receipts and route checks, without a second submit attempt.

This longer bound is a plausible fix for the observed false-negative write;
confirmation on the real account with the newly compiled extension and a
restarted local service remains unverified. Synthetic broker tests prove that
a dispatched write can still reply after the read deadline and that delayed
queued writes do not begin. A simulated slow Edit redirect now produces two
matching observations rather than an erroneous timeout.

The next question step also performs a fresh read-only metadata comparison of
the exact recorded remote set before writing anything. If its ID, title,
description, or privacy diverge from the saved plan, publication stops without
creating a question attempt. Reconciliation now exposes the safe stable reason
`verification-inconclusive` to make an unresolved journal actionable without
claiming success from a matching title alone.

The newer unpacked extension was staged at the existing repo-local manual
installation path, preserving a separately named backup. It requires a real
manual extension reload and service restart before it can validate the longer
write budget against the actual provider. Only the native Linux package and
portable tests have passed since that source change; do not mark TODO 09
complete until a real saved question and a fresh full quiz read verify it.

## Authenticated private CLI publication acceptance (2026-10-09, 07:15 session)

The owner-reloaded extension reconnected automatically after the actual
localhost service was gracefully restarted against its **existing** data root.
The service instance changed and the extension reported one connected profile,
zero pending jobs, and no extension-update warning. Authenticated
`session inspect` and `capabilities inspect` remained functional; no cookies,
profile data, or provider secrets were transferred to the agent.

One newly created, uniquely suffixed **private** development set was already
remote-persisted but its Create Set attempt had no receipt and a null baseline.
The normal `publication reconcile` correctly refused to infer a receipt from
an incompletely observed nonempty My Sets collection. For this exact owned
synthetic fixture only, a human-authorized developer recovery compared saved
pre/post collection snapshots, confirmed exactly one new random-title
candidate, and independently reread its exact ID, title, description,
privacy and empty question list twice.

After one additional detail read,
`reconcilePersistedBlooketWrite` was used with the externally verified exact
set receipt. This path made **no** remote write and advanced only that one
journal from operation zero to one. The two unrelated ambiguous journals were
left intact. This externally witnessed repair is **not** automatic recovery,
and must not be generalized to teacher-authored titles or unknown baselines.

The canonical `publication step` CLI then added the fixture's fictional
`typing` question **once** and advanced to operation two of two. A separate
`publication verify` performed fresh remote detail and question observations
twice and returned `phase: verified`, `published: true`. A later standalone
fresh set-detail and question-list read confirmed the set was still private
and had precisely one saved typing question. No personal-photo set was touched.

The service broker was further hardened to keep the actual in-flight writer's
profile leased during a bounded write longer than the ten-second heartbeat,
without treating a second profile as authorized. Multi-question publication
now compares all earlier saved question bodies with the frozen plan before
starting each next question; the first question also requires a genuinely
empty remote question list. An unrelated edit or new manual question stops
publication before any write-attempt journal is started.

This establishes a **real single-question private CLI write and verified
read-back**, after an explicit externally witnessed recovery. It does not
prove new Create Set receipts always arrive on the fresh thirty-second
transport budget, automatic reconciliation without a complete baseline,
media-backed writes, arbitrary classroom quiz editing, or Mac/Safari release
acceptance. Keep the write/publication TODO records active until these
remaining ordinary-user paths work without developer-only intervention.

### Prepublication collision and interruption handling

Before starting a new Create Set operation, canonical publication checks the
currently observed My Sets summaries for a matching title. It independently
reads details for the small number of candidates and refuses an exact
same-title, same-description, same-visibility match before reserving a remote
write attempt. Nonempty collection completeness remains unknown: the check
uses only *positive* presence evidence, never an absence claim. A distinct
set sharing a title but differing in content can still be authored.

The command also exposes `reason: write-not-confirmed` when a write step
becomes ambiguous and `reason: verification-inconclusive` when reconciliation
cannot establish an outcome. Neither is converted into a successful receipt.
These guards have synthetic regressions and have not themselves been used to
start additional real provider writes after the confirmed private smoke test.

## Lost post-submit Chrome acknowledgement (2026-10-09, 07:50 session)

An injected Create Set click can trigger provider navigation before Chrome
returns the script response. A destroyed execution context after the single
submit is an **ambiguous acknowledgement**, not proof of a failed mutation.
The new browser host does **not** click Create Set again. If it sees an exact
same-origin Edit redirect after the lost script response, it permits only
additional read-only confirmation of that one redirected set ID.

The recovered redirect must be observed twice with the same exact URL and
validated ID. The sidebar must also report the originally submitted title
and description in two successive independent scripts; incomplete hydration
may retry for a small bounded window, but a readable mismatch stops the
confirmation immediately. A loading Create-to-Edit transition is supported,
while foreign routes, duplicated IDs, a changed second sidebar, and one-sided
confirmation remain failures. These checks do not infer privacy from the
URL; final publication verification still rereads the full remote metadata.

The canonical extension worker now requires the same exact saved-sidebar
readbacks for ordinary acknowledged Create Set redirects as well. Synthetic
Chrome tests exercise the lost acknowledgement, partial hydration and refusal
paths. This is portable evidence only: the real user account already has a
verified private quiz from an explicitly externally reconciled attempt, but
normal automatic Create Set acceptance on this newer build is still unproved.
The old ambiguous attempt journals remain untouched.

### Final local acceptance for lost-ack recovery

The expected Create Set redirect admits only one opaque `id` query and no
other search entries or URL fragment. Both the page runner and Chrome host
reject additional parameters, duplicate IDs, and unrelated routes. The
ordinary worker path also requires two saved-sidebar observations before it
can pass a newly created set ID to the journal.

An integration fixture now exercises the complete worker when Chrome destroys
the execution context after the submit click. A matching title and description
produce a read-only recovered receipt without another submit, whereas a
mismatched sidebar refuses it. Other tests cover the initial loading route,
slow sidebar hydration, and a disappearing or changing second readback.

The product remains connected to the real owner-authorized Chrome browser,
but those new lost-ack cases were verified through portable fixtures only.
The previously published fictional private fixture still independently verifies
as `published: true`, while the other two ambiguous journals remain untouched.
The updated unpacked extension files are staged at the existing installation
path with the prior build backed up; the currently loaded browser worker must
still be reloaded manually before these new changes take effect.

## Cross-draft duplicate publication prevention (2026-10-09, 08:25)

A matching quiz can be present even when My Sets reports `unknown`
completeness. A second saved draft with the *same Create Set metadata* must
not start another remote Create Set after the first has begun a mutation,
even when planned questions or local cover-media IDs differ.

Canonical publication checks owned immutable snapshots while holding the
publication-wide lock. If matching set metadata has an attempt journal or a
confirmed nonzero checkpoint, the second draft is stopped **before** opening
a remote write attempt. A snapshot without an attempt and with zero checkpoint
does not block other work: merely planning a quiz is not a remote mutation.
A set with genuinely different metadata remains eligible, subject to remote
collision checks.

This is an additional local idempotency guard, not a claim that provider My Sets
is complete or that Blooket has global server-side uniqueness constraints.
The filesystem adapter scans only hashed publication folders. It validates
that each snapshot's draft ID hashes back to its directory, rejects symbolic
entries and unsafe files, and caps both entry visits and aggregate bytes.

Unknown unrelated metadata files are ignored without opening them. A corrupt
owned publication snapshot fails closed instead of being overwritten.

Focused tests cover confirmed and ambiguous prior attempts, concurrent
identical drafts, distinct plans, unused snapshots, malformed IDs, symbolic
links, oversized files and aggregate size limits. A read-only scan of the
actual three existing journals found three valid, distinct set metadata intents;
there were **no account mutations** in these checks.

## Provider debug page: browser-specific evidence (2026-10-10)

A teacher supplied output from `https://debug.blooket.com/` identifying
Firefox 157 on Linux and an `allowed` geolocation check with country `MX`.
The public IP value in that user-provided output was empty. This supports
only the reported geolocation result, **not** successful authentication,
WAF clearance, or completion of every WebSocket and third-party check.

A newly built unpacked extension connected to an isolated local Blooket API
service in Chrome for Testing 155. The real local Quizzes readiness UI
correctly reported a Cloudflare `security-challenge` and offered the manual
tab handoff. A separate direct visit to the official `debug.blooket.com`
page in that same isolated Chrome browser also stopped at the provider's
`Just a moment...` interstitial, before its browser/network tests ran.

A local-origin capability probe in this test browser reported cookies enabled,
localStorage usable and a working WebGL context; its user agent disclosed
headless Chrome. These facts cannot identify the signal behind the provider's
challenge. Cloudflare's public documentation states that browser automation
frameworks are unsupported for solving production challenges. Do not spoof
browser fingerprints, automate challenge clicking, reuse unrelated browser
cookies, or misreport an authenticated result.

The local UI now states in Spanish and English that a test in Firefox does
not verify the separate Chrome profile. It instructs the teacher to open
`debug.blooket.com` in a **new tab** of the connected regular Chrome profile,
so any in-progress Blooket editor remains untouched. The user must complete
provider verification manually if prompted; the product cannot guarantee
that Cloudflare will never appear. Two synthetic UI response variants were
verified in a real isolated Chrome service, and no user account was modified.

The synthetic worker integration fixture had a historical question numbered 1
already present when testing read operations; it accidentally carried that
state into a new Add Question write for index 1, which the production duplicate
preflight correctly refused. The fixture now resets its mock question list
before that write and before the stale-pairing test. Milestones awaiting a
held browser script now have an explicit 2.5-second failure timeout instead
of hanging the entire Node test file. The corrected worker suite passes.

## Automatic Create Set follow-up (2026-10-10)

The existing service root was restarted without opening a terminal window.
Refreshing its already-open local workspace restored the extension connection;
canonical session inspection returned an authenticated My Sets state.
One uniquely named private two-question draft was saved through the CLI.

Its first publication step created a remotely visible empty set but returned
`reconciliation-required`, `reason: write-not-confirmed`, with zero completed
operations. No second Create Set was sent and its journal remains intact.
The currently loaded extension build could not be independently established,
so this result does not validate the newly compiled worker.

The lost-acknowledgement recovery had a separate 1.4-second redirect wait,
despite ordinary observation allowing almost fourteen seconds. That narrow
window is now aligned with the bounded ordinary redirect wait. A regression
delays the exact committed redirect beyond three seconds and verifies one
submit, two metadata observations, and no replay; a missing redirect still
expires without another click.

The current browser controller rejects extension-page navigation by policy.
The owner-authorized DevTools CLI also did not establish a responsive browser
connection through the existing endpoint. Do not circumvent either boundary
or label staged extension files as a proven loaded worker. Continue portable
work while preserving the ambiguous real attempt and the user-selected photo.
