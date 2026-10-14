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
