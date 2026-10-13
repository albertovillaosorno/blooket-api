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

Only after that confirms a running controller with the authorized existing
browser attachment, inspect its actual pages and extensions:

```sh
chrome-devtools list_pages --output-format=json
chrome-devtools list_extensions --output-format=json
```

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

## Acceptance and continuation

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
