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

Current MCP tools retrieve teacher instructions, search/read/enrich media, and
list/read/write skills and drafts. Media search returns bounded pages and a
continuation cursor. **Saving a draft does not publish a quiz.**
The Linux package has passed local startup, native media preparation, the
packaged CLI, repeated launch, and shutdown. The macOS bundle assembler exists;
native Mac verification, Safari packaging, signing, and launch-at-login
remain roadmap work.

The Chrome extension can be assembled locally. It reads observed set summaries
and private set details in a dedicated Blooket tab; it cannot publish quizzes.
Question/capability reads, empty accounts, pagination, public set details, and
native browser acceptance remain pending. Unsupported pages stop the read.

See [TODO.md](TODO.md) for the ordered plan and dated evidence. Portable tests
cannot establish Keychain or native macOS compatibility. Chrome is the initial
directly testable browser and extension target. Safari is packaged on a
GitHub Actions macOS runner once its integration is implemented.

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

The current workstation's pnpm launcher has a documented external failure;
npm scripts work with installed dependencies. See task 02 in [TODO.md](TODO.md)
before changing dependency layout or validators.

## Use the local workspace

1. Open configuration, choose the UI language and media folder, and save any
   replacement credentials. Saved secrets are never returned to the page.
2. Import a photo or GIF and choose its filename, name, original description,
   language, and topics. The AI uses asset IDs, not filesystem names.
3. Edit framing, adjustments, and background. Export defaults initialize new
   recipes; each image keeps its own settings.
4. Prepare and review/download the rendition. Oversized output or a stale
   recipe cannot be offered as a valid prepared download.
5. Use skills and draft tools to prepare material. The current draft view is
   read-only; publication is still being connected to safe execution.

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

Normal macOS data lives in `~/Library/Application Support/blooket-api/`:

```text
settings.json       Ordinary preferences; no passwords or tunnel tokens
diagnostics.json    First-use check results
logs/               Sanitized local diagnostic records
skills/             Personal authoring guidance
drafts/             Recoverable local quiz documents
media/              Default media root; selectable in local configuration
  photos/           Immutable sources with user-chosen filenames
  metadata/         Mirrored YAML metadata
  renditions/       Derived export files
```

For example, `photos/animals/My cat.gif` has metadata at
`metadata/animals/My cat.gif.yaml`. Original names/descriptions remain intact;
English enrichment records its source revision and verification status. Local
filename/folder changes preserve IDs and bytes and use a recovery journal.

When a previous `media.jsonl` exists in the selected library folder, use
**Import the previous library**. Migration preserves original files, archives
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

macOS is the teacher product target, with ARM64 and Intel packages planned.
Linux x64 delivery is required for developer testing of the shared service.
The bundled Node 24 runtime requires macOS 13.5 or later; confirm the OS before
installation. No VM or Metal requirement is part of the initial plan.

## Packages and releases

Remote CI is deliberately opt-in so ordinary pushes and pull requests do not
consume hosted-runner time. Local TypeScript and tests are the default
development gate.

Push a tag matching `ci-*` only when remote native validation is useful. That
single CI workflow runs three native targets in parallel: macOS ARM64, macOS
Intel, and Linux x64. Each target installs dependencies, runs strict TypeScript
and the full test suite, assembles its native archive, executes the extracted
package smoke test, and uploads that verified archive as a workflow artifact.
A CI tag never creates a GitHub Release.

CalVer release tags use three-month quarters: `vYYYY.Q.PATCH`, with `Q` from 1
through 4. For example, `v2026.4.0` is the first release in
October–December 2026. A release tag starts a strictly ordered pipeline:

1. the tag must pass quarterly CalVer validation and the repository variable
   `RELEASE_ENABLED` must equal `true`;
2. the same reusable CI workflow must pass for that exact tagged commit;
3. release-mode macOS verification additionally requires the Safari extension,
   valid code signing, and Gatekeeper assessment;
4. only then may the release job download the CI artifacts and publish them.

Release itself does not compile, run tests, build packages, or rerun package
verification. It publishes the macOS ARM64 and Intel ZIP files already produced
by CI. Linux x64 is always built and tested; include its tarball only when
`RELEASE_INCLUDE_LINUX=true`.

There is no automated changelog and no repository release-notes file is
required. The workflow creates the release with empty notes; write the human
release notes manually in the GitHub Release UI afterward. It never calls
GitHub's generated-notes feature.

Normal branch pushes do not run GitHub Actions. Use local validation while
developing and reserve a `ci-*` tag for deliberate native-runner validation.
A `vYYYY.Q.PATCH` release tag invokes CI itself, so do not add a second CI tag
for the same release commit.

Jig is a local repository validator and is not part of GitHub Actions. Apple
signing and Safari build setup remain tracked in task 14.

To build and verify a local package on the matching host:

```sh
npm run package -- linux-x64
npm run package:verify -- linux-x64
```

The other targets are `darwin-arm64` and `darwin-x64`. Outputs live under
`.temp/distributions/`; assembly refuses to overwrite an existing target
directory.

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
dashboard and the two admitted IPv4 loopback addresses. No cookie permission
or general web access is requested.

Open Blooket Studio normally. Its local workspace announces the connection
inside the extension's isolated page context; the extension discovers already
open workspace tabs when it starts. It connects automatically and opens its own
Blooket tab without changing the teacher's existing tabs.

There is no connection form, pairing code, or Blooket credential entry in the
extension. Its popup shows readiness and shortcuts to the workspace and Blooket.
The connection follows the workspace's actual port and reconnects after a
service restart; tokens stay in memory/session storage and never reach an AI.
IPv6-only local service bindings are not supported by this extension yet.

Keep the local workspace open for automatic discovery and restart recovery.
The normal launcher opens it. If the service runs without a browser page, the
popup's **Open workspace** shortcut uses the default local port 2607.

The portable tests exercise the compiled worker and synthetic browser APIs.
They do not establish an installed Chrome extension, Safari worker lifecycle,
or live publication. Safari conversion/signing remains task 14 and still blocks
release-mode verification.

Extract the Linux archive and run `./blooket-studio` to open the workspace.
`--no-open` starts without opening a browser, `--status` reports the service,
and `--stop` stops that instance. Reopening reuses the running service.
Replacing the extracted package retains user data; deleting the package does
not remove settings, media, or host-store secrets.

macOS installation acceptance remains
pending; do not present an unsigned archive as a ready-to-install release.

## Develop and verify

```sh
npm run check
npm test
node --check src/ui/teacher-workspace/adapter-inbound/app.js
jig validate --root .
```

Source, documentation, diagnostics, and commits use English. Product UI
language, quiz language, and original-media language are independent.

Read [AGENTS.md](AGENTS.md) for instruction routing, the
[developer profile](docs/agents/developer/AGENTS.md) for repository rules,
and the
[user profile](docs/agents/user/AGENTS.md) for admitted teacher workflows.
Continue [TODO.md](TODO.md) in order and record actual verification instead of
marking externally blocked tasks complete.

Architecture decisions cover [browser hosting and online MCP][browser-mcp],
[settings and the media library][library], and
[atomic persistence][persistence].

## License

[MIT](LICENSE-MIT). See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for
third-party trademarks, assets, and dependency notices.

[browser-mcp]: docs/technical/adr/macos-browser-ui-and-online-mcp.md
[library]: docs/technical/adr/teacher-settings-and-media-library.md
[persistence]: docs/technical/adr/atomic-local-persistence.md
