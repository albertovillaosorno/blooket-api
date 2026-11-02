# Typed unfinished work

`TODO.md` indexes unfinished work rather than implementation history. Each entry
has one `### TODO - ...` heading, one short synthesis paragraph, and one direct
link to its typed record. Acceptance, details, evidence, and blockers live under
`open/<area>/`; completed records move to `completed/<area>/`.

## Record contract

Version-one YAML front matter carries stable `id`, `status`, `priority`,
`horizon`, execution `order`, `area`, `task`, historical `legacy_task`,
`depends_on`, relevant `contracts`, owned `scope`, and `validation` commands.
Preserve IDs across renames/completion; never reuse them for unrelated work.

Status is `active` under `open/` and `completed` under `completed/`. Required
sections are Objective, Acceptance, and Evidence; add notes/blockers as needed.
Evidence names actual checks and dates, never assumed success or native proof
from portable tests. External blockers keep records active.

The displayed sequence in `TODO.md` owns execution order. Start at the first
unfinished entry; priority/horizon and numeric `order` are synchronized
metadata, not competing authorities. Dependencies gate completion; external
blockers may permit independently verified foundations as documented in the
developer profile.

## Reorder and split

Reorder tasks when actual scope or dependencies justify it, updating the
index, record order/priority, and affected dependencies together. Descriptive
file names remain independent of sequence; stable IDs are identity rather than
ranking.

To split a task, retain its ID for the continuing record, assign new stable
IDs to additional records, and give each one distinct acceptance and owned
scope. Move the relevant evidence/blockers without losing history and retarget
dependent records to their actual prerequisites. Never mark a task complete
merely because its scope was divided.

## Functional-first acceptance and evergreen exception

For current unfinished implementation milestones, **IT WORKS** means the
requested teacher-facing feature demonstrably works through its actual owning
product entrypoint. Keep required safety boundaries and actual results; do not
hold usable implementation hostage to exhaustive hypothetical platform tests,
aesthetic perfection, or unrelated hardening. Maintain targeted regression
evidence and never promote a mock or synthetic result into live acceptance.

The historical `blooket-15` maintenance record was **evergreen**: repeated
bug fixes, regression tests, UI improvements, and platform compatibility
assurance. Alberto explicitly approved closing this exact task on 2026-11-02.
Its full evidence is preserved in `completed/acceptance/teacher.mdc` and it
is no longer an unfinished roadmap entry.

**Never close an evergreen record without an explicit owner instruction.**
Tests, releases, and a lack of known bugs do not substitute for approval.
Closing this historical record does not claim exhaustive platform assurance,
authorize unattended work, or prevent future separately authorized fixes.

## Completion transaction

1. Verify acceptance and retain actual commands, results, and host/client
   evidence in the record.
2. Move it to `completed/<area>/`, set status completed, and retain its stable
   ID, dependencies, and evidence.
3. Remove its entire index entry and update durable links to the moved record.
4. Run `npm run roadmap:check` and relevant product validation gates.

Completed history never returns to the unfinished index. No old records were
reconstructed just to populate completed folders. An empty roadmap may retain
only the title and “No unfinished product work.”

## Integrity

The checker rejects malformed metadata, duplicate IDs, status/path mismatches,
unresolved contracts/scopes/dependencies, cycles, mismatched titles, repeated or
missing index links, unindexed open records, and completed records indexed as
unfinished. Portable tests cover completion moves and invalid fixtures; CI runs
the same check before packaging.
