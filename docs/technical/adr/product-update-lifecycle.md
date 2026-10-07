# Product release versions and update lifecycle

## Status

Accepted policy with portable catalog checking and signed-archive staging.
Automatic installation and native launch-at-login acceptance remain pending.

## Decision ID

`blooket-api.delivery.product-update-lifecycle`

## Context

The product needs one version authority across release gates, runtime identity,
Mac bundles, and browser extensions. Public GitHub Releases may be empty or
unavailable, and replacing an application must preserve teacher data and avoid
interrupting ambiguous remote quiz writes.

## Decision

`src/ir/product-version/contract/version.ts` owns `PRODUCT_VERSION` and the
exact `YY.Q.PATCH` parser. YY means 2000–2099, Q is the UTC three-month quarter,
and PATCH is an integer from zero through 99999 without leading zeros. Q1 is
January–March, Q2 April–June, Q3 July–September, and Q4 October–December.

Git tags use exactly `vYY.Q.PATCH`, for example `v26.4.0`; product identity is
`26.4.0`. Four-digit years and bare product versions are not release tags. The
release gate requires the tag to match the committed product version; prepare
version changes and checked metadata projections before tagging.

The existing gate validates syntax and source identity, not the wall-clock date
of a manual tag. UTC date generation produces the initial quarter revision;
comparison orders year, quarter, and revision numerically. Do not wrap the
century silently or reset revisions within a quarter.

Root package metadata and the source extension manifest are checked projections.
Packaging generates runtime package/distribution metadata, Mac display/build
versions, and extension metadata from the authority. `distribution.json.version`
remains a schema version, independent of `productVersion`.

Chrome's four numeric components are `YY.Q.floor(PATCH/65536).PATCH%65536`, with
numeric YY and canonical `version_name`. Apple's build counter is
`((YY*4+Q)*10+floor(PATCH/10000)).floor(PATCH/100)%100.PATCH%100`;
`CFBundleShortVersionString` retains the product version. These monotonic
projections preserve the old patch bound without creating a second release
policy; see [Chrome's version contract][chrome] and [Apple's build
contract][apple].

The update authority is this repository's public [GitHub Releases][releases],
using the [public release API][api] without teacher GitHub credentials. Final
public releases only are admitted, with bounded requests, explicit offline and
error states, architecture-specific assets, verified publisher authenticity, and
preserved Apple signing/Gatekeeper/notarization requirements.

Schema-one update manifests own the exact repository/version/tag/source commit,
Mac bundle identity, minimum OS, and both Mac archive names/URLs/sizes/hashes.
The portable signature format is Ed25519 with canonical manifest JSON, prefixed
by `blooket-api:update-manifest:v1` and a newline. An envelope names an admitted
key by its SPKI DER SHA-256 fingerprint; it cannot introduce a trust root.

`src/ir/update-manifests/` owns decoding/canonicalization and
`src/platforms/update-signatures/` owns cryptographic verification. Production
publisher-key provisioning/rotation and CI manifest publication remain pending.
Verified metadata must match the selected release; actual archive bytes must
match its signed size/hash. Apple trust and transactional installation remain
independent mandatory checks.

`src/platforms/update-downloads/` streams publisher-authenticated archives into
private owned staging directories, with bounded anonymous HTTPS, exact signed
size/hash, restricted redirects, cancellation, and partial cleanup. The product
UI and MCP do not expose this adapter; real publisher-key provisioning, signed
release metadata, Apple validation, and transactional installation are pending.

Both launch-at-login and automatic updates default off and remain independent
local preferences. Record `blooket-13` owns native lifecycle registration;
`blooket-17` owns update integration, trusted metadata, staging, recovery, and
production-path acceptance. It depends on configuration, remote write recovery,
lifecycle, and trusted packaging; it exposes no remote installation authority.

The updater stages at a safe boundary, preserves the private user-data root,
never replaces a running application blindly, and never replays an ambiguous
Blooket write after restart. Missing manifests/authenticity or native acceptance
block completion rather than being relaxed for convenience.

## Consequences

The release gate still requires opt-in publication and successful CI for the
exact tagged source. No updater, launch persistence, signing, or published
release is created by this planning change.

Application update status distinguishes “no new version” from an unavailable or
untrusted source. Startup remains usable offline; implementation and detailed
acceptance belong in the owning typed record.

## Rejected Alternatives

Four-digit product years, HTML scraping, mandatory GitHub credentials, checksum
agreement as publisher authenticity, hidden startup persistence, and remote MCP
installation primitives were rejected. Killing active work or overwriting user
data to simplify updates was also rejected.

## Verification

Version tests cover canonical syntax, numeric ordering, UTC quarter boundaries,
tag/source matching, and bounded package projections. Roadmap integrity checks
verify record identity, dependencies, links, and completion status/path.

Portable catalog and local manual-check tests are implemented. The remaining
updater matrix and real Mac/release acceptance are pending in
[the update record](../../todo/open/delivery/updates.mdc). Portable tests do
not establish Safari, Keychain, signing, notarization, or recipient acceptance.

[chrome]:
  https://developer.chrome.com/docs/extensions/reference/manifest/version
<!-- jig-ignore-next-line: Canonical Apple documentation URL is indivisible. -->
[apple]:   https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html
[releases]: https://github.com/albertovillaosorno/blooket-api/releases
[api]: https://docs.github.com/en/rest/releases/releases
