# Blooket write plans

## Status

Accepted.

## Decision ID

`blooket-api.execution.validated-write-plans`

## Context

Remote writes must never consume raw model output or partially validated project
state. Retrying an interrupted write also needs stable operation identities that
do not change merely because unrelated local metadata changed.

Capability evidence can be incomplete or account-dependent. A structurally valid
project therefore is not automatically safe to execute against Blooket.
Runtime capability decoding uses owned data fields and bounded dense arrays;
accessors and custom iterators cannot become feature-admission authority.

## Decision

Write-plan construction accepts untrusted project JSON, media JSON Lines, and an
untrusted capability snapshot. It first decodes the project bundle, rejects
unresolved image requests, decodes the capability snapshot, and applies
fail-closed project compatibility rules before producing a plan.

Only explicit supported capability facts admit optional question and answer
images. Multiple-choice answer counts use verified minimum and maximum bounds,
multiple-correct questions require explicit support, typing match modes must be
listed, project visibility must be admitted, and omitted cover images require
verified optionality.

The plan is remote-neutral. It contains one set operation followed by ordered
question operations, stable local question IDs, and stable media IDs, but no
Blooket selectors, URLs, guessed remote IDs, media descriptions, or vault paths.

The plan ID is the SHA-256 digest of the lowered execution-relevant desired
state, prefixed as an operation identifier. Operation IDs derive from that plan
ID. Retrying the same desired state therefore reuses identities, while changing
remote-visible content creates a new plan.

Durable publication snapshots also admit version two, which carries exact
prepared-media identities beside the frozen document and capabilities. Its
planner validates exactly one identity per referenced stable media ID instead
of requiring descriptive JSONL records or synthesizing filesystem paths. The
framed desired-state hash includes the sorted ID/revision/format/byte-length/
SHA-256 facts whenever media is present. Changing a rendition therefore changes
all plan/operation bindings, while identity ordering and descriptive metadata
do not.

Empty identity contexts retain the exact legacy text plan hash.

Append publication uses snapshot version three and write-plan version two.
The frozen snapshot retains the full desired quiz, capabilities and prepared
identities, plus an explicit existing set ID and preexisting question collection
count/digest. Its plan contains only the new ordered question suffix; the plan
hash also includes the target and baseline. Legacy creation hashes remain
unchanged.

Append checkpoints use the existing version-two checkpoint representation with
the explicitly bound target already present at index zero. This is not a Create
Set receipt or an advancement: no set operation exists in an append plan.
Decoding rejects a different or missing target, including old unbound progress.
The same attempt journal, pacing, media admission, reconciliation and atomic
persistence execute each new question without a second publication loop.

Before every append, remote metadata and the entire completed question prefix
must still match the frozen intent and original baseline. The executor's later
baseline capture must also match that preflight collection before a write-ahead
journal can start, detecting changes during intervening session/media awaits.
Uncertain attempts require local recovery before another write.

Checkpoint and verification-baseline decoders accept only own data fields;
accessors and inherited values never authorize progress or read-back claims.

A checkpoint rotation backup (`checkpoint.json.bak`) is also recovery evidence:
if a snapshot is missing, neither its own draft nor a competing draft may
silently treat that backup as a fresh publication.
Final verification checks the entire desired quiz in two fresh observations.

The current native question reader establishes no complete collection above
200 saved cards. Canonical publication therefore refuses new creation or
append snapshots above 200 questions before sending a mutation, rather than
stranding an unverified question. Existing larger snapshots remain readable
for status and reconciliation without granting another write start.

Provider form limits are checked independently of project-document syntax.
The native Create Set title is a single-line `input type=text` control.
The WHATWG HTML Standard strips CR and LF characters when assigning that
control's value. Canonical lowering and the independent prepare/submit
functions therefore reject such titles without changing teacher-authored
text or creating an unfinishable publication journal.

Native typing alternatives likewise use single-line
`input[name="accepted-answers"]` and reject CR/LF in both canonical lowering
and the independent Save guard. Multiple-choice answers use `textarea`
controls, so their authored multiline text remains admissible and unchanged.

The versioned local browser-bridge decoder applies the same native text
limits before dispatching a write command. CR-containing textarea content,
CR/LF typing answers, blank-only values and reserved provider markup markers
cannot reach the tab/navigation host from an alternate transport, while
LF-only multiline MC textarea answers remain valid.

The bridge refuses new question positions above 200, matching the native
saved-collection read-back limit. The journaled command already rejects new
oversized drafts; standalone lowering retains its historical 10,000-slot
bound to keep archived publication snapshots inspectable with their stable
question-limit diagnostic. This is not an inferred provider account quota.

Textarea API values normalize CR/CRLF into LF under the
[HTML Standard][textarea-newlines]. The canonical question writer,
visible-controls preparation and independent Add Question Save guard refuse
CR-bearing prompts and MC answer text instead of silently changing authored
bytes. Native LF-only multiline prompts and MC answers remain admissible.


The separately injected question-controls preparation step checks the same
provider-text and timer boundaries before changing a visible React editor.
Rejection must not leave a partially filled prompt, question type, or typing
answer waiting in an unsubmitted form merely because the later Save guard
would refuse it. Native answer topology (unique alternatives, explicit
correctness, typing match modes, and MC slot counts) is also checked before
opening or modifying the visible form rather than only before Save.

Before preparing the prompt, the native controls adapter verifies the
textarea prompt, numeric timer, and initial plain-text typing-answer input
are writable and correctly typed. This prevents a drifting page from
receiving teacher answers in unrelated, renamed, or password controls.

For multiple choice, prefill admission checks the four native textarea
slots, required correctness toggles, and checkbox shuffle switch. A
missing or changed control cannot leave an otherwise valid prompt partly
prepared before the independent Save preflight.

Observed native `maxLength` constraints are checked for all admitted
visible controls before changing the prompt or timer. A provider-imposed
shorter timer or answer limit cannot strand an otherwise unfinished form
with partly written text.

Create Set descriptions also use a textarea. Since the HTML textarea API
normalizes carriage returns, canonical lowering and independent form actions
refuse CR/CRLF in descriptions without changing LF-only multiline content.
This check precedes filling the single-line title and freezing the attempt.

Create Set metadata preparation also requires the observed single-line
plain-text title control and writable title/description controls; it checks
both native `maxLength` values before setting either field. Independent Save
admission rechecks these controls so changed form types cannot receive an
unintended write or click.

Whitespace-only set titles are rejected before opening a write journal while
valid teacher-authored title text remains unchanged. The independent Create
Set browser prepare/submit functions also reject whitespace-only titles, even
when the observed form already contains that text. Similarly, native
question/answer lowering and the browser form guard refuse whitespace-only
prompts or text answers without changing meaningful authored text.

NUL-containing metadata, prompts, and text answers are also refused at
both the frozen publication plan and the independent provider form boundary.

Reserved math or image markers embedded in prompt text are refused just
as they are in text answers; actual media must use the separately
admitted media slot.

An uncommitted Chrome `pendingUrl` is never a trusted Create Set or Add
Question source document. Both browser mutation hosts recheck their exact
committed route before touching form controls or invoking Save. A Create
Set Save acknowledgment may acknowledge an exact *loading* pending Edit
redirect, but this never replaces the separately required durable read-back.
Post-submit observation waits for that exact redirect to commit rather than
reading the stale Create document, and refuses a foreign pending destination.

A later native-contract change cannot make an old attempting journal disappear:
status and read-only reconciliation remain available even when a new write
would fail today's provider-text preflight.

This initial existing-set workflow only appends. It refuses replacements,
deletions, reordering or metadata changes; in-place question editing remains
pending in `blooket-11`. Portable transport coverage is not live acceptance.

Version-one snapshots remain text-only and retain their existing checkpoint and
journal bindings. Final image verification and reconciliation consume the
version-two frozen expected context without resolving today's media library.
Cover and answer-image snapshots are refused until their remote identity can
be verified. Question images use the existing bounded prepared-file transport
and frozen identities, with live publication acceptance still tracked in
`blooket-11`.

The historical `text-publication` capability scope supplies the base snapshot
without inspecting account-dependent audio or answer-image drawers. Text and
prepared question-image publication use that scope; the planner still requires
explicit supported question-image availability and validated current media
identities. A failed unrelated audio probe cannot substitute for an image
entitlement decision, and unknown image availability remains blocking.

When the source is a clean Edit page, this scoped read uses its own temporary
tab, preserving the saved quiz's document and route. Source document identity
and session checks still bracket the independent read; an unsaved source form
continues to require the existing exact submitted owner. Full account-dependent
media inspection retains its separate host behavior.

Progress uses a version-two checkpoint containing the exact plan ID, the next
operation index, and the opaque remote set ID after Create Set succeeds. The
checkpoint advances only when the executor confirms the exact next operation ID.
Cross-plan, skipped, out-of-order, and unbound advanced progress fail
explicitly.

Remote execution consumes at most one planned operation per application call.
The checkpoint is decoded before any browser, credential, or mutation side
effect. A completed checkpoint returns without touching the browser. A confirmed
mutation advances exactly one operation; rate limiting, session expiry, human
stop states, browser failures, and otherwise unconfirmed outcomes preserve the
existing checkpoint.

The executor intentionally does not sleep, loop, or auto-retry. Confirmed
progress is persisted through an atomic, writer-locked checkpoint file. Missing
files mean index zero; durable saves may hold the current index or advance by
exactly one and reject regressions, skips, and cross-plan state.

The persisted application composition loads progress before browser side effects
and stores a confirmed advancement before returning success. If a remote write
is confirmed but checkpoint persistence fails, it returns an explicit recovery
state rather than treating the operation as retryable.

Write-ahead recovery uses a separate version-three attempt journal bound to the
exact plan, operation ID, and operation index. An `attempting` record has no
receipt. A confirmed Create Set record stores the opaque remote set receipt;
question confirmations store `null`. Corrupt or cross-plan evidence is retained.

Version three may also persist a non-sensitive verification baseline captured
before mutation. The baseline contains only a collection kind, item count, and
lowercase SHA-256 digest. It must never contain provider content, credentials,
cookies, or raw browser/session state. Version-one and version-two journals
decode with `baseline: null`; recovery never invents missing pre-attempt
evidence.

Collection hashing uses versioned JSON framing that preserves observed order and
duplicates, avoiding delimiter-based or concatenation ambiguity.

Local recovery treats `attempting` as ambiguous and requires reconciliation.
An explicit resolver may apply externally verified evidence for the exact
operation: confirmed outcomes first persist their receipt and reuse normal
recovery, while verified non-confirmation clears only the pending journal.

Inconsistent progress, operation mismatches, invalid receipts, and lock
conflicts preserve recovery evidence. Only a durably `confirmed` journal may
advance a missing checkpoint step automatically.

Persisted execution serializes the full recovery-to-cleanup transaction with an
exclusive execution lock. Standalone recovery acquires that same lock, whose
path is derived by the attempt-journal adapter, so recovery cannot race a remote
write using the same journal.

The persisted path reuses the canonical executor as explicit
prepare/attempt/complete phases. Session readiness is established first. When a
verification port is available, its pre-attempt baseline is captured and durably
journaled before the remote mutation. Only then may the remote attempt begin.

`confirmed` is persisted immediately after remote success. Only then may the
checkpoint advance and the journal be cleared. Concurrent callers cannot observe
stale progress and issue a duplicate mutation.

A non-confirmed remote outcome deliberately leaves the `attempting` journal in
place and returns reconciliation-required instead of a retryable result. Session
stop states occur before journal creation. A confirmed journal whose checkpoint
save fails remains sufficient for deterministic local recovery on the next call.

Concrete browser mutation mechanics, the provider-specific verifier that feeds
explicit reconciliation, normal pacing, and retry classification remain
dependent on verified browser behavior rather than guessed selectors or timing
constants.

Authenticated build evidence shows that Create Set returns an opaque remote set
identifier and continues at `/edit?id=<id>`. Confirmed execution now persists
that receipt in the journal before checkpoint advancement, then carries the same
binding into checkpoint version two before the journal is cleared.

Recovered edit client evidence distinguishes question creation from set
creation. Module `35211` submits Add Question through server-action reference
`9898.Xv` and treats form status `SUCCESS` as the client success signal, but
does not expose a remote question ID. Recovery therefore must not infer a
question write from a matching toast, current page, or duplicate-able content.

A concrete verifier should compare a post-attempt collection against the
persisted pre-attempt count/digest. It may confirm only when removing the one
expected effect reproduces the exact baseline and all other observed state is
unchanged. Set-list baselines additionally require an explicitly complete
collection; `unknown` completeness cannot confirm or disconfirm an ambiguous
write from collection differences. Multiple candidates, concurrent changes,
absent baselines, or weak page matches remain `inconclusive`.

Canonical publication requires a valid verification baseline before admitting
a new remote attempt, including a second capture after pacing and media
admission. Missing evidence stops before the budget reservation, attempt
journal, and remote mutation.

Known browser execution captures a distinct `set-observation` baseline when
My Sets completeness is unknown. This records only the visible count/digest
for the precondition comparison; it never claims global absence or upgrades
the collection's completeness. Only the actual browser adapter's in-process
identity enables that policy; an unknown writer retains complete-list admission.

Before a new browser creation, the connected worker must declare its current
`reload-and-privacy-v1` confirmation contract through the read-only internal
`writes.inspect` job. An absent, legacy, malformed or unavailable declaration
stops before pacing, budget reservation and journaling.

This is loaded-code compatibility evidence, not Blooket acceptance or account
capability evidence. The probe neither runs page scripts nor navigates,
authenticates or mutates the account; actual confirmation remains mandatory.
Existing ambiguous journals retain their recovery path without this probe.

A new browser creation advances only on its confirmed receipt, obtained from
an owned fresh Create Set form, edit redirect and exact saved metadata after
reload. Question operations still require their full question baseline.
The required second capture after pacing detects changes to the observed rows
before budget reservation or mutation. An observed baseline cannot reconcile
a lost creation acknowledgement, even when a new matching set is visible.

Such uncertain attempts retain their journal, block another write/update and
require stronger recovery evidence or human action. A surface callback, label,
matching title or missing row never authorizes retry or adoption.

The trusted low-level executor retains optional baseline policy for existing
receipt-only callers; CLI and MCP publication always enable the requirement.

Legacy journals without a baseline remain ambiguous and retain their exact
evidence. This admission rule cannot repair or replay an older attempt.

Subsequent question writes receive the checkpoint's remote set ID explicitly.
Recovery refuses legacy advanced checkpoints, legacy confirmed Create Set
journals, premature bindings, and receipt/checkpoint mismatches instead of
inventing or changing the target.

## Consequences

- Raw or malformed project data cannot reach a write plan.
- Unknown or account-dependent capabilities remain blocking when used.
- Local media descriptions, names, and vault paths cannot perturb operation IDs.
- Unresolved media requests block planning before any remote side effect.
- Checkpoints can be persisted later without changing plan semantics.
- Remote create/edit executors can be idempotent around stable operation IDs.

## Rejected Alternatives

- Hashing the complete local bundle was rejected because local-only media
  metadata would invalidate otherwise identical remote work.
- Using random operation IDs was rejected because retries could not recover the
  same idempotency identity after interruption.
- Storing only a completed-operation count without a plan ID was
  rejected because progress could be applied to a different desired state.
- Allowing account-dependent capabilities optimistically was rejected because it
  would turn missing evidence into an unsupported remote write attempt.

## Verification

Write-plan tests prove invalid projects, unresolved media, invalid capability
snapshots, and account-dependent answer images cannot produce plans. They also
prove execution-relevant content changes plan identity while local-only media
metadata does not.

Checkpoint tests prove progress binds to one exact plan, advances one confirmed
operation at a time, rejects skipped and cross-plan operations, and
distinguishes completion from mismatch.

**Conservative user-configured pacing**

Local settings schema v4 adds versioned publication pacing: minimum mutation
start interval, maximum starts per rolling minute, maximum task starts, and
maximum task duration. The validated local UI accepts seconds, counts and
minutes but persists canonical milliseconds and counts. An on-disk v3 profile
upgrades in memory with the original conservative defaults and retains its
previous byte content until the owner explicitly saves settings.

The local service freezes the loaded policy at startup for its shared mutation
pacer and the canonical journaled task budget used by UI, CLI and MCP. Changing
settings does not rewrite an in-flight plan, journal, lease, or started budget;
the user must restart the service to activate a new policy. Legacy v3 settings
saves are refused to prevent a stale UI from dropping stricter policy fields.

Application pacing cannot establish Blooket's actual account quota. Exhaustion
is a recoverable pre-write stop; it does not justify replaying any prior
uncertain attempt, clearing a journal, or claiming remote success.

The shared pacer also commits each admitted account-wide mutation start to the
local data-root `mutation-pacing.json` before returning an execution lease.
This small version-one ledger stores only ordered epoch-millisecond timestamps;
its lock, owner-only atomic replace and no-follow bounded read preserve history
on service restart without exposing provider or teacher content. Missing files
begin an empty history; malformed, unsafe, unreadable or clock-regressed files
block new writes instead of discarding evidence. Canonical serialization
also rejects duplicate JSON keys and reordered or incomplete saved facts.

The in-memory pacer still serializes work and uses monotonic elapsed time. When
restarted, the durable gate may require another cancellable wait under the
original lease before recording the new start. The gate applies any newly
stricter validated policy against prior starts. A durable reservation counts
conservatively even when post-lease revalidation stops before a browser write;
no uncertain journal is ever reopened to recover that unused allowance.

<!-- jig-ignore-next-line: Official specification URL is indivisible. -->
[textarea-newlines]: https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element

**Prepared-image bridge ownership**

A prepared image transported by the local browser bridge must own exactly
`format` and `base64` as enumerable data fields. The decoder and direct
byte helper take snapshots through `exactOwnData`, rejecting inherited
values, accessor properties and unknown keys before inspecting encoded
image signatures. An image's file path, URL or raw teacher-source filename
never becomes transport authority. These checks supplement, but do not
replace, upstream full-file media admission and saved-byte verification.

Saved-image byte verification only hashes a complete HTTP 200 media-origin
response without Content-Range. RFC 9110 defines 206 as a range response,
whose body cannot establish the full remote representation. Partial or
non-200 responses stay unconfirmed, preserving the uncertain Save journal.

The saved-image verifier owns every streamed Uint8Array chunk as soon as it
is received: reusing a source backing buffer cannot rewrite prior bytes
before SHA-256. Lengths come from native typed-array byte slots rather than
subclass getter overrides. Chunk and total-byte bounds remain enforced.

The Add Question host likewise snapshots script-result envelopes before
accepting form preparation, session observations and saved-image byte
identities. An accessor or proxy property read cannot substitute an apparent
success for a mismatching own-data result or a signed-out provider state.

The extension worker now also owns the script replies for session
observation, saved set-list completeness, and Edit Info metadata evidence.
Two matching proxy getter values must not turn a signed-out page, unknown
collection, or failed sidebar/panel read into a verified remote state.

A restored extension bridge connection uses copied own-data descriptors;
validated localhost origins and bearer tokens cannot change through a
later property-read trap on the stored record.

Restoring or reclaiming a previously owned Blooket tab additionally requires
no pending Chrome navigation: its committed URL alone cannot prove ownership
while a new destination is loading. A foreign pending destination stops
restoration without activating the teacher's tab.

The browser-bridge HTTP reader requires HTTP 200 with no Content-Range and
no redirect before parsing a returned job. A partial representation never
confers Chrome script or provider mutation authority, even if the body is
parseable JSON.

The browser-bridge HTTP reader also owns every received JSON response chunk
before awaiting the next one. Recycling a stream buffer cannot corrupt a
prepared job or its browser result, and transport failures never confer
remote Save authority.

The Create Set host makes the same descriptor-backed decisions for
preparation, session state, redirect receipts and independently verified
saved metadata. The Edit Info visibility read uses a copied reply rather
than trusting accessors after its field-key check. Neither host is allowed
to turn an unconfirmed browser response into a duplicate Save attempt.

The canonical browser-write adapter also snapshots the owned response
instead of consulting proxied `ok`, remote set IDs, or stop fields after
checking descriptors. An apparent success that conflicts with its data
cannot become a durable set-created receipt or advance a checkpoint.

Before delegating media bytes, the browser-write adapter also snapshots a
bounded exact dense array and copies the typed metadata descriptors for every
expected stable media ID. A decorated or proxied array cannot hide an extra
upload or substitute a matching ID through property getters. The service's
prepared-media admission still owns format and revision verification.

The adapter also owns a fresh byte copy before starting an asynchronous
browser write. A caller cannot mutate a previously admitted Uint8Array and
thereby change what the downstream provider surface uploads mid-attempt.
