# Node 24 type compatibility

## Status

Accepted.

## Decision ID

`blooket-api.runtime.node-24-type-compatibility`

## Context

The repository runtime baseline is Node 24. The global latest release of
`@types/node` targets Node 26, which can describe APIs that are unavailable in
the runtime we actually support and test.

## Decision

Product TypeScript uses `@types/node` from the Node 24 release line. Jig records
the upstream latest release separately and carries an approved exact-scope skip
for the package projection while the runtime remains Node 24.

The exception expires on January 5, 2027. It must be reviewed earlier if the
supported Node runtime changes. On 2026-10-11, Jig refreshed the upstream
registry observation to `@types/node@26.6.5` while the approved runtime remains
Node 24; the exact-scoped skip tracks that verified stable release.

## Consequences

- TypeScript cannot silently compile against Node 26-only APIs.
- The repository records upstream drift instead of hiding it.
- A Node runtime upgrade must update this type authority deliberately.

## Rejected Alternatives

- Using the global latest `@types/node` was rejected because its API surface can
  exceed the supported runtime.
- Hiding the version from Jig was rejected because dependency drift must remain
  visible and reviewable.
- Handwritten Node declarations were rejected because the maintained community
  package is a stronger and more complete authority.

## Verification

`jig versions refresh --authority node-types --root .` must retain an upstream
release observation. Repository validation must accept the reviewed Node 24
skip only while its scope, version, evidence, and expiration remain exact.
