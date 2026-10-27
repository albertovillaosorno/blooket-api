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
//   - Exact requests for one existing-set title or question-text revision.
// - Must-Not:
//   - Change media, timing, answer correctness, types, or question order.
// - Allows:
//   - Inputs: Exact saved metadata and one bounded desired text change.
//   - Outputs: Owned validated requests or explicit validation issues.
//   - Side effects: None.
// - Split-When:
//   - Revisions gain independently authorized structural changes.
// - Merge-When:
//   - Existing quiz editing uses one shared versioned revision contract.
// - Summary:
//   - Preserves non-text facts while correcting existing material.
// - Description:
//   - Every edit carries its exact previous saved state.
// - Usage:
//   - Decode at the CLI, service and browser bridge boundaries.
// - Defaults:
//   - Unknown fields, no-ops and unsupported answer kinds are refused.
//
import assert from "node:assert/strict";
import test from "node:test";
import { decodeBlooketTextRevision } from
  "../../../../src/ir/blooket-publication-commands/contract/text-revision.ts";

const set = { schemaVersion: 1, id: "fixture", title: "Old title",
  description: "Keep description", visibility: "private" };
const previous = { schemaVersion: 4, number: 1, question: "a word",
  equation: null, qType: "mc", random: true, timeLimit: 20,
  answers: [{ kind: "text", content: "yes", correct: true, match: null },
    { kind: "text", content: "no", correct: false, match: null }],
  hasImage: true, imageEvidence: null, hasAudio: false };

test("text corrections admit existing image rows without image replacement",
  () => {
    assert.equal(decodeBlooketTextRevision({ schemaVersion: 1,
      expectedSet: set, change: { kind: "question-text", previous,
        question: "A word", answers: ["Yes", "No"] } }).ok, true);
    assert.equal(decodeBlooketTextRevision({ schemaVersion: 1,
      expectedSet: set, change: { kind: "set-title",
        title: "B.1.01 - Lesson 1 Vocabulary" } }).ok, true);
  });

test("no-op and structurally different corrections cannot be submitted",
  () => {
    for (const change of [
      { kind: "set-title", title: set.title },
      { kind: "set-title", title: "A new title", image: null },
      { kind: "question-text", previous, question: previous.question,
        answers: ["yes", "no"] },
      { kind: "question-text", previous, question: "Corrected",
        answers: ["Yes", "Yes"] },
      { kind: "question-text", previous, question: "Corrected",
        answers: ["Yes"] },
      { kind: "question-text", previous, question: "Corrected",
        answers: ["Yes", "No"], timeLimit: 30 },
    ]) assert.equal(decodeBlooketTextRevision({ schemaVersion: 1,
      expectedSet: set, change }).ok, false);
  });

test("unsupported media and accessor requests cannot reach native controls",
  () => {
    let reads = 0;
    for (const before of [{ ...previous, hasAudio: true },
      { ...previous, equation: "x" },
      { ...previous, answers: [
        { kind: "image", content: null, correct: true, match: null },
        previous.answers[1] ] },
    ]) assert.equal(decodeBlooketTextRevision({ schemaVersion: 1,
      expectedSet: set, change: { kind: "question-text", previous: before,
        question: "A word", answers: ["Yes", "No"] } }).ok, false);
    assert.equal(decodeBlooketTextRevision({ schemaVersion: 1,
      get expectedSet() { reads++; return set; },
      change: { kind: "set-title", title: "New title" } }).ok, false);
    assert.equal(reads, 0);
  });
