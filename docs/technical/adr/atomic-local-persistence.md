# Atomic local persistence

## Status

Accepted.

## Decision ID

`blooket-api.persistence.atomic-local-state`

## Context

Projects, settings, media metadata, imported originals, and prepared renditions
must survive process termination and host power loss without turning a previous
valid state into an ambiguous partial state. Several processes may also reach
the same local data through the CLI, desktop application, or localhost service.

A successful write therefore needs more than a temporary file and a rename.
New bytes, directory-entry changes, backups, multi-file transactions, and writer
coordination each need an explicit durability rule.

## Decision

All durable local paths are chosen by trusted product or platform code. Durable
file adapters refuse symbolic durable targets and do not accept path text from
model-produced content.

A single-file replacement follows this order:

1. Create a unique hidden temporary file in the target directory with
   owner-only permissions.
2. Write the complete validated contents to that file.
3. Flush the temporary file before it can become the durable name.
4. If the owning contract requires a previous-value backup, publish and flush
   that backup before replacing the target.
5. Rename the temporary file over the target in the same directory.
6. Flush the containing directory after the rename.
7. Remove only temporary state created by the current operation.

Durable deletion removes the regular file and then flushes its containing
directory. Deleting a transaction marker without that directory flush is not a
completed commit because the marker could reappear after a crash.

Writers serialize at the smallest aggregate that must remain coherent. Settings
use a lock adjacent to the settings file. A lesson project uses one lock for the
whole directory because `project.json`, `media.jsonl`, their backups, and the
transaction marker form one persistence aggregate. The media vault uses one
vault-level metadata lock for index mutations; a future operation may use a
narrower per-asset lock only when it cannot change shared metadata.

The POSIX lock adapter publishes complete owner metadata with a same-directory
hard link. A visible lock therefore never depends on a partially written owner
record. A lock owned by a live PID is never stolen.

A recorded PID that is definitely absent may be reclaimed. Dead-lock
reclamation is serialized through a sibling recovery guard so two reclaimers
cannot remove each other's newly acquired lock. An existing, malformed,
symbolic, or otherwise unverifiable recovery guard fails closed rather than
being recursively reclaimed.

Malformed, symbolic, or otherwise unverifiable primary locks also fail closed.
PID reuse can cause a false busy result, which is safer than stealing another
writer's lock.

Project replacement is a recoverable multi-file transaction. Before publishing
a marker, any existing valid `project.json` and `media.jsonl` are snapshotted
to their fixed previous-value backups. The marker records which files existed.

The media index is replaced before the project document, the project document
is replaced last, and the marker is durably deleted only after both replacements
are flushed. Recovery with a valid marker restores the exact pre-transaction
pair. Missing required backups or invalid markers fail closed instead of
guessing.

Settings retain one previous-value backup when replacing an existing file.
Project persistence retains one coherent previous project/media pair. Backups
are recovery material, not history; version history belongs in a different
future capability.

Media-vault originals are immutable after a stable media identity is committed.
An import derives `originals/<id>.<source>` and `media/<id>.<rendition>` from
validated identity and formats; callers never select those relative paths.

The vault writes transaction-specific staging files in each asset directory and
durably hard-links them to the final no-clobber paths. Staging links remain
until `media.jsonl` is atomically replaced, making the metadata replacement the
commit point. The index retains one previous-value `media.jsonl.bak`.

A strict marker records only validated metadata, formats, and a transaction
UUID.
If an interrupted import has no committed metadata, recovery removes a final
asset only when its staging path still proves the same filesystem device and
inode. A different inode is preserved, and a final file without sufficient
ownership evidence fails recovery closed. If exact metadata is already present,
both final assets must exist before recovery removes staging links and the
marker.

Shared vault metadata is therefore published only after every referenced asset
required by that metadata is durable. Failed imports leave no metadata reference
to a missing or partial asset, and recovery never guesses ownership from a path
name alone.

Temporary names, lock names, transaction markers, and backup names are
repository-owned implementation details. Product decoders never interpret them
as lesson media. Normal successful operations remove their temporary files.
Crash leftovers that cannot be proven safe to remove are ignored or surfaced
for recovery rather than guessed away.

## Consequences

- A reported successful write has flushed both its bytes and its directory
  entry transitions on the supported POSIX hosts.
- Concurrent writers fail closed instead of racing backup or marker state.
- Project recovery can restore one exact previous aggregate after interruption.
- The media pipeline has a persistence contract before it begins accepting
  large binary inputs.
- Windows remains deferred because its replacement and locking semantics may
  require a distinct platform implementation.

## Rejected Alternatives

- In-place editing was rejected because interruption can destroy the only valid
  copy.
- Rename without file and directory flushes was rejected because visibility to
  another process is not the same as crash durability.
- A lock file created and then populated was rejected because another process
  can observe incomplete owner metadata.
- Time-based lock stealing was rejected because a paused but valid writer must
  not lose ownership merely for exceeding a guessed duration.
- Independent locks for `project.json` and `media.jsonl` were rejected
  because readers and recovery require those files to remain one aggregate.
- Copying mutable vault metadata before its referenced binary assets were
  durable was rejected because it can publish dangling media references.

## Verification

`tests/platforms/atomic-files/adapter-outbound/atomic-file_tests.ts` verifies
replacement, backup, deletion, permissions, symlink refusal, and cleanup.

`tests/platforms/file-locks/adapter-outbound/file-lock_tests.ts` verifies live
writer exclusion, dead-PID recovery, unsafe-lock refusal, and normal owner-file
cleanup.

`tests/platforms/project-files/adapter-outbound/directory_tests.ts` verifies
coherent project backups, interruption recovery, lock exclusion, and fail-closed
unsafe states. Settings persistence tests verify migration, backup replacement,
lock exclusion, and symlink refusal.
