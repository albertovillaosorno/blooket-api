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

Release metadata production now has a bounded local implementation. It hashes
the actual final ARM64 archive, validates its physical ZIP layout, and matches
the adjacent distribution metadata bytes to the identical embedded ZIP entry.
The exact schema-one package identity must be clean and match the requested
version/source commit; its admitted minimum OS becomes signed metadata.

The signing adapter consumes only a local in-memory Ed25519 private key whose
public fingerprint belongs to the explicitly admitted publisher roots. It
neither generates roots nor exports/persists key material. The producer
exclusively creates `update-manifest.json`, retaining existing output on
conflict.

Malformed archives, metadata mismatches, dirty/foreign builds, absent trust,
cancellation and a bounded deadline refuse creation. Real-file portable
fixtures verify the produced signature and archive bytes through the actual
receiver; their ephemeral keys do not establish a production publisher.

This operation still needs production key provisioning and post-signing CI
composition. It does not run Apple signing/notarization, publish a release,
or enable application installation. Node's [Ed25519 signing contract][node-sign]
was checked on 2026-10-14; the existing canonical signing context is preserved.

The repository command is `npm run release:manifest -- <output-name>`; omitting
the name selects the normal distribution directory. The trusted local/CI
environment must supply `BLOOKET_UPDATE_SIGNING_KEY` and
`BLOOKET_UPDATE_PUBLISHER_KEYS`, a bounded JSON array of canonical public PEMs.
These roots must be independently provisioned for the receiving application.

The command loads no `.env` file, accepts no key/path argument and observes
only clean committed Git source before producing public metadata. Git children
receive no publisher key environment, and errors expose only stable codes.
This is a producer entrypoint, not release authorization or an installer tool.

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

Direct local HTTP data handlers now retain the shared user-data writer lease
through actual completion, including lazy library/media reads. Held installation
admission refuses their persistent operations with a busy response; pure runtime
and update-status observations remain available. Canonical commands keep their
existing publication-before-data ownership order instead of gaining an outer
data lease.

This closes the direct request-writer gap, not independent installer
composition. The product installer must preserve those
fences through replacement, restart, and recovery before it is enabled.

Ordinary managed startup now acquires a canonical data lease before loading
preferences or initializing the service. It retains that lease through online
operation, discovery persistence, and actual shutdown drainage. A held
installation marker refuses startup without creating teacher settings or
runtime discovery. Development configuration uses the same admission before
reading its local overrides or saving preferences.

Failed shutdown retains the lease rather than inferring that a native
descendant has stopped.

Installation composition must hold publication exclusion, drain the owned old
service, and then acquire exclusive data admission. The lifetime lease prevents
acquiring installation admission around a still-running ordinary service.
Candidate/rollback startup while exclusive admission is held requires a
private installer-issued authority; removing the fence to start a candidate
would reopen the race. These lifecycle guarantees do not enable installation
or grant such authority to CLI, HTTP, MCP, environment values, or stale PIDs.

The data boundary can issue a confidential startup request only from its live
local capability for an actual connected child. The child accepts that request
only through its existing parent IPC and authenticates the exact private
installation owner before registering its own lifetime lease. A readiness
notice prevents a listener race and grants neither health nor installation
authority. A released boundary cannot issue requests, and forged ownership,
wrong process identities, absent IPC and malformed messages refuse startup.

Real silent service tests retain the update marker while starting a candidate,
prove fresh private health, and refuse ordinary HTTP data access until the
parent releases installation admission. The running candidate's lifecycle
lease then excludes another installation until actual drained shutdown.
Independent supervisor/recovery composition and production publisher trust
remain required; this private startup capability is not a shipping updater.

The ordinary installed launcher now starts a silent independent service
supervisor, which keeps the actual service child and private IPC after the
launcher disconnects. It admits readiness only after an owned fresh health
challenge and retains uncertain startup on a launcher deadline. UI shutdown
notifies this supervisor after managed drainage; the notice triggers a fresh
private stop challenge and still requires final service child closure.

The supervisor forwards its own stop signals through that same private
challenge, with no signal/kill fallback against the service's writers. Real
launcher and subprocess tests demonstrate continued service availability after
launcher disconnect, duplicate-launch reuse, completed UI shutdown and preserved
data. The disconnected launcher observes supervisor exit only, never using that
observation as installation or service-writer completion evidence.

The service's owned IPC remains connected through its actual termination,
avoiding the parent-disconnect close-accounting issue reported in
[Node issue 65646][node-parent-disconnect] and reproduced locally on Node
24.18.0 on 2026-10-13. This establishes independent normal service supervision,
not immutable installer preparation, production publisher selection or a
completed replacement/recovery transaction.

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

<!-- jig-ignore-next-line: Exact upstream URL is indivisible. -->
[node-sign]: https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptosignalgorithm-data-key-callback

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

[node-parent-disconnect]: https://github.com/nodejs/node/issues/65646


### Explicit launcher shutdown observation (2026-10-13)

The local `--stop` launcher distinguishes an accepted HTTP 202 from
completed service closure. After the explicit request, it observes the
original PID disappear, its runtime and service-lock files vanish, and
all canonical writer leases drain. It also refuses a still-responsive
loopback listener, including a foreign-listener scenario.

An inconclusive observation exits with an actionable failure; it never
kills a service, removes a lease, or treats an HTTP acceptance as
installation clearance. Synthetic responsive-server tests and a real
temporary supervised service demonstrate refusal and completed normal
shutdown. Installer replacement still requires independent publication
and data locks, private IPC closure and trusted release evidence.

On Fedora, a disposable service retaining an unrelated canonical writer
correctly refused launcher stop confirmation until that writer's owner
released its lease. An isolated old-to-new Linux package change also
preserved byte-identical synthetic draft and publication files, reused
one new supervised instance, and confirmed a completed normal stop.
No live account data was involved in that migration test.
