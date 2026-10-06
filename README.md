# blooket-api

A local-first TypeScript toolkit for a teacher who wants AI to help create
Blooket quizzes without spending the afternoon uploading and formatting media.

The intended workflow is simple: ask an AI for a quiz, review it in the browser,
and publish it to Blooket. A background service on the teacher's Mac owns the
files, credentials, media preparation, and execution. An optional Cloudflare
Tunnel connects online AI clients to its authenticated MCP gateway.

**This is a working development prototype. Automatic Blooket publication,
macOS packaging, and acceptance with the recipient's ChatGPT account remain
unfinished.** It is independent of Blooket and is neither affiliated with nor
endorsed by the platform.

## What works today

- A localhost browser workspace with English and Spanish interfaces.
- A photo/GIF library with immutable, user-named originals and mirrored YAML
  metadata. AI-generated English text is separate from original descriptions.
- An editor with zoom buttons and slider, dragging, saturation, contrast,
  blurred or solid backgrounds, color picking, undo/redo, and prepared exports.
- Explicit GIF export FPS, defaulting to 10, with bounded duration, frames,
  pixels, and output size. Prepared files must be below 2,500,000 bytes.
- Local configuration for email, masked credential replacement, port, media
  folder, online connection, and export defaults.
- Personal skills and recoverable quiz drafts with revision checks.
- A Streamable HTTP MCP gateway with OAuth/PKCE and approval in the local UI.
  Its tools execute the canonical CLI rather than a separate implementation.
- A lightweight first-use diagnostic, saved locally, with a manual rerun.

Current MCP tools retrieve teacher instructions, search/read/enrich media, and
list/read/write skills and drafts. **Saving a draft does not publish a quiz.**
A browser extension, native installer, launch-at-login integration, and
additional owner-password approval are roadmap work.

See [TODO.md](TODO.md) for the ordered plan and dated evidence. Portable tests
cannot establish Safari, Keychain, or native macOS compatibility.

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
```

The public URL must include `https://` and end in `/mcp`. Bare hostnames,
embedded credentials, other paths, query parameters, and fragments are rejected.

For local port 2607, configure Cloudflare's origin as
`http://127.0.0.1:2608` and leave the hostname **Path filter empty**. OAuth and
discovery need `/oauth/` and `/.well-known/` routes in addition to `/mcp`.

Configure the AI client manually with the public MCP URL. Complete its OAuth
flow and approve the matching connection in the local workspace. The tunnel
token authorizes Cloudflare connectivity; it is not an MCP access token.

Only MCP and authorization routes are public. The browser UI, settings, general
API, and arbitrary files remain private. Unauthenticated `/mcp` returns 401;
private UI/API routes return 404 at the public gateway.

The configured tunnel passed a synthetic OAuth/PKCE and MCP tool-call test.
Actual ChatGPT authorization, attachment delivery, restart behavior, revocation
controls, and additional owner-password enforcement still require completion.
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
English enrichment records its source revision and verification status. Legacy
library migration and user rename/move recovery remain pending.

Production passwords and tunnel tokens belong in macOS Keychain. The host
adapter sends secret payloads through stdin, verifies writes, and returns only
configured/missing status. `.env` is ignored development configuration, not
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

macOS is the sole product target. ARM64 is provisional until the recipient's
chip and OS are confirmed. Linux runs portable development tests, but is not a
binary release target. No VM or Metal requirement is part of the initial plan.

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
