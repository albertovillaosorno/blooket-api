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
//   - Regression evidence for pre-mutation Blooket transport selection.
// - Must-Not:
//   - Execute writes or mark the HTTP response contract verified.
// - Allows:
//   - Inputs: Synthetic validated submissions and ambiguity state.
//   - Outputs: Exact browser-fallback or reconciliation decisions.
//   - Side effects: None.
// - Split-When:
//   - Verified HTTP transport gains its own execution fixtures.
// - Merge-When:
//   - Transport selection is removed.
// - Summary:
//   - Proves HTTP candidates stay inactive and ambiguity never falls back.
// - Description:
//   - Browser selection occurs only before any primary mutation starts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - The current HTTP response contract is unverified.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOOKET_HTTP_RESPONSE_CONTRACT,
  selectBlooketWriteTransport,
} from
  "../../../../src/api/blooket-http-actions/application/transport-selection.ts";
import type {
  BlooketAddQuestionSubmission,
  BlooketCreateSetSubmission,
} from
  "../../../../src/ir/blooket-write-submissions/contract/write-submission.ts";

const create: BlooketCreateSetSubmission = {
  schemaVersion: 1,
  kind: "create-set",
  title: "Synthetic set",
  description: "Synthetic transport-selection fixture",
  private: true,
  coverImage: null,
};

test("lowerable HTTP candidates still select browser while unverified", () => {
  assert.equal(BLOOKET_HTTP_RESPONSE_CONTRACT, "unverified");
  assert.deepEqual(
    selectBlooketWriteTransport(create, "not-started"),
    {
      kind: "browser",
      reason: "http-response-unverified",
    },
  );
});

test("HTTP-unsupported media selects browser before mutation", () => {
  assert.deepEqual(
    selectBlooketWriteTransport(
      { ...create, coverImage: { mediaId: "cover" } },
      "not-started",
    ),
    {
      kind: "browser",
      reason: "http-operation-unsupported",
    },
  );
});

test(
  "an ambiguous primary mutation requires reconciliation, never fallback",
  () => {
  const question: BlooketAddQuestionSubmission = {
    schemaVersion: 1,
    kind: "add-question",
    remoteSetId: "opaque-set",
    number: 1,
    question: "Type sun.",
    answers: [{ kind: "text", text: "sun", correct: true }],
    image: null,
    audio: "",
    qType: "typing",
    random: true,
    answerTypes: ["exactly"],
    timeLimit: 15,
  };
  assert.deepEqual(
    selectBlooketWriteTransport(question, "ambiguous"),
    {
      kind: "reconciliation-required",
      reason: "ambiguous-primary-mutation",
    },
  );
  assert.deepEqual(
    selectBlooketWriteTransport(
      { ...create, coverImage: { mediaId: "cover" } },
      "ambiguous",
    ),
    {
      kind: "reconciliation-required",
      reason: "ambiguous-primary-mutation",
    },
  );
  },
);
