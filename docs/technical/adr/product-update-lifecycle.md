# Product release versions and update lifecycle

## Status

Accepted policy with portable catalog checking and signed-archive staging.
Automatic installation remains pending. Explicit packaged login controls are
implemented; native macOS/Safari assurance remains in ongoing task blooket-15.

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
Mac bundle identity, minimum OS, and the single ARM64 application archive
name/URL/size/hash. The Safari companion is embedded in `Blooket API.app` inside
that archive; it is neither a release asset nor a separate update target.
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

The separate Apple assessment adapter admits the signed context and a local
publisher Team ID, then checks bundle metadata, OS compatibility, the ARM64
runtime, strict code signing, and notarized Gatekeeper acceptance. It runs
read-only native tools with bounded output, cancellation, and a shared deadline.
It neither extracts nor installs a bundle; portable command doubles do not
establish native acceptance or a production publisher trust root.

`src/platforms/update-extraction/` copies and authenticates a private immutable
archive, validates its bounded physical ZIP layout, and invokes only silent
native extraction. The extracted tree must match byte hashes, executable bits,
paths, and admitted internal links before syncing/freezing it for Apple
assessment. Cancellation retains ownership until the native writer stops;
staged results still require Apple trust and transactional installation.

`src/platforms/bundle-exchange/` provides one native atomic directory exchange,
retaining both application versions and returning their observed orientation.
Held parent descriptors and exact expected identities guard the syscall;
no delete/rename fallback is admitted. Application composition must hold the
installation lock, quiesce writers, journal the operation, and manage health
and recovery independently; the primitive cannot establish installation success.

The exact local installation journal preserves signed metadata and both
directory identities through intent, observation, health, and rollback phases.
Private bounded durable storage rejects conflicting or unsafe records and
retains exclusive ownership until admitted I/O has finished. Recovery assessment
requires independent native-writer completion and fresh filesystem/health
observations; persisted healthy state cannot prove current application health.

The installation application controller consumes prepared authority captured
independently of the journal and coordinates intent, reassessment, quiescence,
one forward exchange, fresh health, and guarded inverse recovery. It accepts
only exact completion evidence and freshly durable directory orientations.
Cancellation and lost acknowledgement cannot release ownership or authorize
blind replay; a stopped transaction retains both bundles and its journal.

This controller is an internal application operation with no permissive ports
or UI/MCP entrypoint. Production composition must run independently of the app
being replaced, retain every writer fence, supervise all descendants, reassess
publisher trust, and authenticate actual version/nonce health. Portable tests
exercise actual journals and native Linux exchange with explicitly synthetic
Apple/lifecycle ports; they do not enable installation or prove product restart.

Both launch-at-login and automatic updates default off and remain independent
local preferences. Record `blooket-13` owns native lifecycle registration;
`blooket-17` owns update integration, trusted metadata, staging, recovery, and
production-path acceptance. It depends on configuration, remote write recovery,
lifecycle, and trusted packaging; it exposes no remote installation authority.

The packaged native main executable invokes Service Management only for exact
local login-control arguments. Ordinary app launch and MCP execution never open
Terminal or register persistence implicitly. The local page displays actual OS
authorization, including pending approval, and keeps removal independently
available; ordinary settings saves cannot bypass this control.

The updater stages at a safe boundary, preserves the private user-data root,
never replaces a running application blindly, and never replays an ambiguous
Blooket write after restart. Missing manifests/authenticity and unimplemented
safe installation/recovery block functional completion. Native Mac/Safari
acceptance belongs to task blooket-15; lack of those hosts does not block P2/P3.

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
updater matrix and trusted release acceptance are pending in
[the update record](../../todo/open/delivery/updates.mdc). Native Mac/Safari
acceptance stays in the final ongoing record. Portable tests do
not establish Safari, Keychain, signing, notarization, or recipient acceptance.

[chrome]:
  https://developer.chrome.com/docs/extensions/reference/manifest/version
<!-- jig-ignore-next-line: Canonical Apple documentation URL is indivisible. -->
[apple]:   https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html
[releases]: https://github.com/albertovillaosorno/blooket-api/releases
[api]: https://docs.github.com/en/rest/releases/releases

### Fresh owned runtime health

The updater's runtime proof uses the existing private parent-child IPC channel,
with an exact UUID challenge and a bounded response. The response must match
its owned child PID, startup instance and expected product version; stale
runtime files, successful spawn or sent messages alone are insufficient.

The service responds only after a fresh bounded read of its exact local runtime
status and readiness checks before and after that read. Shutdown relinquishes
readiness immediately, including while persistent writers are draining.
No public health-challenge endpoint or remote installation tool is added.

The local installer must retain its actual spawned ChildProcess capability;
`probeOwnedServiceHealth` cannot recover that authority from an arbitrary PID.
Cancellation or a probe deadline removes listeners without killing the app or
releasing any installation fences. The independent supervisor still owns
quiescence, descendant drainage, restart and recovery.

On 2026-10-10, a real background-service subprocess passed the private IPC
version/nonce challenge and preserved its data marker. Synthetic hostile IPC
receipts, different versions/PIDs, cancellation and deadlines were refused.
This is portable service health evidence, not a completed installation or
native Mac acceptance. Node's current [child-process documentation][node-ipc]
was consulted on the same date for IPC lifecycle and message delivery semantics.

[node-ipc]: https://github.com/nodejs/node/blob/main/doc/api/child_process.md

### Drained owned service shutdown

Private installer IPC also carries an exact stop challenge for the owned
runtime instance.

The actual service acknowledges only after managed shutdown
has drained admitted local writers and online canonical children. Its reply
contains the fresh nonce, instance, PID and product version. The parent requires
both that exact drained receipt and successful final child `close` before
reporting stopped; a sent signal, IPC disconnect or parent process exit is
insufficient.

A deadline or cancelled observation returns a retained pending completion.
It does not kill/disconnect the child, send a second shutdown, or release any
installation fence. The same child/challenge shares the observation; a different
challenge is refused while ownership is retained. Callers must await final
completion and require stopped proof before replacing either application tree.

No public IPC capability, CLI/MCP installer command or Terminal window is added.

On 2026-10-10, a real service subprocess stopped and restarted with its data
marker intact. A real managed service with an injected held secret-store writer
kept its service lock through the deadline, persisted the admitted settings
change, and acknowledged only after release. Synthetic child regressions cover
hostile receipts, cancellation, failed exit and inherited pipes that remain
open after parent exit. This establishes managed service closure, not exclusion
of independent CLI writers, an enabled installer, or native Mac acceptance.

The [Node child-process documentation][node-ipc] was checked on the same date.


### Canonical persistent command ownership

Canonical user-data commands register individual private leases before first-use
initialization or mutable work. They release only their own lease after awaited
command/native completion. A bounded short registration lock permits admitted
commands to complete independently. Profile retrieval does not access user data.

Update admission retains a separate installation marker after proving that no
command leases remain. The marker excludes new commands across service shutdown
and survives supervisor death; neither a dead PID nor a disappeared service
proves native descendant completion. Orphaned leases and foreign storage remain
recovery stops. No lease is cleared by catalog observation.

Compose publication exclusion before command admission, then independently
fence/drain direct UI, settings and startup writers. The command boundary alone
cannot authorize bundle exchange. Ownership must survive until every native
writer settles, with trusted artifacts and controlled recovery of interrupted
installation markers; enabled installation remains pending.

Real CLI and separate-process regressions on 2026-10-10 prove save refusal,
preserved data, concurrent command registration and retained ownership after
writer/installer death. The [Node filesystem documentation][node-filesystem]
was checked on that date for directory iteration/closure semantics.

[node-filesystem]: https://github.com/nodejs/node/blob/main/doc/api/fs.md
