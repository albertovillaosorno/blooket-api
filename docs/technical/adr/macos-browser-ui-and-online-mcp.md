# macOS browser UI and required online MCP

## Status

Accepted product direction; partially implemented as of 2026-10-06. The local
browser UI/API, development tunnel, OAuth/PKCE MCP gateway, and lightweight
diagnostics exist. Complete Blooket publication remains pending; macOS,
Safari, and ChatGPT-specific hardening is centralized in task blooket-15.

This decision replaces the initial native-desktop-first presentation plan, Linux
product test baseline, and deferred remote-relay scope. Existing portable
implementations and useful tests remain; no domain rewrite is implied.

## Decision ID

`blooket-api.product.macos-browser-ui-and-online-mcp`

## Context

The user restored Safari packaging via GitHub Actions macOS runners on
2026-10-06. Chrome is tested directly on Linux and macOS; Safari conversion and
native acceptance use macOS. Releases use vYY.Q.PATCH quarterly CalVer tags.

The product Mac target is ARM64. Release publishes only `darwin-arm64.zip`;
the Safari companion is embedded in `Blooket API.app`, and Linux remains a
development/validation package.

The initial recipient is one teacher with a Mac who wants to create quizzes
quickly with ChatGPT. A browser interface keeps review and editing in the same
daily workflow. Online AI access is essential to that workflow, not an optional
enterprise feature. The user provisions the Cloudflare domain, tunnel, and MCP
client connection.

The product architecture is ARM64. Runtime OS support remains validated by
package/runtime policy and platform hardening rather than appearance heuristics.
No virtual-machine project is required for ordinary development.

## Decision

### Local service and browser UI

Target macOS only. Run a small local background service that owns projects,
media, settings, secrets, and browser execution. Serve the UI and its HTTP API
from the same loopback origin. The user opens the page on demand; the initial
release requires neither a native desktop window nor a permanent Dock icon.

Share browser-safe behavior through `src/ui/general/` with the optional Safari
extension. Declare the web host in Jig when implementing it, replacing the
unused desktop host boundary. Preserve the canonical IR and executor. The UI
cannot directly access another site's authenticated page; browser automation
remains behind the existing Blooket ports.

The loopback media GET handler reads only a validated local asset ID and
an `O_NOFOLLOW` file descriptor bounded to 25 MB. It verifies bytes before
sending an HTTP 200 response, so a replaced pathname, symbolic asset, or
oversized local file cannot escape through a late unbounded read. Synthetic
HTTP tests cover both ordinary bytes and these refusal paths.


The packaged Safari extension setup helper now verifies the expected
companion directory, executable helper, and identifier text are not symbolic
links. It reads the identifier from one bounded `O_NOFOLLOW` descriptor,
rejecting changed or oversized bytes before issuing any launch command.
Portable filesystem tests exercise only an injected command runner; they do
not enable Safari or prove macOS installation acceptance.

### Online MCP and user-owned tunnel setup

Expose a dedicated loopback MCP gateway with Streamable HTTP through the
user-configured Cloudflare Tunnel and stable HTTPS hostname. The gateway
executes registered canonical CLI commands in JSON mode. It does not import
application internals or accept arbitrary process commands.

The tunnel provides connectivity. Authenticate and authorize MCP tools through
the user's compatible setup before execution. Publish only MCP routes and
required authorization/discovery endpoints. Keep the local UI, general API,
settings, secret management, and arbitrary filesystem routes private.

ChatGPT supports remote MCP over streaming HTTP or SSE and documents OAuth
authentication. Its authorization flow is distinct from the tunnel credential;
do not assume arbitrary Cloudflare service-token headers are accepted. Confirm
protocol behavior through the documented MCP/OAuth contract. Client-specific
compatibility belongs to task blooket-15 rather than blocking core authorization
work.

The Mac must be awake with the service and tunnel running. Disconnects preserve
execution state and do not automatically replay an ambiguous mutation.

### Settings and credential entry

The local UI accepts the public hostname and a masked Cloudflare tunnel token
with Save. The user handles external provisioning. Extend the existing settings
schema with migration, UI locale, email, media root, explicit GIF FPS, tunnel
enablement, full public MCP URL, secret references, and diagnostic status.
Persist ordinary settings atomically and store credential values in Keychain
through `HostSecretStore`.

The background process reads saved settings and secret values internally. UI
responses expose only configured/missing status. Never return stored tokens,
Blooket credentials, cookies, or authorization headers through UI, API, CLI, or
MCP results.

A Cloudflare tunnel token, an MCP authorization credential, and a Blooket
credential are independent secrets. A failed secret/settings save must leave an
explicit recoverable state rather than claiming successful setup.

### Packaging and first-use verification

The delivery scope is one ARM64 macOS application plus a Linux x64 package
for developer testing. The Mac app opens the local workspace on launch;
settings expose extension setup and visible service controls. Linux validation
does not establish Keychain, Safari, or macOS signing behavior.

Include the runtime, native Sharp/libvips dependencies, UI assets, CLI, and the
selected cloudflared delivery mechanism. Do not require Metal acceleration or a
Windows build. A Linux x64 test package is now required.

Development can proceed without a VM. Portable tests on Fedora remain useful;
platform-specific behavior is covered by the opt-in ARM64 macOS CI stage and
final platform-hardening record.

Run one bounded first-use diagnostic on the installed Mac. Check runtime
OS/architecture, settings decoding, disposable application-data storage, local
port availability, a tiny native image decode, Keychain client availability, and
configured service/tunnel prerequisites. Distinguish missing configuration from
failed dependencies. Do not change Blooket, write real credentials, run the full
test suite, or require an unconfigured tunnel to connect.

Persist the first attempt's diagnostic/check version, outcome, timestamp, stable
failure codes, and local log reference in settings. Do not automatically rerun
the suite on every launch. Offer manual diagnostics after configuration or
repair.

Keep logs bounded and sanitized, with useful OS/runtime versions and failure
codes but no private quizzes, tokens, passwords, cookies, or raw secret command
output. Let independent features remain usable.

A first-use diagnostic is evidence of its narrow checks, not proof of full
quiz publication or recovery behavior. Broader macOS/Safari acceptance belongs
to task blooket-15 and must not reopen functional records.

### Blooket API evidence

On 2026-10-05, unauthenticated GET requests to `blooket.com/api`,
`www.blooket.com/api`, and `dashboard.blooket.com/api` ended in HTTP 403. The
first also redirected to the public homepage. Opening `www.blooket.com/api` in
the user's Chrome reached the public homepage, not API documentation or a JSON
service response. These observations do not prove an API is absent.

The recovered dashboard client has internal `/api/v2/unsplash/search`,
`/api/v2/unsplash/track`, and `/api/v2/download/image` routes in modules 90151,
30661, and 18622. They establish media-related client paths, not a supported
quiz creation API. The current authenticated client inspection also confirms RSC
dashboard reads and server-action bindings, as recorded below. Prefer verified
HTTP operations with the existing browser execution as fallback; reconcile any
ambiguous write before switching transports.

Do not probe guessed mutations or treat a base `/api` URL as a stable contract.

### Current authenticated transport inspection

On 2026-10-05, inspected the active dashboard build
`4e10e84779aaa361fd4310c02366e37ebee7b60d` through ordinary My Sets/Create
loads. Navigation reads return `text/x-component` RSC responses; some prefetched
reads returned 503, so do not treat prefetch status as a validated quiz read
contract.

The live Create chunk `page-dd33cffe7245f84a.js` includes module 9898 with 17
server-action references. The create-form export `b2` binds the same action ID
seen in the older capture, but matching IDs do not establish a durable API. The
runtime implementation constructs a POST to the current route with `Next-Action`
and encoded Flight arguments rather than a discovered public REST CRUD route.

During this initial inspection no create/edit action was invoked and no quiz was
changed. A read attempt on the observed Unsplash search route was blocked by the
browser client; no JSON response contract was recovered from that attempt. No
usable beta quiz API was verified; absence of evidence is not evidence that no
other service exists.

Candidate HTTP operations still need authenticated payload/response validation
and explicit mutation confirmation. A failed or timed-out primary mutation does
not permit automatic browser fallback without reconciliation.

### Development verification on 2026-10-06

The user-configured development tunnel passed OAuth/PKCE with local consent, MCP
initialization/tool discovery, and a read through the canonical CLI using a
synthetic client. Public requests to local UI/settings routes returned 404;
unauthorized MCP requests returned 401. This does not establish actual ChatGPT
compatibility or a completed security review.

A private one-question quiz was subsequently created through the authorized
Blooket UI. Its question was changed to typing with a 15-second limit and the
change persisted after reload. Multipart create/add/update request fields were
observed, but the action response body was not recovered and application-driven
publication remains unimplemented.

The user prefers additional owner-password verification during local connection
approval. Preserve OAuth/PKCE and review client/redirect identity, scopes,
revocation, and phishing behavior; a password alone does not establish client
identity. `MCP_PASSWORD` is not yet consumed or enforced. Track implementation
and actual-client verification in `TODO.md`.

## Consequences

- One browser UI serves the initial Mac workflow and shares extension behavior.
- Online AI access is a first-release requirement with user-provisioned hosting.
- Existing IR, CLI execution, persistence, and recovery semantics are retained.
- macOS/Safari-specific hardening is centralized in task blooket-15.
- First-use diagnostics provide repair evidence without requiring a VM project.

## Rejected Alternatives

- A native desktop window is deferred because the browser meets the initial UI
  need and avoids another presentation host.
- Linux as the teacher's target remains outside scope; Linux x64 delivery is now
  required for developer testing of the same service and Chrome extension.
- VM provisioning is excluded from the prototype plan; it is not required to
  prepare the service or collect a first-use diagnostic.
- A public general API is rejected because only the approved MCP tools need
  online access. The configured tunnel targets the narrow gateway.
- Storing token values in ordinary settings is rejected in favor of existing
  Keychain storage with secret references and the same local Save workflow.

## Verification

The roadmap is complete only when the local UI can save the user-provided
configuration, the first-use diagnostic records and reports its real result, and
the actual online AI account can execute an authenticated MCP read. Quiz
publication additionally needs an approved end-to-end create/read-back and
interruption/recovery exercise through the same canonical executor.

Linux x64 package and Chrome checks remain development validation. ARM64 Mac
and Safari behavior is exercised by the native CI stage. VM provisioning is not
a release gate. Existing portable test failures must still be reported; product
scope is not permission to delete or weaken working coverage.

### Sources

- [Identify Apple silicon or Intel][chip].
- [Apple virtualization architecture][vm].
- [OpenCore bootloader][opencore].
- [Cloudflare Tunnel routing][tunnel].
- [ChatGPT custom MCP servers][mcp].
- [MCP authentication for ChatGPT][auth].

[chip]: https://support.apple.com/en-us/116943
[vm]: https://developer.apple.com/videos/play/wwdc2022/10002/
[opencore]: https://github.com/acidanthera/OpenCorePkg
[tunnel]: https://developers.cloudflare.com/tunnel/concepts/routing/
[mcp]: https://developers.openai.com/api/docs/guides/custom-mcp-server
[auth]: https://developers.openai.com/plugins/build/auth
