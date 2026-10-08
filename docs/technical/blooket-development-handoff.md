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

Media transport remains unsupported by the bridge surfaces. Review the actual
request/response byte limits and serialization before adding prepared files:
base64 expands bytes, and accepted image size is not an envelope size allowance.
Do not widen every endpoint or expose arbitrary paths to make an upload fit.

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
