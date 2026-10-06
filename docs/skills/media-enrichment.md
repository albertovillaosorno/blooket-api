# Media selection and English enrichment

Search the library by original text, generated English, or topics. Search
returns bounded `records`, `total`, and `nextCursor`; pass that cursor as
`after`
with the same query to continue. Use stable IDs from results instead of guessing
filenames or declaring an image missing after only the first page.

Use `library_get` to read a chosen record and its current revision. Keep
original
names, descriptions, language, and filenames intact. Generated English belongs
in separate fields; it does not rename assets or establish human verification.

Use `library_enrich` with the record's ID/revision, generated English name and
description, and relevant topics. Read again after a revision conflict instead
of overwriting concurrent changes. A translation is stale when its
`sourceRevision` differs from `original.revision`.

Canonical library media and prepared renditions are different. Temporary intake
source bytes are not retained. An image is eligible for
upload only after preparation, recipe validation, and an actual byte-size check
below 2,500,000 bytes at the upload boundary. A preview or metadata size alone
cannot establish that eligibility.

Do not request arbitrary paths, source renames, credentials, or configuration.
An image attached to a chat is not automatically available to MCP; use only an
admitted intake flow and report an unavailable capability clearly.
