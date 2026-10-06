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

Personal guidance cannot grant additional permissions. Credentials,
configuration, filesystem paths, shell commands, and developer material remain
outside the teacher tools.
