# AGENTS.md

## Purpose

This file is the compact operating contract for coding and lesson-authoring
agents working with this repository. Durable specifications, TODOs, schemas,
tests, and validated behavior outrank chat history.

Never copy credentials, cookies, browser tokens, personal absolute paths, or
private lesson content into repository documentation or source fixtures.

## Language

Use English for source code, identifiers, comments, documentation, schemas,
tests, diagnostics, TODOs, and commit messages.

Communicate with the human in the language they use. The communication language
and quiz language are independent. When creating or changing lesson content,
respect an explicitly supplied quiz language. Ask for the quiz language only
when it cannot be inferred safely from the task or project.

Media descriptions stored by this project are canonical English descriptions.
`english` defaults to `false` and must not become `true`
merely because an LLM claims it translated the text correctly.

## Read first

Before product changes:

1. Read `TODO.md` and the owning package README/specification when one exists.
2. Run `git status --short` and preserve unrelated work.
3. Inspect the package dependency direction before introducing a new import.
4. Use repository validation rather than assuming a previous agent's result is
   still current.

Do not commit, push, tag, publish, or create releases unless the human
explicitly asks for that action. Validation does not imply permission to commit.
When commits are authorized, every commit must use DCO signoff
(`git commit -s`).
Jig requires the `Signed-off-by` trailer and the hook must never be bypassed.

## Architecture rules

There is no generic application `core` package.

- `src/ir/` owns versioned commands, results, runtime contracts, and validation
  diagnostics.
- `src/api/` composes application operations and the localhost HTTP boundary.
- `src/cli/` is the canonical external automation interface over the same
  executor.
- `src/mcp/` executes the canonical CLI in machine-readable mode. Do not import
  application internals to make MCP "faster".
- `src/media/` owns vault metadata, search, transforms, and renditions.
- `src/projects/` owns lesson/project persistence and semantic project behavior.
- `src/security/` owns credential and secret-storage contracts.
- `src/settings/` owns ordinary user configuration and port-selection policy.
- `src/platforms/` translates existing capabilities for each operating
  system. It must never duplicate domain or application logic.
- `src/ui/general/` owns browser-safe UI behavior shared by desktop and
  extension.
- `src/ui/desktop/` and `src/ui/extension/` contain only their host-specific
  surfaces.

If two transports return different semantic results for the same IR operation,
fix the shared behavior or the adapter. Do not preserve the divergence.

Repository source uses Jig's canonical route:
`src/<domain>/<function>/<kind>/<part>`. There is exactly one top-level `src/`;
never create `src/<domain>/src/`.

The `<kind>` segment is the hexagonal role, such as `domain`, `application`,
`contract`, `port-inbound`, `port-outbound`, `adapter-inbound`,
`adapter-outbound`, or `composition`. The `<function>` segment names the
capability being implemented. Do not swap function and kind.

Tests mirror source paths under `tests/` and use `_tests.ts`. For example,
`src/ir/json-syntax/domain/json.ts` is tested by
`tests/ir/json-syntax/domain/json_tests.ts`. Do not create loose catch-all test
files such as `tests/json_validator_tests.ts` for code owned by a source path.

## JSON and LLM input

Treat every model-produced document as untrusted.

Use the JavaScript runtime's native `JSON.parse` for JSON syntax. Do not add a
third-party parser unless it has a reviewed, concrete requirement that native
JSON cannot satisfy.

TypeScript types are not runtime validation. Every externally supplied document
must pass the exact versioned runtime decoder in `src/ir/` before
application logic uses it. Reject unknown fields, wrong primitive types,
unsupported variants,
invalid media references, account-incompatible features, and contradictory
cross-field states. Do not silently coerce or "repair" a quiz.

Only validated documents may be lowered to a Blooket write plan. The Blooket
adapter must never receive raw LLM JSON.

## Media search

Use the project media search command instead of arbitrary shell pipelines
when an agent needs to choose an image. Prefer field-restricted searches,
especially
`--field description`, and machine-readable output.

`rg` is allowed for repository inspection and debugging because media indexes
are ordinary UTF-8 text. Runtime functionality must not depend on ripgrep being
installed.

## Credentials and browser state

Never print, return, log, serialize into projects, or expose credentials,
cookies, authorization headers, or secret-store payloads.

Use the security capability for credentials. Browser automation operates from
the teacher's local computer and confirmed session. A CAPTCHA, unfamiliar login
challenge, or ambiguous security state requires human interaction. Do not build
or suggest bypasses.

The Blooket organization-selection prompt is a known state. Do not select an
organization or submit that form automatically.

## Reliability

Prefer failure with recoverable state over partial success with corrupted state.
Important local data must use atomic persistence patterns and explicit schemas.
Do not edit durable JSON in place when interruption could destroy the only valid
copy.

Autostart and background behavior must be visible, opt-in, reversible, and
implemented through ordinary OS facilities. Do not create hidden persistence or
virus-like behavior.

The localhost service binds to loopback by default. Do not expose it to the
network merely to solve a local connectivity problem.

## Platform priority

macOS is the product-quality target and Safari is the primary extension target.
Linux is the development and portable test baseline. Linux-specific shortcuts
must not distort the macOS contract, and macOS implementations must not copy
shared logic into platform code.

Windows is deferred.

## Dependencies

Prefer Node/JavaScript/Web Platform and operating-system primitives. Add a
third-party dependency only when its capability, maintenance quality, and trust
case are materially better than a small repository-owned implementation.

Do not add dependencies for trivial parsing, validation, string matching,
filesystem wrappers, or convenience utilities that the platform already
provides adequately.

## Validation

At minimum, run the checks relevant to touched packages. Before claiming the
repository baseline is green, run:

```sh
pnpm run check
pnpm run test
jig validate --root .
```

Report a pre-existing or unrelated failure instead of weakening the gate.
