# Media description normalization

Use this skill when a library record needs language identification, searchable
English normalization, or topics. Read the current record with `library_get`
before writing anything.

Normalize every record, including originals already written in English. Preserve
the teacher's original name and description exactly. The normalized English
description should use this semantic order when the evidence supports it:

1. primary visible subject;
2. visible attributes or actions;
3. setting and composition;
4. teaching context only when it is actually supported.

Prefer generalized descriptive wording that is useful for search and quiz
matching. Do not guess a person's identity, location, brand, event,
relationship,
or other fact that is not established by admitted evidence. Keep the normalized
English name short and descriptive.

Identify the language of the teacher's source text and use a bounded language
tag such as `en`, `es`, or `es-MX`. Derive concise topics from the source text
and admitted visual evidence. Topics should describe useful concepts, not merely
repeat every word in the description.

When admitted image pixels are available, analyze them before finalizing
image-grounded wording or topics. If pixels are unavailable, say that visual
analysis was unavailable and limit the result to evidence actually present in
the record or current task. Never claim image-grounded analysis without image
evidence.

Save the current result with `library_enrich`, passing the exact record ID and
revision plus detected language, normalized English name/description, and
topics. A successful tool result with `normalizationStatus: completed` is the
completion evidence. Do not treat locally drafted text as saved.

If the write reports a revision conflict, read the record again and reassess the
current source before writing. Do not overwrite a concurrent teacher edit.

`pending` means current normalization evidence is incomplete. `stale` means a
saved AI result belongs to an older original revision. Neither state is
complete.

Generated normalization is never human verification. Do not change filenames,
asset paths, teacher-authored text, image edits, credentials, or configuration.
