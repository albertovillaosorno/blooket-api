# blooket-api

A local-first TypeScript toolkit for a teacher who wants AI to help create
Blooket quizzes without spending the afternoon uploading and formatting media.

Ask an AI for a quiz and let the registered tools publish and verify it on
Blooket. Browser review and supported corrections are available without a
routine approval gate. A background service on each teacher's Mac or
Linux computer owns files, credentials, media preparation, and execution.
An optional Cloudflare Tunnel connects online AI clients to its authenticated
MCP gateway.

**The admitted publication and personal Linux delivery workflows are
complete.** Real Blooket acceptance covers creation, prepared question images,
appending questions, bounded text-question replacement, recovery and fresh
remote verification through the canonical CLI/MCP tools. The product has saved
and verified a two-question image/typing quiz without controller Save.

This does not promise uninterrupted operation or universal platform support.
Provider-read stops remain recoverable, updates use verified downloads with
manual installation, and native Mac/Safari and remote ChatGPT-client acceptance
remain in ongoing maintenance. [TODO.md](TODO.md) also tracks the requested
save/paste media follow-up; completed records retain the dated acceptance
evidence for publication and delivery.

The project is independent of Blooket and is not endorsed by the platform.

## What works today

- A localhost browser workspace with English and Spanish interfaces.
- A photo/GIF library with optimized canonical media and mirrored YAML
  metadata. Temporary intake bytes are discarded after canonicalization.
  Save and prepare persists the rendered media in the selected media folder,
  and the gallery displays that saved rendition rather than the edit source.
  Names are unique within a library, without overwriting an existing image.

  Animated GIF paste prefers original bytes or a direct `.gif` URL over a
  flattened clipboard preview when available.
- An editor with zoom buttons and slider, dragging, saturation, contrast,
  blurred or solid backgrounds, color picking, undo/redo, and prepared exports.
- Explicit GIF export FPS, defaulting to 10, with bounded duration, frames,
  pixels, and output size. Prepared files must be below 2,500,000 bytes.
  Native media jobs run in isolated workers with a 20-second deadline.
- Local configuration for email, masked credential replacement, port, media
  folder, online connection, and export defaults.
- Personal skills and recoverable quiz drafts with revision checks. Startup
  installs initial authoring skills without replacing personal changes.
- Real Blooket publication with durable progress, pacing, cancellation,
  read-only reconciliation and separate remote verification. Supported
  questions include multiple choice and typing answers with per-question time.
- A Streamable HTTP MCP gateway with OAuth/PKCE and approval in the local UI.
  Approval requires the owner password; connections can be rejected or revoked.
  Its tools execute the canonical CLI rather than a separate implementation.
- A lightweight first-use diagnostic, saved locally, with a manual rerun.
- Explicit local service stop and reversible packaged Mac login startup,
  showing the OS authorization state instead of inferring it from a preference.
- A verified Linux x64 package and on-demand GitHub update checks/downloads
  with SHA-256 verification. Installation preserves the old app manually.

Registered MCP tools retrieve teacher instructions, search/read/enrich media,
manage skills and drafts, and expose guarded quiz publication, status,
verification and recovery via the canonical CLI. The explicit
`library_image_import` tool admits small canonical base64 image bytes supplied
by the client (up to 675 KB), returning a stable media ID that is safe to reuse
after a lost response.
After enrichment, `library_image_prepare` prepares that stable ID at its
current revision using the existing teacher recipe. Import, normalization and
preparation can therefore finish through MCP without a local editor step.

Chat attachments are not automatically forwarded to MCP; larger assets can be
imported through the local Studio UI. Media search returns bounded pages and a
continuation cursor. **Saving a draft does not publish a quiz**;
only a completed, freshly verified remote operation does.

Linux x64 and macOS ARM64 are both intended personal-use targets. The Linux
package has passed local startup, native media preparation, packaged CLI,
repeated launch and shutdown. The macOS target is ARM64;
CI is configured to build its Safari WebExtension companion into `Blooket
API.app`. Native Mac acceptance and signing/notarization remain in ongoing
platform hardening.

The owner-approved Linux update workflow checks GitHub's
SHA-256 and stages the archive for manual installation with the previous app
retained; automatic application replacement is optional future work.

Chrome and Firefox extensions can be assembled locally. Authenticated set
summaries, private details, saved questions with bounded image evidence, and
capabilities have passed real service and CLI reads in authorized Chrome.

Creation, image verification, and an appended text question have also passed
live canonical reads. A text-question replacement has independently passed
fresh verification without controller Save. The panel also completed and
verified a two-question image/typing quiz after assisted provider-throttle
recovery.

On October 21, the product saved another two-question image/typing quiz
without controller Save. Fresh canonical verification at 15:56 and 16:00 UTC
confirmed all three operations and the frozen prepared image. Admitted
publication and AI authoring are complete; ongoing maintenance stays open.

These journeys include recoverable provider-read stops. They do not promise
uninterrupted operation under throttling or automatic chat-attachment transfer.

Non-empty collection completeness, pagination, public set details, and
unsupported media variants remain unknown or pending. Keep these limits
explicit when using the observed account capabilities.

See [TODO.md](TODO.md) for the ordered plan and dated evidence. Portable tests
cannot establish Keychain or native macOS compatibility. Chrome retains live
provider-read evidence; Firefox has portable build and bridge tests. The
ARM64 macOS CI stage builds and embeds the Safari companion; native
acceptance remains pending.

## Run the development workspace

Use Node.js 24 or newer and the pnpm version declared in `package.json`.
Dependencies are installed under `.dependencies/`, not root `node_modules/`.

```sh
pnpm install
```

If `.env` does not exist, copy [.env.example](.env.example) to `.env` and fill
values between the quotes. Keep an existing `.env`; it may already contain
credentials. Leave online fields empty for a local-only session.

```sh
BLOOKET_DATA_HOME="$PWD/.temp/dev-data" npm run dev
```

Open the local URL printed at startup. The default is
`http://127.0.0.1:2607`. The data-root override keeps disposable development
settings, media, skills, drafts, and logs under `.temp/`.

`npm run dev` explicitly reads the repository `.env`. Development secrets stay
in memory; ordinary values initialize saved preferences on each development
startup. Local UI changes remain saved, but supplied development values are
applied again on the next development startup.

`npm start` uses saved preferences and the host secret store without reading
`.env`. It is the normal service entrypoint, not a finished macOS installer.

Startup reuses a validated `diagnostics.json`; it does not rerun native checks
on every launch. Configuration provides an explicit diagnostic rerun. If the
cached file is corrupt and startup cannot open the UI, repair it using the same
data root:

```sh
BLOOKET_DATA_HOME="$PWD/.temp/dev-data" npm run launch -- --diagnostics
```

This explicit launcher action returns bounded diagnostic JSON and refreshes its
local log without starting the service or opening a browser. A failed check
produces a nonzero exit status; portable success does not prove Mac acceptance.

The repository pins the pnpm version in `package.json` and keeps its
package store under
`.dependencies/`. On 2026-10-11, the workstation's pnpm launcher passed
`pnpm run check` and a frozen lockfile-only install. Use npm scripts when pnpm
is unavailable; do not install a second project package store. Read the
[configuration record](docs/todo/completed/settings/configuration.mdc) before
changing dependency layout or validators.

## Use the local workspace

1. Open configuration, choose the UI language and media folder, and save any
   replacement credentials. Saved secrets are never returned to the page.
2. Import or paste a photo or GIF and provide only its teacher-authored name
   and description. Language identification, topics, and normalized English
   metadata are separate AI enrichment work; the AI uses stable asset IDs.
3. Edit framing, adjustments, and background. Export defaults initialize new
   recipes; each image keeps its own settings.
4. Prepare and review/download the rendition. Oversized output or a stale
   recipe cannot be offered as a valid prepared download.
5. Use skills and draft tools as recoverable working state. Publication is
   designed to proceed automatically through canonical execution; review and
   correction remain available but are not an approval gate.

The 1280-by-720 default canvas is an application choice, not a verified Blooket
requirement. GIF FPS controls timing, not a guaranteed file size.

## If Blooket requests browser verification

Use **Show connected tab** in Quizzes to bring forward the extension's actual
Blooket session, then complete any provider verification yourself. **Check My
Sets read** checks that same session without publishing or signing in. A
challenge during the read remains an interrupted read, never a success.

If no extension is connected, **Open Blooket in my browser** opens the ordinary
system browser. Enable Blooket API in that browser and open the local workspace
there. Separate browsers/profiles have separate sessions; verification in one
profile does not authenticate another. When multiple profiles connect, the app
stops and asks you to close the extra profiles before trying again.

For browser and firewall diagnostics, open the
[Blooket system debugger](https://debug.blooket.com/) in a **new tab of the
same regular browser/profile** that runs the connected extension (Firefox or
Chrome). A result copied from another browser, profile, or isolated automation
session is not proof of this session's readiness. `IP not Geoblocked` alone
is also not proof that all browser checks or a provider challenge passed.

If any debugger checks fail, follow Blooket's school IT guidance; if they
pass but access still fails, Blooket requests a problem description and a
browser-console screenshot. Never share passwords, session cookies, or tokens.

These controls do not run a CAPTCHA solver or change browser security settings.
They also do not configure Cloudflare Tunnel, which is the separate online MCP
connection described below.

## Connect an online AI client

Cloudflare Tunnel is the supported provider. The user provisions the hostname
and tunnel; this application does not create them. The computer must remain
awake with the service, network, and tunnel running.

In local configuration, enable Online MCP and provide the public URL and tunnel
token. For development, the corresponding fields are:

```dotenv
LOCAL_HTTP_PORT="2607"
MCP_PUBLIC_URL="https://your-host.example/mcp"
CLOUDFLARE_TUNNEL_TOKEN=""
MCP_OWNER_PASSWORD=""
```

The public URL must include `https://` and end in `/mcp`. Bare hostnames,
embedded credentials, other paths, query parameters, and fragments are rejected.

For local port 2607, configure Cloudflare's origin as
`http://127.0.0.1:2608` and leave the hostname **Path filter empty**. OAuth and
discovery need `/oauth/` and `/.well-known/` routes in addition to `/mcp`.

Configure the AI client manually with the public MCP URL. Complete its OAuth
flow, review the client/redirect/access details, and approve the matching
connection with the owner password in the local workspace. Names and redirects
are unverified client claims; approve only a connection you initiated.

The tunnel token authorizes Cloudflare connectivity; it is not an MCP access
token.

Only MCP and authorization routes are public. The browser UI, settings, general
API, and arbitrary files remain private. Unauthenticated `/mcp` returns 401;
private UI/API routes return 404 at the public gateway.

The configured tunnel passed a synthetic OAuth/PKCE and MCP tool-call test.
Actual ChatGPT authorization, attachment delivery, and reconnect behavior still
require acceptance. Restart deliberately clears clients, codes, and tokens;
reauthorize afterward. Refresh tokens are issued only when offline access was
requested and approved.

Local password checks have a bounded attempt budget.
A tunnel does not remove AI usage limits. Chat attachments and local files do
not automatically become accessible to MCP.

## Files and credentials

The library opens with up to 12 randomly selected images. **Another selection**
chooses a new set without sorting the collection. Search still covers the whole
library, with at most 12 results per page.

Use **Paste** to import a clipboard image or a direct HTTP/HTTPS image link.
The usual Ctrl+V / ⌘V shortcut also works while the library is open.
Pasting into an input keeps its normal text behavior. The import dialog lets
you provide the original name and description before saving.

Browsers may request clipboard
permission; the keyboard shortcut remains available when button access is
unavailable. A webpage link is not a direct image link.

Remote images pass a local-only, CSRF-protected download boundary. Downloads
have a 20-second deadline, three redirects, and a 25 MB source ceiling; each
connection pins a public DNS answer and sends no local credentials. Imported
bytes still pass the existing image decoder and export-size guard.

Supplied artwork under `assets/icon/` appears in the workspace and MCP settings.
Package assembly generates Chrome PNG sizes and the macOS ICNS from that
artwork. The optional MCP display metadata still requires manual client setup.

Normal macOS data lives in `~/Library/Application Support/blooket-api/`:

```text
settings.json       Ordinary preferences; no passwords or tunnel tokens
diagnostics.json    First-use check results
logs/               Sanitized local diagnostic records
skills/             Personal authoring guidance
drafts/             Recoverable local quiz documents
media/              Default media root; selectable in local configuration
  photos/           Service-owned canonical WebP/GIF assets
  metadata/         YAML mirrored by canonical asset filename
  renditions/       Derived export files
```

New intake keeps the teacher's name and description but not the uploaded
source blob or filename. Static media is canonicalized to high-quality WebP and
animated media to optimized GIF, then addressed by stable ID. Language, topics,
and normalized English are separate revision-protected AI enrichment.

When a previous `media.jsonl` exists in the selected library folder, use
**Import the previous library**. Legacy migration preserves historical files,
archives
the exact index as `media.jsonl.migrated`, and creates mirrored YAML. Migrated
schema-2 records retain historical English verification and its source revision;
an unspecified original language stays empty.

For the old vault layout, the
immutable original is selected instead of its prepared working image. Missing
or conflicting originals stop migration before any records are published.

Interrupted transfers resume under the library lock on startup. Changed sources
or metadata stop recovery with the journal intact; repair the conflict before
continuing. Never delete a pending journal to force the library open.

Production Blooket passwords, tunnel tokens, and the salted owner-password
verifier belong in macOS Keychain. The owner password stays separate from the
Blooket password and tunnel credential; its plaintext is not saved.

The host adapter sends secret payloads through stdin, verifies writes, and
returns only configured/missing status. `.env` is ignored development
configuration, not
production secret storage. Partial configuration saves report which secret
replacements succeeded before a failure.

## Execution and integration boundaries

`src/ir/` owns strict runtime contracts. `src/api/` composes domain operations;
CLI and localhost HTTP share that executor. `src/mcp/` invokes the canonical CLI
in JSON mode.

Media, projects, settings, and security own their domain behavior;
`src/platforms/` adapts filesystem and host capabilities. `src/service/` hosts
the background process, and `src/ui/teacher-workspace/` serves the browser UI.

Untrusted JSON passes exact decoders and semantic checks before becoming a
write plan. Remote execution uses journals, checkpoints, receipts, and
reconciliation. Ambiguous mutations must not be blindly retried or immediately
sent through another transport.

Blooket integration is unsupported and may change. Recovered client references
and observed HTTP actions are evidence, not a stable public API. Their response
contracts and concrete browser adapters need verification before activation.
Client form limits alone do not prove server constraints.

Provider verification may settle automatically; execution requires fresh
session evidence before continuing. Interactive challenges, organization
selection and unfamiliar security states preserve a human-action stop.
Shared pacing and cancellation are implemented; challenge bypass and anti-bot
evasion are outside the design.

Linux x64 and macOS ARM64 are personal-use targets. Linux package delivery
has passed local verification; native Mac/Safari acceptance remains in P4.
The bundled Node 24 runtime requires macOS 13.5 or later; confirm the OS before
installation. No VM or Metal requirement is part of the initial plan.

Package assembly uses the system C compiler for its small native update helper.

## Install on a trusted personal Mac without Apple Developer

**An Apple Developer account or Team ID is not needed to build, run, or
manually approve this app on a Mac you control with the owner's consent.**
The ARM64 Mac must run macOS 13.5 or newer. This is an explicit, personal
installation/test route, **not** a notarized public release or a working
automatic updater. The bundled Safari extension and native Mac acceptance
still need testing on the actual machine.

On that Mac, open **Terminal**. First check the host:

```sh
uname -m
sw_vers -productVersion
```

`uname -m` must print `arm64`. A local build also needs Apple's free
Xcode Command Line Tools (`xcode-select --install` if `cc` is unavailable),
not an Apple Developer Program subscription. If you are building from your
trusted source rather than installing a separately authenticated release,
use Node.js 24, the pinned pnpm version, and the packaging commands:

```sh
git clone https://github.com/albertovillaosorno/blooket-api.git
cd blooket-api
pnpm install --frozen-lockfile
npm run check
npm run package -- darwin-arm64
```

This produces `.temp/distributions/darwin-arm64.zip` on the Mac. This local
command packages the base app and Chrome extension; the native Safari companion
is embedded only by the separate macOS CI process, not this build command.

Package assembly is not Apple notarization. If you received an archive, first
verify its provenance through a trusted channel; `shasum` below displays its
SHA-256 but **a checksum supplied with an untrusted download is not publisher
authentication**. Do not install a ZIP you have not independently trusted.

To install the *first* personally trusted build for the logged-in Mac user,
run the following from the cloned repository. Change `ARCHIVE` if your
verified ZIP is elsewhere. The commands refuse to replace an existing app:

```sh
set -eu
ARCHIVE="$PWD/.temp/distributions/darwin-arm64.zip"
APP="$HOME/Applications/Blooket API.app"
[ "$(uname -m)" = arm64 ] && [ -f "$ARCHIVE" ]
shasum -a 256 "$ARCHIVE"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/blooket-api-install.XXXXXXXX")"
ditto -x -k "$ARCHIVE" "$STAGE"
BUNDLE="$STAGE/Blooket API.app"
[ -f "$BUNDLE/Contents/Info.plist" ]
INFO="$BUNDLE/Contents/Info.plist"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO")"
[ "$BUNDLE_ID" = com.albertovilla.blooket-api ]
if [ -e "$APP" ]; then
  echo 'Already installed: stop; do not overwrite.' >&2
  exit 1
fi
mkdir -p "$HOME/Applications"
ditto --rsrc --extattr "$BUNDLE" "$APP"
open "$APP"
```

If Gatekeeper blocks the app and you personally trust the exact build,
choose **System Settings → Privacy & Security → Open Anyway** after the first
launch attempt, then confirm **Open**. This is Apple's recommended per-app
manual exception; it does not require a Developer ID. Do not proceed if macOS
reports that the app contains malware or has been damaged.

If you deliberately prefer Terminal and have independently verified the
personal build, this **optional, per-app** command removes the downloaded
quarantine attribute before retrying. It bypasses a macOS security check;
never apply it to an untrusted download or run it automatically:

```sh
xattr -dr com.apple.quarantine "$HOME/Applications/Blooket API.app"
open "$HOME/Applications/Blooket API.app"
```

Do **not** disable Gatekeeper globally, change permissions to `777`, or run
these commands with `sudo`. Use the Mac owner's account and permission; the
app needs no Apple Developer credentials or Team ID to launch manually.

An installed copy, data, media, passwords, and drafts must not be removed as
part of a later update. **Do not overwrite a running copy to upgrade it**: the
transactional installer and rollback are not enabled yet. The private data
root remains `~/Library/Application Support/blooket-api/`.

Automatic installation is a different trust boundary: the current updater
refuses unsigned/unnotarized candidates and still requires a verified Apple
publisher Team ID **as currently implemented**. A future no-Developer-ID
personal-update path would need pinned publisher signatures, exact byte
verification, explicit macOS approval, safe process shutdown, rollback and
recovery before enabling installation. Manual macOS permission does not by
itself satisfy those checks.

See [Apple's instructions](https://support.apple.com/en-us/102445)
and the [update decision](docs/technical/adr/product-update-lifecycle.md).

## Packages and releases

Remote CI is deliberately opt-in so ordinary pushes and pull requests do not
consume hosted-runner time. Local TypeScript and tests are the default
development gate.

Push a tag matching `ci-*` only when remote native validation is useful. That CI
workflow first runs strict TypeScript, roadmap validation, the full test suite,
and Linux package assembly/verification on Ubuntu. Only after that job passes
does `macos-arm` run on `macos-26`, require ARM64, build and verify the Mac
package, compile/embed the Safari companion, exercise Safari WebDriver, and
upload the single verified `package-darwin-arm64` workflow artifact. A CI tag
never creates a GitHub Release.

Product versions use `YY.Q.PATCH`; Git tags retain the `v` prefix. Tags use UTC
three-month quarters: `vYY.Q.PATCH`, with Q from 1 through 4. For example,
`v26.4.0` is October–December 2026, with product version `26.4.0`.

Q1 is Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, and Q4 Oct–Dec. YY means 2000–2099;
PATCH is 0–99999 without leading zeros. The gate requires the tag to match the
committed `PRODUCT_VERSION`; package metadata is a checked projection.

A deliberately authorized release tag runs Linux CI against the exact tagged
commit, including package assembly and release-package verification. The release
gate also requires valid quarterly CalVer and `RELEASE_ENABLED=true`.
Publication then downloads the verified `package-linux-x64` CI artifact and
uploads `linux-x64.tar.gz` to GitHub Releases; it does not rebuild or rerun
tests. Native Mac/Safari CI runs on explicit `ci-*` tags and does not block
Linux release publication.

Apple credentials and a separately signed update manifest are not prerequisites
for the personal Linux workflow. Downloads use the fixed GitHub repository's
asset digest; installation remains manual. Legacy Apple publisher-verification
infrastructure does not establish native Mac acceptance or enable automatic
replacement.

There is no automated changelog and no repository release-notes file is
required. The workflow creates the release with empty notes; write the human
release notes manually in the GitHub Release UI afterward. It never calls
GitHub's generated-notes feature.

Normal branch pushes do not run GitHub Actions. Use local validation while
developing and reserve a `ci-*` tag for deliberate native-runner validation.
A `vYY.Q.PATCH` release tag invokes CI itself, so do not add a second CI tag
for the same release commit.

Jig is a local repository validator and is not part of GitHub Actions. Apple
signing and remaining native macOS/Safari hardening stay centralized in
`blooket-15`.

To build and verify a local package on the matching host:

```sh
npm run package -- linux-x64
npm run package:verify -- linux-x64
```

Package targets are `linux-x64` and `darwin-arm64`. Outputs live under
`.temp/distributions/`; assembly refuses to overwrite an existing target
directory or archive. Use the same explicit output name for a separate build
and its verification, while reusing the existing dependency/download cache:

```sh
npm run package -- linux-x64 --output acceptance
npm run package:verify -- linux-x64 --output acceptance
```

This selects `.temp/distributions/acceptance/`; output names cannot select
arbitrary paths. Archive publication never overwrites a previous artifact.

Packages include their Node runtime, native Sharp/libvips libraries, and
Cloudflare
connector. They exclude `.env`, private references, and developer instructions.
Distribution metadata records the source commit, dirty state, dependency
versions, and integrity scope.

An unsigned local build is a development artifact.

To assemble the unpacked Chrome and Firefox extensions:

```sh
npm run package -- --extension
npm run package -- --firefox-extension
```

In Chrome 110 or newer, open `chrome://extensions`, enable Developer mode,
and select **Load unpacked** at `.temp/distributions/browser-extension/`.

In desktop Firefox 142 or newer (158 was tested on Fedora), open
`about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**,
and pick `manifest.json` inside
`.temp/distributions/firefox-extension/`. Open the Blooket API workspace
**in that same Firefox profile** to connect it.

Temporary Firefox add-ons are removed when Firefox restarts; reload them
through `about:debugging` for local use. Permanent installation on ordinary
Firefox requires a Mozilla-signed add-on; that signing is separate from Apple
Developer membership, which is never needed here. A locally produced
unsigned `.xpi` is not a permanent-install workaround.

Native packages include both folders under `extensions/chrome/` and
`extensions/firefox/` in their resources. On macOS those paths are within
`Blooket API.app/Contents/Resources/`; on Linux they are under the extracted
package's `extensions/` directory. These are manual, opt-in browser installs,
not browser-store or Mozilla-signed distribution claims.

The extension requests scripting/storage and access only to the Blooket
dashboard, Blooket identity login, and the two admitted IPv4 loopback addresses.
No cookie permission or general web access is requested.

Open Blooket API normally. Its local workspace announces the connection
inside the extension's isolated page context; the extension discovers already
open workspace tabs when it starts. It connects automatically and opens its own
Blooket tab without changing the teacher's existing tabs.

That dedicated tab is reserved for automation. By default, a later CLI read
recovers its own question-inspection panel even after accidental clicks or
typing, discarding unsaved edits in that read panel. Use your other tabs for
manual editing. Recovery never submits a form or replays an uncertain Save.

There is no connection form, pairing code, or Blooket credential entry in the
extension. Its popup shows readiness and shortcuts to the workspace and Blooket.
The connection follows the workspace's actual port and reconnects after a
service restart; tokens stay in memory/session storage and never reach an AI.
IPv6-only local service bindings are not supported by this extension yet.

The connected service exposes five read-only MCP tools:
`blooket_session_inspect`, `blooket_capabilities_inspect`, `blooket_sets_list`,
`blooket_sets_get`, and `blooket_questions_list`.
They run through the canonical CLI and the same local browser ports:

```sh
npm run blooket -- session inspect --json
npm run blooket -- capabilities inspect --text-only --json
npm run blooket -- sets list --json
npm run blooket -- sets get '<remote-set-id>' --json
```

Use the same user-data root as the running service. Development commands need
`BLOOKET_DATA_HOME="$PWD/.temp/service-test"` when the service uses that root.
These commands reuse the confirmed browser session and never load `.env`, read
credentials, or submit a login. A closed session requires signing in locally;
security challenges and organization prompts preserve the human-action stop.

The `--text-only` capabilities inspection is a read-only base preflight,
not a Create Set attempt. It skips account-dependent Audio and answer-image
drawers while retaining the snapshot's separate question-image availability.
Prepared question images still need explicit support and current validated
bytes.

Listing returns observed summaries, not a non-empty collection completeness
guarantee. The explicit empty-account state is bounded; pagination and remote
completeness acceptance remain pending.

New-quiz publication has canonical `publication step`, `status`,
`reconcile`, and `verify` CLI commands and matching `blooket_publication_*` MCP
tools. The local **Quizzes** view now shows the saved drafts' durable status
and has explicit Publish, Stop, Reconcile, and Verify controls for the same
canonical commands. Opening Quizzes never submits a Blooket write.

Quizzes also offers **Sign in with the saved account**, using the email and
password configured locally in Settings. This explicit action reuses a ready
session or makes one normal login attempt, stopping for challenges, organization
selection and provider waits. It does not publish quizzes or return credentials;
the separate My Sets check remains read-only.

Supply the saved draft ID and exact revision for each step; each call
performs at most one journaled write. Final fresh verification alone reports
`published: true`; local progress does not prove remote state.

A second draft with matching Create Set metadata cannot replay an already
started or confirmed creation, even when its planned questions differ.
Inspect the original publication instead of retrying a timed-out create.

This path has portable integration coverage across MCP, CLI, and local
service boundaries with a simulated provider.

An actual private quiz was also published and freshly verified through the
product UI and canonical CLI in Chrome. Create Set confirmed automatically
after reload and saved metadata/privacy checks. Its typing question was
confirmed through ordinary read-only journal reconciliation without
resubmission, and fresh reads verified its answer, exact matching and time.

Prepared question images are admitted by stable library ID; covers, answer
images and audio remain refused. On October 20, canonical creation of a
private quiz with a prepared question image passed separate fresh verification,
including exact saved image bytes. Existing-question replacement has a
canonical route and live text-only verification; broader edits remain
unsupported.

Canonical `publication append <draft-id> <revision> <set-id>` and
`blooket_publication_append` extend an existing set. The saved draft describes
the full desired quiz, preserving its existing metadata and question prefix.
Only the new suffix is sent; subsequent `step`, `status`, `reconcile` and
`verify` calls reuse the same frozen target and journal. Conflicting changes,
deletion, replacement and reordering are refused by the append operation.

Portable MCP-to-CLI-to-service
coverage verifies append behavior. On October 20, registered MCP handlers
also appended a typing question to the real image quiz and freshly verified
the full result, preserving its existing image question.

Canonical `publication replace <draft-id> <revision> <set-id>` and
`blooket_publication_replace` edit exactly one existing text question from a
new full desired draft. Metadata, question count and all other questions must
remain unchanged. The selected question keeps its type and answer count;
selected-row images/audio and deletion/reordering are refused before a write.

One native Edit/Save uses the same pacing, durable journal, read-only recovery
and separate final verification. It never falls back to Add Question. On
October 21, a text-only replacement passed fresh remote verification without
controller Save. The product also saved both questions of a new image/typing
quiz and separately verified all three operations after recoverable read stops.

Older ambiguous attempts remain journaled without replay. Completion does not
claim an uninterrupted run under provider throttling. The
[publication record](docs/todo/completed/blooket/publication.mdc) and
[AI authoring record](docs/todo/completed/teaching/ai-review.mdc) distinguish
autonomous writes, assisted historical checks and portable regression coverage.

The local CLI also corrects one existing set title or one question's text,
including questions that already have images:

```sh
npm run blooket -- sets revise-text request.json --json
```

For a title, supply the exact metadata returned by `sets get`:

```json
{
  "schemaVersion": 1,
  "expectedSet": {
    "schemaVersion": 1,
    "id": "exact-remote-set-id",
    "title": "Current saved title",
    "description": "Current saved description",
    "visibility": "private"
  },
  "change": {
    "kind": "set-title",
    "title": "Corrected title"
  }
}
```

For a question, use `change.kind: "question-text"`, `previous` containing the
exact normalized row from `questions list`, the desired `question`, and an
`answers` string array in the existing answer order. Correctness flags, answer
count, type, time, shuffle, order, media and set metadata remain unchanged.
Correct the text of a marked answer without changing its existing flag.

Each admission performs at most one Save, uses shared mutation pacing, and
retains a durable journal under `text-revisions/` in the local data root.
`verified: true` requires read-back from a freshly reloaded document.
The extension retains native media fields and checks their identity after
reload; the CLI never needs a provider media URL or a replacement upload.

An explicitly `not-submitted` result permits retrying the unchanged request
after fixing its reported preparation stage. An uncertain request only
reconciles on repetition without clicking Save. For an existing question,
two independent fresh documents proving the exact original text, non-text
facts and original media identity return `text-revision-reconciled-unchanged`.

That call stops and records recovery history; a separate paced invocation
may then apply the same idempotent text assignment to the same row. Mixed
state, unavailable media identity and verified requests never re-arm.
This recovery does not apply to creating sets or adding questions.

When the original submitted form remains open, recovery uses at most one
temporary background read tab. Only independent confirmation permits closing
that exact unchanged owned form; interrupted or mixed state stays pending.
The temporary tab must close before recovery can be reported.
This local CLI workflow uses the installed companion and signed-in session;
it does not require a browser testing controller.

The local **Settings → Blooket publication pacing** controls expose four
bounded, shared limits: seconds between mutation starts (2–60), mutation
starts per rolling minute (1–20), attempts per publication (1–10,000), and
task duration (1–1,440 minutes). Defaults remain 2 seconds, 20 per minute,
10,000 attempts and 24 hours. Changes take effect after restarting the local
service; a running journal retains its recovery identity.

Settings v3 are read with conservative defaults and migrated to v4 on the next
explicit save.
An old v3 Settings form cannot overwrite a saved v4 publication policy.

These are application safety limits, **not** verified Blooket rate limits.
The shared account-wide start history also persists under the service-owned
`mutation-pacing.json`; restarting the service cannot clear the recent rolling
minute or minimum interval. No account, quiz, credentials or other provider
content is saved in this timestamp-only file. An unreadable or corrupted
history blocks the next write instead of silently resetting limits.

Exhaustion stops before a new journal/remote write and never authorizes
replaying an uncertain attempt. A smaller attempt limit may stop an otherwise
valid long quiz until the teacher explicitly changes settings and restarts.

MCP runs the bundled runtime in the background without opening Terminal.

Authenticated private details, saved question/image reads, and account
capabilities work through the actual service and canonical CLI in Chrome.
Image evidence carries byte length and SHA-256 rather than provider URLs.
Nonempty set-list completeness remains unknown; public-detail and platform
hardening retain their own acceptance. Unsupported shapes fail validation
rather than inventing facts.

Keep the local workspace open for automatic discovery and restart recovery.
The normal launcher opens it. If the service runs without a browser page, the
popup's **Open workspace** shortcut uses the default local port 2607.

For development, `npm run launch -- --no-open` starts or reuses the normal
background service without opening another browser. If working with an
explicit test data root, pass that same `BLOOKET_DATA_HOME` environment
variable to the launcher. Restarting the service does not clear publication
journals, the per-plan mutation budget or recent account pacing history.

The portable tests exercise the compiled worker and synthetic browser APIs.
The ARM64 CI stage separately converts/compiles the Safari host and exercises
the packaged workspace through Safari WebDriver. Remaining Apple trust and
platform-specific hardening belongs to the final platform record.

For a personal Linux x64 installation, ensure `xdg-open` and a usable
Secret Service keyring (`secret-tool`) are installed and your login session
unlocks the keyring. Build and verify the package on Linux:

```sh
npm run package -- linux-x64 --output personal-linux
npm run package:verify -- linux-x64 --output personal-linux
mkdir -p "$HOME/Applications/blooket-api"
tar -xzf .temp/distributions/personal-linux/linux-x64.tar.gz \
  -C "$HOME/Applications/blooket-api"
"$HOME/Applications/blooket-api/blooket-api" --no-open
```

Then open the local workspace shown by the launcher in your Firefox profile,
with the Firefox add-on loaded from
`$HOME/Applications/blooket-api/extensions/firefox/manifest.json`.
Use `--status` to inspect the local service and `--stop` for clean shutdown.
Running the launcher without `--no-open` uses your system default browser.

To add Blooket API to the Linux desktop applications menu, explicitly run:

```sh
"$HOME/Applications/blooket-api/install-desktop-shortcut"
```

This writes only `~/.local/share/applications/blooket-api.desktop`, without
`sudo`. It refuses to replace an existing desktop entry. Move the installed
package only after removing that shortcut yourself; it records the exact
location of the executable and the icon. No menu item is added automatically.

To open Firefox explicitly without changing that default, use:

```sh
BLOOKET_BROWSER=firefox "$HOME/Applications/blooket-api/blooket-api"
```

The selection also applies to the Blooket tab opened from the app while its
service is started with this environment. Only `firefox` and `default` are
accepted; arbitrary executable paths and additional flags are not supported.

Keep one service and one browser profile per computer; your Linux data and
her macOS data, passwords, drafts and Blooket sessions stay on their own
machines. The Linux data root is user-owned and separate from the package.

For a later manual Linux upgrade, stop the managed instance first and preserve
its existing package as a backup. Never overwrite a running executable.
Replacing a stopped extracted package retains the user data root; deleting
the package does not remove saved settings, media or host-store secrets.
Automated Linux updates and rollback are not enabled yet.

Native Mac testing remains in P4. Personal Linux check/download and manual
installation are complete; automatic replacement is not enabled. Do not present
an unsigned archive as a trusted public automatic-update release.

## Develop and verify

The developer contract supports **Chrome for Testing**, **Playwright MCP**,
**Chrome DevTools MCP**, and the independently installed `chrome-devtools`
**CLI**, not only integrated browser control. Reuse the observed authorized
Chrome session and Blooket API extension; do not launch a second profile just
to work around a disconnected controller. The canonical `npm run blooket`
CLI and registered teacher MCP tools remain the proof of real publication
and recovery, with independent fresh Blooket read-back.

Read [browser acceptance tools](docs/technical/browser-acceptance-tools.md)
and the [developer profile](docs/agents/AGENTS-DEV.md) for safe attachment,
CLI commands, test scope, and secret boundaries. Portable Linux testing and
provider-drift regressions proceed now; native Mac/ARM64 and Safari assurance
remain in the perpetual hardening task rather than blocking functionality.

```sh
npm run validate
node --check src/ui/teacher-workspace/adapter-inbound/app.js
```

Jig's `scalability.repository-graph` rule currently records an evidenced
`not-evaluated` outcome while Jig's own schema/migration contract matures.
The repository's `npm run validate` runs strict TypeScript checking, roadmap
integrity, all portable tests, the existing `jig check --root .` rule
outcome report, and the authoritative `jig validate --root .` policy gate.
`jig check` currently retains the external graph gap.

Successful Jig validation has zero policy diagnostics but does not imply this
particular graph rule has been fully evaluated. The supporting schema source
files are part of Jig's validator build, not this product checkout.

Source, documentation, diagnostics, and commits use English. Product UI
language, quiz language, and original-media language are independent.

Read [AGENTS.md](AGENTS.md) for instruction routing, the
[developer profile](docs/agents/AGENTS-DEV.md) for repository rules,
and the
[user profile](docs/agents/AGENTS-TEACHER.md) for admitted teacher workflows.
Continue [TODO.md](TODO.md) in order and record actual verification instead of
marking externally blocked tasks complete.

Architecture decisions cover [browser hosting and online MCP][browser-mcp],
[settings and the media library][library], and
[atomic persistence][persistence].

## love u

> Avergonzado, sintiendo sobre sí la mirada reprobatoria de sus hermanos, sacó
> algunas naranjas de su bolsa y comenzó a tirarlas al aire, haciendo
> malabarismos, que era lo único que sabía hacer.

— Paulo Coelho, *El Alquimista*, Grijalbo, p. 13 («Prefacio»).
[Publisher's excerpt][coelho-excerpt].

<!-- jig-ignore-next-line: Exact publisher excerpt URL is indivisible. -->
[coelho-excerpt]: https://www.penguinlibros.com/mx/literatura-contemporanea/325758-libro-el-alquimista-biblioteca-paulo-coelho-9786073831420/fragmento

The quoted passage is reproduced from the cited work and is not covered by
this repository's MIT license.

## License

[MIT](LICENSE-MIT). See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for
third-party trademarks, assets, and dependency notices.

[browser-mcp]: docs/technical/adr/macos-browser-ui-and-online-mcp.md
[library]: docs/technical/adr/teacher-settings-and-media-library.md
[persistence]: docs/technical/adr/atomic-local-persistence.md

## Planning and update policy

[TODO.md](TODO.md) indexes only unfinished work, with one short entry per typed
record in [docs/todo/open](docs/todo/open/). Criteria, blockers, and evidence
belong in those records; completion moves them to `docs/todo/completed/` and
removes the index entry. See [the record workflow](docs/todo/README.md).

Configuration includes a manual “Check for updates” action with current
version, last-check time, and EN/ES status. It uses anonymous public metadata
with bounded requests, runs only when requested, and distinguishes unavailable
GitHub from “no new version”. Linux supports personal manual installation and
on-demand, verified GitHub downloads.

In Settings, select
**Check for updates**, then **Download and verify SHA-256** when a newer Linux
release exposes a GitHub digest. Blooket API checks the release in the fixed
repository, streams the archive to your private user-data directory, and
compares its exact byte count and SHA-256 to GitHub's API before showing the
verified archive path. No Apple Developer membership or Mac CI is involved.

The release job now publishes verified `linux-x64.tar.gz` from Ubuntu only;
optional Mac/Safari CI does not block Linux. If newer GitHub tags are Mac-only,
the Linux update check can select the newest compatible Linux release.

A GitHub digest verifies that downloaded bytes match that release asset. It
does not independently verify who controlled the publishing GitHub account.
Missing hashes, wrong bytes, unexpected redirects and incomplete downloads
never produce usable archives.

**Installation is manual for now.** Stop Blooket API via `--stop`, preserve
the existing extracted package as a backup, and unpack the verified archive
into a separate new directory. After confirming the new executable launches
and your existing data remains available, switch your launcher/shortcut to
that directory. If it fails, point the shortcut back to the preserved old
package. Do not delete the old app or its user-data directory.

[Personal update delivery](docs/todo/completed/delivery/updates.mdc) records the
completed check/download and manual-installation scope. Automatic replacement
is an optional future improvement.
Background checking, unattended installs and rollback are not enabled.

Configuration controls packaged Mac login registration through Service
Management, including pending approval and explicit removal. Linux reports an
unsupported login control; native Mac/Safari assurance belongs to P4.

The [release/update decision](docs/technical/adr/product-update-lifecycle.md)
defines one version authority and required package projections. An unavailable
release source must report a failure rather than “no new version”.
Authenticated GitHub asset URLs and SHA-256 are the download boundary;
installed-package replacement is deliberately manual.
