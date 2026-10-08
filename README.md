# blooket-api

A local-first TypeScript toolkit for a teacher who wants AI to help create
Blooket quizzes without spending the afternoon uploading and formatting media.

The intended workflow is simple: ask an AI for a quiz, review it in the browser,
and publish it to Blooket. A background service on the teacher's Mac owns the
files, credentials, media preparation, and execution. An optional Cloudflare
Tunnel connects online AI clients to its authenticated MCP gateway.

**This is a working development prototype. Automatic Blooket publication,
Safari integration, signed macOS delivery, and acceptance with the recipient's
ChatGPT account remain unfinished.** It is independent of Blooket and is neither
affiliated with nor
endorsed by the platform.

## What works today

- A localhost browser workspace with English and Spanish interfaces.
- A photo/GIF library with optimized canonical media and mirrored YAML
  metadata. Temporary intake bytes are discarded after canonicalization.
- An editor with zoom buttons and slider, dragging, saturation, contrast,
  blurred or solid backgrounds, color picking, undo/redo, and prepared exports.
- Explicit GIF export FPS, defaulting to 10, with bounded duration, frames,
  pixels, and output size. Prepared files must be below 2,500,000 bytes.
  Native media jobs run in isolated workers with a 20-second deadline.
- Local configuration for email, masked credential replacement, port, media
  folder, online connection, and export defaults.
- Personal skills and recoverable quiz drafts with revision checks. Startup
  installs initial authoring skills without replacing personal changes.
- A Streamable HTTP MCP gateway with OAuth/PKCE and approval in the local UI.
  Approval requires the owner password; connections can be rejected or revoked.
  Its tools execute the canonical CLI rather than a separate implementation.
- A lightweight first-use diagnostic, saved locally, with a manual rerun.
- Explicit local service stop and reversible packaged Mac login startup,
  showing the OS authorization state instead of inferring it from a preference.

Current MCP tools retrieve teacher instructions, search/read/enrich media, and
list/read/write skills and drafts. Media search returns bounded pages and a
continuation cursor. **Saving a draft does not publish a quiz.**

The Linux package has passed local startup, native media preparation, the
packaged CLI, repeated launch, and shutdown. The macOS product target is ARM64;
CI is configured to build its Safari WebExtension companion into `Blooket
API.app`. Native Mac acceptance and signing/notarization remain in ongoing
platform hardening; safe application replacement remains unfinished.

The Chrome extension can be assembled locally. It reads observed set summaries
and private set details in a dedicated Blooket tab. Bounded question reads and a
capability probe have portable implementations, but verified automatic quiz
publication is not ready.

Non-empty collection completeness, pagination, public set details, complete
question media, and live capability/login acceptance remain open. A
Chrome-for-Testing check confirmed the real signed-out login page only.

See [TODO.md](TODO.md) for the ordered plan and dated evidence. Portable tests
cannot establish Keychain or native macOS compatibility. Chrome is the initial
directly testable browser and extension target. The ARM64 macOS CI stage
builds and embeds the Safari companion; native acceptance remains pending.

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

The current workstation's pnpm launcher has a documented external failure;
npm scripts work with installed dependencies. Read the
[configuration record](docs/todo/open/settings/configuration.mdc) before
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

CAPTCHAs, organization selection, unfamiliar login challenges, and unknown
security states stop execution for human action. Normal interaction pacing is
planned; challenge bypass and anti-bot evasion are outside the design.

macOS is the teacher product target, with ARM64 packages planned.
Linux x64 delivery is required for developer testing of the shared service.
The bundled Node 24 runtime requires macOS 13.5 or later; confirm the OS before
installation. No VM or Metal requirement is part of the initial plan.

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

A release tag starts a strictly ordered pipeline:

1. reusable CI validates the exact tagged commit on Linux;
2. only after that passes, the ARM64 macOS job builds/verifies the Mac app,
   compiles the Safari WebExtension host, exercises Safari WebDriver, and
   embeds the Safari companion inside the Mac app and rezips the final archive;
3. only after the complete CI workflow passes, the release gate requires valid
   quarterly CalVer and repository variable RELEASE_ENABLED=true;
4. publish downloads those CI artifacts and creates the GitHub Release.

Release itself does not compile, run tests, build packages, or rerun package
verification. It publishes exactly darwin-arm64.zip; the Safari containing app
and extension live inside Blooket API.app in that archive. Linux x64 remains
useful for portable development/validation and is never a release asset.

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

The product package target is `darwin-arm64`; `linux-x64` remains the portable
development/validation package target. Outputs live under
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

To assemble the unpacked Chrome development extension:

```sh
npm run package -- --extension
```

In Chrome 110 or newer, open the Extensions page, enable Developer mode, and
choose **Load unpacked** with `.temp/distributions/browser-extension/`.
Native packages include the same directory under `extensions/chrome/` in their
resources. This is a manual development installation, not a store installer.

The extension requests scripting/storage and access only to the Blooket
dashboard, Blooket identity login, and the two admitted IPv4 loopback addresses.
No cookie permission or general web access is requested.

Open Blooket API normally. Its local workspace announces the connection
inside the extension's isolated page context; the extension discovers already
open workspace tabs when it starts. It connects automatically and opens its own
Blooket tab without changing the teacher's existing tabs.

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
npm run blooket -- sets list --json
npm run blooket -- sets get '<remote-set-id>' --json
```

Use the same user-data root as the running service. Development commands need
`BLOOKET_DATA_HOME="$PWD/.temp/service-test"` when the service uses that root.
These commands reuse the confirmed browser session and never load `.env`, read
credentials, or submit a login. A closed session requires signing in locally;
security challenges and organization prompts preserve the human-action stop.

Listing returns observed summaries, not a non-empty collection completeness
guarantee. The explicit empty-account state is bounded; pagination and remote
completeness acceptance remain pending.

Text-only new-quiz publication also has canonical `publication step`, `status`,
`reconcile`, and `verify` CLI commands and matching `blooket_publication_*` MCP
tools. Supply the saved draft ID and exact revision for each step; each call
performs at most one journaled write. Final fresh verification alone reports
`published: true`; local progress does not prove remote state.

This path has portable integration coverage across actual MCP, CLI, and local
service boundaries with a simulated provider. Live canonical publication,
media upload, and existing-quiz editing remain pending. MCP runs the bundled
runtime in the background without opening Terminal.

Private details and bounded text-question reads have portable adapters, as does
the account capability probe. Public details, complete media identity, live
capability acceptance, and publication remain open. Unsupported page shapes
fail validation rather than inventing facts.

Keep the local workspace open for automatic discovery and restart recovery.
The normal launcher opens it. If the service runs without a browser page, the
popup's **Open workspace** shortcut uses the default local port 2607.

The portable tests exercise the compiled worker and synthetic browser APIs.
The ARM64 CI stage separately converts/compiles the Safari host and exercises
the packaged workspace through Safari WebDriver. Remaining Apple trust and
platform-specific hardening belongs to the final platform record.

Extract the Linux archive and run `./blooket-api` to open the workspace.
`--no-open` starts without opening a browser, `--status` reports the service,
and `--stop` stops that instance. Reopening reuses the running service.
Replacing the extracted package retains user data; deleting the package does
not remove settings, media, or host-store secrets.

macOS platform-only installation/trust hardening remains in the final platform
record rather than blocking completed packaging work.
pending; do not present an unsigned archive as a ready-to-install release.

## Develop and verify

```sh
npm run check
npm test
node --check src/ui/teacher-workspace/adapter-inbound/app.js
jig validate --root .
```

Jig's `scalability.repository-graph` rule currently records an evidenced
`not-evaluated` outcome while Jig's own schema/migration contract matures.
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
GitHub from “no new version”. Linux remains a developer package and has no
automatic update installer.

[Automatic updates](docs/todo/open/delivery/updates.mdc) are planned, not
implemented. They will use final public GitHub Releases without a teacher GitHub
account, with independent opt-in update and launch-at-login preferences, trusted
artifacts, safe restart, and retained data. Both preferences default off.

Configuration controls packaged Mac login registration through Service
Management, including pending approval and explicit removal. Linux reports an
unsupported login control; native Mac/Safari assurance belongs to P4.

The [release/update decision](docs/technical/adr/product-update-lifecycle.md)
defines one version authority and required package projections. An unavailable
release source must report a failure rather than “no new version”; trusted
update metadata and publisher verification are prerequisites, not current
pipeline claims.
