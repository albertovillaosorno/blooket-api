# Development browser controllers

## Scope

These are repository development tools, separate from teacher MCP tools.
Chrome for Testing is supported alongside ordinary Chrome; reuse an installed
browser and its authorized session. Repository commands run in the system zsh
through the terminal selected by the human.

Inspect available controllers before choosing one. The integrated browser,
Playwright MCP, Chrome DevTools MCP, and an installed CLI are alternatives;
their presence does not establish a working connection. Read the controller's
current documentation and inspect its actual tabs before account operations.

## Choose an independent controller, then validate the product path

Use Chrome for Testing already installed on Fedora when it is the browser
with the admitted extension and signed-in owner session. Its existence on
disk is not proof of a loaded worker. Do not fetch or create a new profile to
replace a disconnected authenticated session.

The supported verification paths are deliberately independent:

- Chrome for Testing shows actual browser and extension execution, not a
  confirmed remote write.
- Playwright MCP shows attached tab controls and snapshots, not journal
  advancement.
- Chrome DevTools MCP inspects browser and extension state, not an admitted
  teacher tool call.
- `chrome-devtools` CLI supplies independent zsh page/extension commands,
  not remote persistence proof.
- Product CLI/MCP exercises publication, reconciliation and fresh reads,
  not native Safari or ChatGPT account behavior.

Check each tool independently; an unavailable integrated browser is not a
reason to skip an available CLI or attached Playwright MCP. Conversely, a
controller launching a new browser cannot substitute for the owner's existing
Blooket session. The installed `chrome-devtools` CLI works through system zsh;
its `--help` is the argument authority for the deployed version.

For a safe CLI preflight, inspect the controller before requesting a new tab:

```sh
chrome-devtools --version
chrome-devtools list_pages --output-format=md
chrome-devtools list_extensions --output-format=md
```

Redact private page titles, identifiers, debugging endpoints and session
metadata from reports. If the controller is disconnected, diagnose attachment
without opening Blooket elsewhere. Only an observed extension ID can be
reloaded, and only after no journaled mutation or unsaved editor would be
lost. To verify product behavior, use the canonical CLI through the same
explicitly approved local service data root:

```sh
BLOOKET_DATA_HOME="$PWD/.temp/browser-acceptance-current" \
  npm run blooket -- session inspect --json
```

Run `npm run provider:drift:check`, matching Node regressions and `jig validate`
when provider selectors, saved reads or browser bridging change. The platform
matrix and documented official implementations guide future theoretical Mac
and ARM64 assurance; neither is a completion gate for portable publication.

## Safe question write-stage diagnostics

The isolated Blooket API extension owns the per-document Add Question watch.
A content-free read-only diagnostic is exported from
`src/platforms/blooket-browser/adapter-outbound/question-write-stage-page.ts`.
It returns only one fixed stage enum: no owner in the **current execution
world**, pending opener, visible-control preparation, pre-submit finalization,
submit attempted, interruption, detach, replacement, or unavailable.

It must execute in the **same Chrome extension isolated scripting world** as
the admitted Add Question host. A normal page-world DevTools probe that returns
`no-owner` does **not** prove the extension's owner was absent. Likewise,
`ready-for-save` is never authority to click Save, and `submit-attempted` is
never proof of server persistence. Only canonical journal recovery and fresh
remote verification can decide whether to resume or close an uncertain write.

Do not reload the extension or navigate away from a pending teacher form just
to obtain a stage diagnostic. If the authorized controller cannot inspect its
isolated world without crossing a security or ownership boundary, leave the
journal uncertain and report the diagnostic as unavailable.

## Playwright MCP

Microsoft's [extension documentation][playwright-extension], checked on
2026-10-13, describes `--extension` for existing Chrome/Chromium tabs and
sessions. The browser owner selects the connected tab, and each client has a
scoped tab group. Reuse that admitted scope rather than copying cookies.

Discover the tools exposed by the installed MCP version, take a fresh browser
snapshot, and use observed accessible controls. A disconnected controller needs
connection diagnosis, not another Blooket profile. The Blooket API extension
and the Playwright controller extension serve different purposes.

If the tool is absent, report it as unavailable and use another installed
controller. Do not silently install a new controller, download another browser,
or create external profiles/package caches. Repository-owned temporary outputs
belong under `.temp/`; reuse existing dependencies.

## Chrome DevTools MCP and CLI

Google's [attachment guide][devtools-attachment] and
[tool reference][devtools-tools], checked on 2026-10-13, describe attaching to
an existing debuggable Chrome and dedicated extension operations. Use the
installed CLI's help to confirm its supported flags and transport limitations.
Do not infer extension administration from a browser version alone.

Inspect the installed CLI controller's status first:

```sh
chrome-devtools status
```

Keep one backend Blooket tab and at most one auxiliary read tab. Inspect and
close only session-owned test duplicates before development reloads, retaining
the canonical drafts and recovery journals; hidden tabs still consume RAM.
The worker now retains an unsafe prior editor instead of creating replacement
tabs on each reload, and an unclosed auxiliary read reserves its slot across
jobs. Its popup can show that retained editor without adopting it for writes.

Only after that confirms a running controller with the authorized existing
browser attachment, inspect its actual pages and extensions:

```sh
chrome-devtools list_pages --output-format=json
chrome-devtools list_extensions --output-format=json
```

The installed CLI 1.10.1 can serialize extension entries as empty objects in
JSON. When that happens, use `list_extensions --output-format=md` to inspect
the actual installed ID, name, version and enabled state; an empty serialized
object does not establish that the extension is absent.

If existing-browser attachment is authorized and remote debugging is already
enabled, the installed CLI supports this attachment form:

```sh
chrome-devtools start --autoConnect \
  --userDataDir='<observed-profile-root>' \
  --workspace="$PWD" --redactNetworkHeaders=true
```

The profile root must be discovered from the actual running browser, not
guessed or created. A start without existing-browser attachment can launch a
separate session; it does not reuse the owner's Blooket login.

Avoid raw connection logs for authenticated attachments. The installed CLI
1.10.1 and Google's [connection implementation][devtools-connection], checked
on 2026-10-13, serialize connection options into diagnostic logging, including
the private WebSocket endpoint and any supplied WebSocket headers.
`--redactNetworkHeaders` does not sanitize those startup options.

Inspect controller output in memory and emit only necessary non-sensitive
status fields. CLI status can print its full launch arguments; do not dump that
output when arguments contain endpoints or credentials. Any necessary sanitized
diagnostic file belongs under `.temp/`; never save raw protocol or connection
dumps.

An HTTP `/json/version` failure does not prove that the discovered browser is
offline. The installed auto-connect implementation reads the existing profile's
private `DevToolsActivePort` and uses its advertised WebSocket endpoint
directly.
Switching to that same endpoint is not a new connection strategy after an
auto-connect failure; diagnose the existing attachment without exposing its
nonce, weakening permissions, or restarting the owner's browser.

Reload only the observed installed Blooket API extension after assembling its
reviewed files at that same path:

```sh
chrome-devtools reload_extension '<observed-extension-id>' --output-format=json
```

A timeout, unsupported transport, or unmanaged-extension refusal is a failed
reload. Recheck the same controller's status and the actual outcome before
another attempt; a timeout alone does not prove termination. Stop only a
session-owned controller, preserving the user's browser and account session.

Changing controllers does not authorize bypassing a blocked page or protocol
restriction. A supported extension reload is separate from opening its popup.
Never report that the current worker loaded merely because disk files changed.

The native login host and injected form restrict credential entry to
the exact `https://id.blooket.com/login` URL. A redirect query or fragment
must stop without forwarding credential-bearing scripts. These synthetic
safety checks do not prove an authenticated login or provider response.

## Acceptance and continuation

On 2026-10-14, the existing auto-connect controller enumerated pages in the
owner's original Chrome for Testing profile. Its Markdown extension inventory
identified the enabled Blooket API companion, and the supported reload command
returned `Extension reloaded.` without restarting Chrome or creating a profile.
The canonical scoped capability probe then succeeded. Computer Use observed
a newly created fictional set after one canonical publication step, but that
step remained reconciliation-required without a confirmed receipt.

Existing pending attempts were preserved, and the new attempt was not replayed.

Computer Use can still inspect the authenticated pages. Enter on the local
workspace's Quizzes control opened that panel, while Enter on Blooket's My
Sets link and Edit Info button changed focus without activating the controls.
Native clicks and captures previously timed out. Do not generalize one
working keyboard control into restored provider interaction or acceptance.

On 2026-10-14, the selected integrated Chrome controller explicitly required
an update of the ChatGPT Chrome extension before further operations. Earlier
page observations worked, while native actions and captures timed out.
This is a controller dependency update; the product companion has its own
separate reload and loaded-contract verification.

Preserve the existing profile, authenticated session and pending journals while
recovering the controller. The installed Chrome DevTools MCP configuration had
no existing-browser attachment configured, so invoking it would not establish
access to this session. A previous existing-browser CLI attachment also failed.
No alternative profile was created to replace that acceptance environment.

Account-mutation authorization persists for the specific development account
and authorized test scope. Preserve teacher-owned media and existing journals;
an ambiguous Save is reconciled rather than replayed. CAPTCHA, organization
selection, unfamiliar security states, and unsaved forms retain their stops.

Verify through the canonical CLI/MCP publication flow and fresh provider reads.
Direct website edits establish website behavior, while synthetic tests establish
portable behavior. Neither alone closes canonical publication acceptance.
Keep captures, cookies, account payloads, and credentials out of committed
files.

Agents without browser access use Web Search for current official Blooket,
Google/Chromium, Microsoft Playwright, MDN, Node, and Apple documentation, then
follow [the development handoff](blooket-development-handoff.md). Record the
source/date and continue implementation without inventing live observations.
Mac/Safari execution belongs to the ongoing platform task, not a prerequisite
for portable functionality or browser publication fixes.

<!-- jig-ignore-next-line: Keep the exact official source URL intact. -->
[playwright-extension]: https://github.com/microsoft/playwright/blob/main/packages/extension/README.md
<!-- jig-ignore-next-line: Keep the exact official source URL intact. -->
[devtools-attachment]: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md
<!-- jig-ignore-next-line: Keep the exact official source URL intact. -->
[devtools-tools]: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md
<!-- jig-ignore-next-line: Keep the exact official source URL intact. -->
[devtools-connection]: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/BrowserManager.ts
