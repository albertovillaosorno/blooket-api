# Blooket provider-change detection

Blooket is an independently maintained service. Previously verified DOM,
transport and persistence contracts may change without a blooket-api release.
An unchanged local test fixture does not prove that the live provider is still
compatible. Keep this risk visible throughout ongoing maintenance.

## Repeatable tests before provider-facing commits

Run `npm run provider:drift:check` before changing browser page adapters,
Chrome extension hosts, provider response parsing or navigation transitions.
The command executes synthetic browser page and worker tests, including
provider-shape drift regressions. Also run `npm test`, `npm run check`,
`npm run roadmap:check`, and `jig validate --root .` before committing.

Add or revise focused fixtures when an observed provider change breaks a
selector, accessible label, route, session state, question type, time limit,
media field, serialized JSON field, DOM ownership, hydration sequence, saved
question read or publication receipt. Verify the expected old contract and a
fail-closed changed contract. Record the relevant observed browser/product
build when it is actually known and safe to report, but do not guess it.

## Read-only live editor inspection

`inspectBlooketQuestionEditorCompatibility()` is a self-contained, browser-safe
function exported by:

`src/platforms/blooket-browser/adapter-outbound/compatibility-page.ts`

A development controller already connected to the owner's authenticated
browser may inject that function into an explicitly selected, authorized tab
**for read-only diagnosis**. It makes no clicks or requests and does not
change tabs, forms, sessions or extension state. It returns only a fixed kind,
state and boolean indicators; it never returns question content, answer text,
set IDs, URLs, user identifiers, provider tokens or credentials.

The observed states mean:

- `shape-compatible`: the current open editor has the expected local field
  and control shape; it is **not** a Save receipt or authorization to mutate.
- `shape-drift`: controls, data shape or visible/serialized echo differ; stop
  unsafe writes and investigate, never guess selectors or replay a mutation.
- `editor-closed`: the expected open question editor is absent. It does not
  prove the remote question was saved.
- `human-stop`: the page visibly requires provider/security interaction.
- `other-page`: the observed document is not the exact provider Edit route.

The extension's automatic Add Question write now has a second, read-only
visible-control echo check directly before the single Save. Its result is
internal to the admitted browser host and cannot be replayed as a command.
It detects visible React state that changed after preparation, while the
canonical journal still owns interruption and remote verification.

An open question modal may contain unsaved human work and an unresolved
mutation. Do not navigate away from it, dismiss it, reload the extension or
create another question merely to run a compatibility check. When browser
attachment or inspection is blocked, record the limitation rather than
launching a new account profile or bypassing the failed controller.

The inspector is intentionally only a *shape probe*. It cannot independently
confirm authentication, server persistence, current account entitlements,
question correctness after reload, transport support, or a provider version.
Canonical CLI/MCP commands and fresh remote read-back still own verification.

## October 14, 2026 read-only compatibility observation

An authorized Chrome for Testing 155 read-only inspection of the already-open
authenticated Edit page found one account My Sets navigation link, a present
Typing question editor, its expected visible `textarea#question` and numeric
`input#time-limit`, and one Save Question control. Blooket's provider build
identity was not verified. No clicks, refresh, extension reload, credential
reads or saved-content exports were performed.

The canonical CLI session observation still returned `edit`, while fresh
`sets.list` and text-only capability reads returned `blooket-browser-failed`.
The existing connected Chrome session also retains an open question editor;
read navigation is intentionally forbidden when that form could hold unsaved
work. This result does **not** establish an upstream selector change, a saved
question receipt, or automatic multi-question acceptance. Leave the pending
attempts and owned editor untouched; use portable read/hydration regressions
until safe live reads are possible.

## Maintenance evidence and incident protocol

For each meaningful platform change or unexplained failure, capture the safe
operation phase, browser/tool version when available, affected adapter,
expected-vs-observed **structural** contract, and journal state without
capturing personal account data. First add a failing regression. Then make a
narrow fix and preserve tests for unsupported, interrupted, human-stop and
ambiguous outcomes. Review old fixtures for false confidence after updates.

Use separate, reviewable provider-compatibility commits repeatedly instead of
waiting for feature failures. Keep the permanent `blooket-15` task active even
when drift checks are green or other milestones are complete. Never reclassify
unconfirmed account writes as successful based on a local shape check.

On 2026-10-26, an authorized read-only Chrome 155 session reproduced an
incomplete image-rich question scan under the eight-second worker budget.
After extending only question collections, the canonical CLI returned all
26 saved questions through the reloaded companion. No Save was used.

Question collections now have a 60-second broker lease, 55-second inspection
budget, two seconds reserved for owned-panel cleanup, and a 75-second CLI
timeout. Ordinary reads retain their shorter deadlines. Regression tests cover
late collection replies and queued jobs with insufficient remaining time.

Chrome's [worker lifecycle documentation][worker-lifetime], checked on
2026-10-26, confirms that extension API calls reset the idle timer. The scan
continues using ordinary API calls; it does not add a background keepalive.
The local Git gate also now matches the installed 2.56.0 release, confirmed
against the [official Git release page][git-release] on the same date.

<!-- jig-ignore-next-line: Official documentation URL must remain intact. -->
[worker-lifetime]: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
[git-release]: https://git-scm.com/

On 2026-10-26, existing-text correction exposed two native-form contracts:
Edit Info's Done button uses an explicit `form` association outside the form,
and an existing question editor is itself an ARIA modal dialog. The revision
adapter admits only that exact read-owned question dialog while continuing
to reject additional human dialogs. Regression fixtures cover external form
ownership, image preservation, trusted input and single-use Save latches.

The canonical local CLI saved and freshly verified an existing title and
question text without a controller Save. A subsequent full saved-question
read independently confirmed unchanged image hashes. These observations
establish the admitted correction path, not unrestricted metadata/media edits
or an uninterrupted provider workflow.

Chrome's [scripting API][scripting-arguments], checked on 2026-10-26, requires
JSON-serializable injection arguments. The host omits an absent optional
argument rather than passing `undefined`; a transport fixture now enforces
that real-browser constraint.

<!-- jig-ignore-next-line: Official documentation URL must remain intact. -->
[scripting-arguments]: https://developer.chrome.com/docs/extensions/reference/api/scripting

On 2026-10-26, a rapid text Save following a metadata read left its owned
form open and a same-route HTTP 429 was observed. A separate fresh read
showed the original row and original media unchanged. All text corrections
now share the native provider-action spacing, including question text.

Read-panel cleanup refuses a retained text-revision watch. Existing-row
recovery can return a separate unchanged checkpoint only after two fresh
documents agree on the exact original row and original media identity. It never
clicks Save during reconciliation; an additional paced admission is required
for the idempotent assignment, with prior uncertainty retained in history.
Create Set and Add Question replay rules remain unchanged.

On 2026-10-27, a later existing-row Save received HTTP 429 with a provider
verification HTML response while the ordinary editor remained visible. No
`Retry-After` header was observed. A response code alone therefore cannot
identify a documented Blooket rate policy or prove a rejected Save.

The retained-text recovery host verifies through one temporary background
read tab and checks the original source document, submitted owner, exact
request and media identity again before closing its transient form. It
never saves during reconciliation, and failed read-tab cleanup stays uncertain.
Sanitized fixtures cover verified and unchanged rows, mixed state, interrupted
source ownership, missing byte evidence and failed cleanup.

[MDN's HTTP 429 reference][http-429], checked on 2026-10-27, explains that
`Retry-After` may be present; its absence supplies no exact waiting period.
Provider verification is observed through normal browser navigation, without
a challenge solver, cookie export or security-setting changes.

<!-- jig-ignore-next-line: Official documentation URL must remain intact. -->
[http-429]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429
