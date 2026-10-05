# Canonical dependency direction

## Status

Accepted.

## Decision ID

`blooket-api.architecture.canonical-dependency-direction`

## Context

The product exposes one set of lesson and media behaviors through several
surfaces. CLI, localhost HTTP, MCP, desktop UI, and browser integration must not
become independent semantic implementations because fixes would drift and
teacher-visible results could differ by transport.

Platform code also needs a strict role. macOS and Linux adapters translate
existing capabilities into host facilities; they do not own project, media,
settings, security, or Blooket business rules.

## Decision

The repository dependency graph is declared in
`.jig/settings/architecture.toml` and enforced by Jig. `ir` is dependency-free;
`media`, `projects`, `security`, and `settings` own domain behavior; `api`
composes those capabilities into application operations; and `cli` adapts user
arguments into the same API executor.

MCP depends only on CLI and executes the installed `blooket` command in machine
mode. It must not import API or domain internals. Localhost HTTP belongs to the
API component and lowers requests into the same command executor rather than
implementing separate semantics.

Platform adapters may depend on existing owning-domain contracts, including
project, security, or settings contracts, but may not reverse the dependency
direction. Desktop and extension surfaces may depend on their admitted UI/API
layers and must not acquire Blooket semantics.

## Consequences

- One semantic executor can be tested directly and through every transport.
- MCP preserves the visible CLI process boundary requested by the product.
- Operating-system implementations stay replaceable and narrow.
- A new cross-component import can fail repository validation before release.

## Rejected Alternatives

- A generic `core` package was rejected because it obscures capability
  ownership and invites unrelated logic into one dependency sink.
- Letting MCP import the API directly was rejected because it would create a
  second automation path instead of exercising the canonical CLI.
- Duplicating product behavior in platform adapters was rejected because macOS
  and Linux would inevitably diverge.

## Verification

`jig check --root .` validates source imports against the declared architecture
component graph. Transport parity tests additionally compare direct executor
results with CLI JSON mode; future HTTP and MCP adapters must join the same
fixture family before their roadmap items are complete.
