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

Priorities p0–p3 cover foundations, publication, delivery, and recipient
acceptance. Execution order preserves tasks 03–16; update task 17 has order 145,
between packaging and teacher acceptance. Dependencies gate completion while
allowing independently verified foundations when external acceptance is blocked.

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
