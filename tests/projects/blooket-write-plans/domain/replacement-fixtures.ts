// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - MIT
// Confidential:
//   - false
// License-File:
//   - LICENSE-MIT
//
// Boundary-Contract:
// - Owns:
//   - Behavioral tests for validated deterministic Blooket write planning.
// - Must-Not:
//   - Call Blooket or imply remote selectors, routes, or IDs.
// - Allows:
//   - Inputs: Fixed local project/media fixtures.
//   - Outputs: Deterministic plan and readiness verdicts.
//   - Side effects: None.
// - Split-When:
//   - Set and question operation fixtures require independent suites.
// - Merge-When:
//   - Desired-state write planning is removed.
// - Summary:
//   - Proves validation, determinism, operation identity, and media lowering.
// - Description:
//   - Mirrors the replacement plan and its saved-question fixtures.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Media descriptions never enter remote-facing plan payloads.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";
import type { BlooketQuestionRead } from
  "../../../../src/ir/blooket-question-reads/contract/question-read.ts";

const capabilities = JSON.parse(await readFile(new URL(
  "../../../ir/capability-snapshots/contract/" +
    "blooket-official-2026-10-05.json", import.meta.url), "utf8"));
export function replacementFixture() {
  const document = { schemaVersion: 1, title: "Replacement fixture",
    description: "Synthetic test", quizLanguage: "English",
    visibility: "private", mediaIndex: "media.jsonl", coverImage: null,
    questions: ["First question.", "Type moon."].map((prompt, index) => ({
      id: "q" + String(index + 1), type: "typing-answer", prompt,
      timeLimitSeconds: 20, image: null, matchMode: "exact",
      answer: index === 0 ? "sun" : "moon",
    })) };
  const built = buildBlooketWritePlan(JSON.stringify(document), "",
    capabilities);
  assert.ok(built.ok);
  const rows: BlooketQuestionRead[] = document.questions.map((q, index) => ({
    schemaVersion: 3, number: index + 1,
    question: index === 0 ? q.prompt : "Old second question.",
    equation: null, qType: "typing", random: true,
    timeLimit: index === 0 ? 20 : 10,
    answers: [{ kind: "text", content: q.answer, correct: true,
      match: "exactly" }], hasImage: false, hasAudio: false,
  }));
  return { desired: built.value, rows, previous: rows[1]!,
    changed: { ...rows[1]!, question: "Type moon.", timeLimit: 20 } };
}
