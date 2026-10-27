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
import { exactOwnData, snapshotExactDenseArray } from
  "../../runtime-decoding/domain/exact-object.ts";
import type { DecodeResult } from
  "../../runtime-decoding/domain/decode-result.ts";
import { decodeBlooketSetDetail, type BlooketSetDetail } from
  "../../blooket-set-reads/contract/set-read.ts";
import { decodeBlooketQuestionRead, type BlooketQuestionRead } from
  "../../blooket-question-reads/contract/question-read.ts";

export const TEXT_REVISION_COMMAND = "blooket.publication.revise-text";
export interface BlooketTextRevision {
  readonly schemaVersion: 1;
  readonly expectedSet: BlooketSetDetail;
  readonly change:
    | { readonly kind: "set-title"; readonly title: string }
    | { readonly kind: "question-text";
        readonly previous: BlooketQuestionRead;
        readonly question: string; readonly answers: readonly string[] };
}
export interface BlooketTextRevisionPort {
  revise(input: BlooketTextRevision, verifyOnly: boolean):
    Promise<{ readonly outcome: "verified" | "not-submitted" |
      "unchanged" | "uncertain";
      readonly stage?: string }>;
}

export function decodeBlooketTextRevision(value: unknown):
  DecodeResult<BlooketTextRevision> {
  const invalid = (): DecodeResult<BlooketTextRevision> => ({
    ok: false, issues: [{ path: "$.payload",
      code: "invalid-text-revision",
      message: "Expected saved set metadata and one text-only change. " +
        "Media, timing, answer correctness and question order must remain.",
    }],
  });
  try {
    const input = exactOwnData(value,
      ["schemaVersion", "expectedSet", "change"]);
    if (!input || input["schemaVersion"] !== 1) return invalid();
    const metadata = decodeBlooketSetDetail(input["expectedSet"]);
    if (!metadata.ok) return invalid();
    const title = exactOwnData(input["change"], ["kind", "title"]);
    if (title?.["kind"] === "set-title") {
      if (!text(title["title"], 75) ||
          title["title"] === metadata.value.title) return invalid();
      return { ok: true, value: { schemaVersion: 1,
        expectedSet: metadata.value,
        change: { kind: "set-title", title: title["title"] } } };
    }
    const change = exactOwnData(input["change"],
      ["kind", "previous", "question", "answers"]);
    if (!change || change["kind"] !== "question-text" ||
        !text(change["question"], 20_000)) return invalid();
    const previous = decodeBlooketQuestionRead(change["previous"]);
    const answers = snapshotExactDenseArray(change["answers"], 100);
    if (!previous.ok || previous.value.hasAudio ||
        previous.value.equation !== null ||
        previous.value.answers.some(a => a.kind !== "text") ||
        !answers || answers.length !== previous.value.answers.length ||
        answers.some(a => !text(a, 10_000)) ||
        new Set(answers).size !== answers.length ||
        (previous.value.qType === "typing" && answers.some(a =>
          typeof a === "string" && /[\r\n]/u.test(a))) ||
        (change["question"] === previous.value.question &&
          answers.every((a, i) => a === previous.value.answers[i]?.content)))
      return invalid();
    return { ok: true, value: { schemaVersion: 1,
      expectedSet: metadata.value,
      change: { kind: "question-text", previous: previous.value,
        question: change["question"], answers: answers as string[] } } };
  } catch { return invalid(); }
}

function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && !!value.trim() &&
    value.length <= limit && !/[\x00\r]/u.test(value) &&
    !value.includes("`*") && !value.includes("`~`");
}
