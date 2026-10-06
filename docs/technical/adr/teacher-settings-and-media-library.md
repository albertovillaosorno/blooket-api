# Teacher settings and media library

## Status

Accepted target behavior; partially implemented as of 2026-10-06. Schema-3
preferences, mirrored YAML, library/skill/draft operations, the browser editor,
and explicit GIF resampling exist. Portable legacy migration and user rename
recovery are implemented; complete native integration and end-to-end publication
remain pending in `TODO.md`.

This decision supersedes the English-only media description policy,
authoritative JSONL media metadata, automatic internal naming of user-visible
source files, and source-timing preservation for prepared GIFs. Migrate existing
data explicitly rather than changing a published schema in place.

## Decision ID

`blooket-api.product.teacher-settings-and-media-library`

## Context

The teacher uses ChatGPT to prepare quizzes and a local browser interface to
configure the Mac service and manage photos or GIFs. She chooses filenames and
writes names/descriptions in any language. The AI searches and enriches metadata
without taking ownership of the original text or filesystem names.

The service needs durable local configuration, optional user-selected media
storage, personal skills, and repair information from its first real macOS run.
Online quiz requests drive the workflow; local JSON exists for safe recovery and
drafts, not as a manual file-management requirement.

## Decision

### User-data root and settings

Resolve the current user's macOS Application Support directory and append
`blooket-api/`. For the planned non-sandboxed service this is ordinarily
`~/Library/Application Support/blooket-api/`. Resolve the actual user directory
at runtime; never embed the developer's home path or a guessed recipient name.

```text
userDataRoot/
  settings.json
  skills/
  drafts/
  execution/
  logs/
  media/                 Default configurable mediaRoot
    photos/
    metadata/
    renditions/
```

The teacher may select another media root. Changing settings must not silently
move or delete her existing library. Validate access and offer an explicit,
recoverable library move separately when needed.

| Control        | Storage / behavior                            |
| -------------- | --------------------------------------------- |
| UI language    | Settings: en/es, independent of quiz language |
| Email          | Settings; local authentication only           |
| Password       | Keychain; settings contain a reference        |
| Local port     | Settings; loopback with collision diagnostics |
| Online MCP     | Settings toggle; disabled stops the tunnel    |
| Public MCP URL | Settings HTTPS URL including `/mcp`           |
| Tunnel token   | Keychain; Cloudflare Tunnel only              |
| Media location | Settings; default user-data `media/`          |
| GIF FPS        | Advanced settings; explicit, default 10       |

Show the public URL and tunnel credential controls only as enabled controls when
online MCP is enabled. Preserve their saved values while disabled. Save
validates ordinary settings and stores changed secrets through one local
application operation with explicit partial-failure handling.

Stored secrets are never returned to the browser, CLI, or MCP. Password/token
fields show configured state and accept replacement input locally. Settings JSON
may contain email and user paths, but never password or token values.

Use a new settings schema version and tested migration for the new fields.
Preserve valid theme, lifecycle, and port preferences. No remote tool manages
credentials, tunnel access, or arbitrary filesystem roots.

### User filenames and mirrored YAML

Keep user-named immutable source bytes in `mediaRoot/photos/`. Editing changes
the render recipe and prepared rendition, not the source file. Only an explicit
user naming/move operation changes the visible filename or relative directory.

Mirror relative directories under `mediaRoot/metadata/` and append `.yaml` to
the complete source filename. For example:

```text
photos/animals/Mi gato.jpg
metadata/animals/Mi gato.jpg.yaml
photos/animals/Mi gato.gif
metadata/animals/Mi gato.gif.yaml
```

Assign a stable asset ID independent of all names and paths. MCP metadata and
quiz tools address that ID; the service resolves paths internally. User rename
operations preserve the ID and update metadata/references transactionally.

Admit user filenames through a trusted local operation with traversal checks,
Unicode handling, extension validation, and visible collision resolution. Do not
let AI-generated metadata create a path or silently rename a source asset.

The target YAML document contains:

```yaml
schemaVersion: 1
id: asset-001
asset: photos/animals/Mi gato.jpg
original:
  revision: 1
  name: Mi gato
  description: Un gato naranja mirando por la ventana.
  language: es
topics:
  - animals
  - pets
generatedEnglish:
  name: My cat
  description: An orange cat looking through a window.
  generatedBy: ai
  sourceRevision: 1
  verified: false
```

This is a target-schema illustration, not the current runtime format. `asset`,
`id`, and the original text are service/user-owned fields. The model can propose
topics and update admitted generated-English fields through a bounded metadata
operation; it cannot overwrite originals or alter the asset reference.

Changing original text increments its revision and marks old generated text
stale. Generating English text does not assert verification. Preserve the
original language without guessing it when unspecified.

YAML is the authoritative per-asset metadata; any JSONL search index is a
rebuildable cache of validated records. Use a reviewed YAML parser with safe,
bounded decoding and an exact versioned runtime contract. Migrate the existing
JSONL/display-name records while retaining stable IDs, bytes, and recovery
state.

The implemented migration uses schema 2 only for records with legacy provenance.
It adds `legacy.englishVerified`, `legacy.sourceRevision`, `legacy.sourcePath`,
and `legacy.indexDigest`; schema-1 documents keep their existing exact contract.
This historical verification is not an inferred language or AI translation.

An explicit local import preflights the bounded JSONL index and actual images,
preserves source files, and archives the exact index bytes. User rename/move
preserves IDs, bytes, text, recipes, and provenance while clearing prepared
status. Canonical legacy vault paths select the unique immutable source under
`originals/`; the working `media/` rendition never replaces a missing original.
Migration and its recovery acquire the legacy writer lock after the new library
lock, recovering any old pending transaction before preflight or replay.

A durable transfer journal is replayed under the library lock before
other locked operations; ordinary reads refuse a pending transaction.

Recovery checks source/destination hashes and metadata before removing old
rename paths. Changed files stop recovery with the journal intact; no automatic
merge or
unrelated overwrite is admitted. Migration and filenames remain local user
operations outside the remote command registry.

### Personal skills and online quiz authority

Keep personal skill text in `userDataRoot/skills/` beside settings and the
default library. Authorized MCP tools can list/read/update skill documents by
logical ID, with recoverable writes. They do not execute skill text or permit
arbitrary filenames, commands, credentials, or software installation.

The teacher's online request drives quiz generation and changes. Local JSON is
automatic recoverable draft/execution state; remote IDs and fresh read-back
establish what actually exists in Blooket. Detect stale remote state before
applying a new plan and retain ambiguous writes for reconciliation.

Support admitted question variants, per-question seconds, and media selection
through existing versioned IR and account capability checks. Verify how the
actual ChatGPT MCP connection transfers an image and reads personal skills;
neither an attachment nor a local directory is automatically available remotely.

### Shared image editor and explicit GIF rate

Provide a zoom slider with minus/plus buttons, optional equivalent mouse-wheel
input, and dragging for foreground pan. Expose saturation and contrast without
requiring hidden gestures. Static images and GIFs share the canvas and edit
state.

Background mode is either blurred fill or a solid color. A color input and
eyedropper choose the solid color. A canvas pixel picker remains available when
the browser does not implement the native eyedropper API.

Prepared GIFs use the Advanced setting's explicit FPS, default 10. At 10 FPS,
output frame delay is 100 ms. Resample variable-delay source frames against the
selected fixed-rate timeline; changing only delays would distort playback speed.

Preserve loop behavior and duration within one output frame interval. Rebuild
affected renditions when FPS changes, leaving source bytes intact. Bound
duration, frames, decoded/output pixels, native work, and encoded bytes.

Prepared static/GIF assets use the same verified Blooket target canvas and
aspect ratio. Unknown upstream dimensions stay unknown until verified. Optimize
within the upload ceiling, and fail with actionable diagnostics when the
requested animation cannot fit; 10 FPS alone is not a size guarantee.

## Consequences

- The teacher owns filenames and original text in any language.
- The AI can search English enrichment and topics without renaming files.
- Settings remain a readable JSON file while Keychain stores secret values.
- YAML mirrors the visible library and replaces authoritative JSONL metadata.
- Existing persistence/schema contracts need migration and meaningful tests.
- GIF timing becomes an explicit rendition choice rather than a source default.

## Rejected Alternatives

- Overwriting original descriptions with AI translations loses user-authored
  information and is excluded from the metadata update contract.
- Model-selected filenames couple search text to filesystem identity and are
  excluded from AI operations.
- Keeping YAML and JSONL independently writable would create two authorities;
  derived indexes must be rebuildable from YAML.
- Preserving arbitrary source GIF FPS would ignore the required explicit rate.
- Plaintext password/token fields in settings are replaced by Keychain refs.
- A second desktop editor, non-Cloudflare tunnel providers, and a VM setup are
  outside the agreed first-use workflow.

## Verification

Test settings migration, English/Spanish UI keys, local-only secret entry,
disabled online fields, library-root validation, and partial Save failures. Test
YAML migration, exact decoding, stale enrichment, user rename recovery,
same-stem/different-extension paths, and rejection of model path changes.

Test drag/slider parity, pixel picking on Safari, both background modes,
explicit FPS resampling, loop/duration bounds, and output-byte failures. Prove
authorized online skill/media operations and a small quiz
create/read-back/recovery flow through the actual configured ChatGPT connection.
