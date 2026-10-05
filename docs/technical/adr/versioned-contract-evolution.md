# Versioned contract evolution

## Status

Accepted.

## Decision ID

`blooket-api.contracts.versioned-contract-evolution`

## Context

Command envelopes, result envelopes, projects, settings, capability snapshots,
and diagnostics cross process, persistence, or agent boundaries. Silent shape
changes would allow an older caller to reinterpret new data or an untrusted
payload to gain behavior through coercion.

Local-first persistence also outlives one executable version. A schema change
therefore needs an explicit compatibility decision instead of relying on
TypeScript assignability or permissive JSON parsing.

## Decision

Every durable or cross-transport root contract has an explicit integer version.
A decoder admits exactly the fields declared by the selected version and never
coerces primitive values. Unknown fields and unsupported versions fail closed.

Changing the meaning, required fields, accepted enum values, validation bounds,
or wire interpretation of a published version is forbidden. Such changes
require a new version and an explicit decoder or migration path. Migrations
produce the current in-memory shape and must be covered by fixtures for both the
legacy input and canonical current serialization.

Stable identifiers, command names, issue codes, and operation correlation are
semantic API surface. Renaming or reusing one for different behavior is a
breaking contract change even when the surrounding JSON shape is unchanged.

Additive fields are not silently compatible because exact decoders reject
unknown fields. A new optional field at a durable or transport boundary still
requires a new schema version unless the containing contract explicitly owns an
open extension map with separately defined validation rules.

Capability snapshots are evidence, not permission to guess. Unknown or
account-dependent facts remain explicit values until fresh evidence supports a
more specific state. Project validation may reject a capability-dependent write
without mutating the project document.

Blooket capability snapshot version two adds image canvas dimensions, maximum
pixels, and upload bytes. Version-one snapshots migrate those added facts to
null; only version-two evidence may make them concrete. Media import keeps local
source-resource ceilings separate from these Blooket-facing constraints.

## Consequences

- Old data fails predictably or migrates through a tested path.
- Agents cannot smuggle accidental fields into exact runtime contracts.
- A schema-version increment is required more often than in permissive JSON
  APIs, but each compatibility boundary stays auditable.
- Canonical serializers always emit only the current version.

## Rejected Alternatives

- Treating unknown JSON fields as harmless was rejected because model-generated
  payloads make accidental or adversarial field injection likely.
- Mutating a published schema version in place was rejected because persisted
  teacher data must remain reproducible across upgrades.
- Generic automatic migrations were rejected because semantic changes require
  domain-specific validation and evidence.

## Verification

Runtime decoder tests must cover unknown fields, unsupported versions, and
primitive coercion failures. Every admitted legacy version must have a migration
fixture proving the current decoded value and canonical reserialization.
`jig check --root .` remains the repository gate for those tests and declared
architecture boundaries.
