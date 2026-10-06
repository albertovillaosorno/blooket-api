# Host secret storage

## Status

Accepted.

Current product scope is macOS only, as recorded in the macOS browser UI and
online MCP decision. Linux backend details below describe existing development
infrastructure, not a Linux product or release requirement. New tunnel secrets
use the same owning security port; ordinary settings contain secret references.

## Decision ID

`blooket-api.security.host-secret-storage`

## Context

Production credentials must remain on the teacher's computer and must not enter
project files, ordinary settings, command arguments, diagnostics, browser
extension state, or agent-facing transports. The macOS product target and Linux
development baseline expose different native secret-store clients, but
authentication callers need one stable contract.

Command-line secret clients create two additional risks. Secret values placed in
process arguments may be visible through process inspection, and verbose command
errors may contain host details or sensitive values that should never become
application diagnostics.

## Decision

The security domain owns a HostSecretStore port plus strict host-secret names
and values. Names use a lowercase command-safe identifier grammar. Values are
non-empty UTF-8 strings limited to 2048 bytes; this keeps the macOS interactive
write command comfortably below the bounded command-input envelope while
remaining far above ordinary password-sized values.

The platform adapter selects the backend behind that port. macOS uses the system
/usr/bin/security client and generic-password items under the blooket-api
service. Linux uses /usr/bin/secret-tool and Secret Service attributes
application=blooket-api plus key=<name>. Absolute executable paths prevent a
modified PATH from intercepting credential operations.

Stored values use a repository-owned v1. plus base64url envelope. The envelope
is not encryption; it provides an ASCII-only command representation and exact
UTF-8 round-trip checking. Keychain or Secret Service remains responsible for
host-level storage protection.

macOS writes never pass a secret value in argv. The adapter probes the item
without requesting its secret, then sends one security -i command through stdin.
New items explicitly trust /usr/bin/security; existing items update without
replacing their access-control list. Every successful write is read back through
the same adapter and compared before the caller receives success.

Exit 44 is treated as the Keychain not-found result.

Linux writes pass the encoded value to secret-tool store through stdin without
adding a newline. Lookup and clear use only non-secret attributes in argv. A
clean exit 1 with no stdout or stderr is the observed no-match result and is
treated as missing; other failures remain failures.

The shared subprocess runner has a five-second timeout and bounds stdout to 128
KiB. and never retains stderr text. Stdout is retained only for secret-read
commands; write, probe, and delete output is drained without being stored.
Callers receive stable error codes rather than command error strings.

Windows is currently unsupported. A future Credential Manager implementation
must satisfy the existing HostSecretStore port, so authentication callers do not
change when that backend is added.

## Consequences

- Production credentials stay out of repository-owned ordinary files.
- Secret values never appear in platform-command argv.
- Platform error strings cannot cross into diagnostics accidentally.
- Missing read and delete operations are idempotent on supported backends.
- A successful write means the stored value was read back byte-equivalently.
- The Linux backend requires a functioning Secret Service and secret-tool.
- The macOS backend depends on the system Keychain and may require normal user
  authorization when the Keychain is locked or access policy requires it.
- Secret-store operations can fail closed when the host service is unavailable,
  locked, times out, or returns an unrecognized stored envelope.

## Rejected Alternatives

- Plaintext project/settings storage was rejected because those files are part
  of ordinary lesson state and can cross transport or backup boundaries.
- Environment variables remain development-only because they are process state,
  not a production credential store.
- Passing security -w <secret> was rejected because it exposes the value in
  process arguments.
- A repository-managed encrypted file was rejected because it would require a
  separate key-management problem instead of using the host security service.
- Adding a third-party keyring package was rejected because the operating-system
  clients already provide the needed boundary with no new runtime dependency.

## Verification

Domain tests cover secret-name grammar, UTF-8 byte limits, and the maximum
accepted value. Platform tests use an injected command runner and verify macOS
create/update ACL behavior, Linux missing semantics, secret-free argv, read-back
verification, malformed data rejection, stable infrastructure failures, and the
security-domain port factory.

The command-runner tests verify stdin transport, timeouts, output ceilings,
uncaptured stdout draining, stderr-text elision, and missing executable
handling. A Linux development-host smoke check also exercises only a
guaranteed-missing random key so validation does not write a real credential.
