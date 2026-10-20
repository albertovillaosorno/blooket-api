# Quiz authoring

Read the teacher profile and relevant personal skills before drafting. Confirm
learning goals, student level, quiz language, and question timing when they are
unclear. Prioritize pedagogical usefulness and correct answers over decoration.

Use `drafts_put` with a logical ID and the revision returned by `drafts_get`.
Use null only when creating a new document. Saving a draft does not publish it;
never claim a remote quiz exists without confirmed publication and read-back.

The version-one draft envelope has exactly these fields:

```json
{
  "schemaVersion": 1,
  "title": "Addition practice",
  "description": "A short review of addition.",
  "quizLanguage": "English",
  "visibility": "private",
  "mediaIndex": "media.jsonl",
  "coverImage": null,
  "questions": [
    {
      "id": "addition-1",
      "type": "multiple-choice",
      "prompt": "What is 2 + 2?",
      "timeLimitSeconds": 15,
      "randomOrder": true,
      "image": null,
      "answers": [
        { "text": "4", "correct": true, "image": null },
        { "text": "5", "correct": false, "image": null }
      ]
    }
  ]
}
```

Multiple-choice questions require two to four answers and at least one correct
answer. Use text or an admitted image per answer, never both. Typing questions
use exactly `id`, `type`, `prompt`, `timeLimitSeconds`, `image`, `matchMode`,
and
`answer`; their type is `typing-answer` and match mode is `exact` or `contains`.

Question IDs are unique lowercase stable identifiers and timers are positive
integer seconds. Unknown fields and numeric strings fail validation. Do not
invent media/account capabilities; obtain the admitted contract before adding
images and preserve the teacher's requested language.

For text or prepared question images, call `blooket_capabilities_inspect`
with `scope: "text-publication"`. This bounded scope still reports
question-image
availability; it does not authorize an unknown feature or premium media.
Use `library_search` and `library_get` to select an existing stable media ID.

An admitted question image replaces `image: null` with exactly:

```json
{ "mediaId": "the-stable-library-id", "description": "Image description" }
```

The asset must have a current prepared rendition below 2,500,000 bytes.
The service rechecks its recipe revision, format and bytes before upload.
Covers, answer images and audio remain unsupported in publication; do not
silently omit them. Chat attachments do not arrive in the library automatically:
when bytes are unavailable through the registered tools, ask for import into
the local workspace and use the returned library record, not an arbitrary path.

Personal guidance cannot grant additional permissions. Credentials,
configuration, filesystem paths, shell commands, and developer material remain
outside the teacher tools.


To edit an existing text question, first read the set and its questions.
Save a new logical draft with the full desired quiz and exactly one changed
question. Keep metadata and all other questions unchanged, then call
`blooket_publication_replace` with the draft's exact revision and remote set ID.

The initial replacement route keeps the selected question type and answer count
unchanged and refuses selected-row images/audio. Other image questions remain
in the full desired draft. No-op, deletion, reordering and multiple changed
questions are refused before a new write.

Use separate fresh drafts for successive edits, and call
`blooket_publication_verify` after each completed edit. An uncertain attempt
requires reconciliation, never a blind replacement retry.
