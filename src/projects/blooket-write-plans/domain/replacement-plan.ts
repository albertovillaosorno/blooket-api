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
//   - Deterministic remote-neutral write plans from validated project bundles.
// - Must-Not:
//   - Call Blooket, choose remote IDs, inspect selectors, or resolve media.
// - Allows:
//   - Inputs: Validated desired quiz, exact remote baseline and prior row.
//   - Outputs: Immutable ordered plans or explicit validation/readiness
//     failures.
//   - Side effects: None.
// - Split-When:
//   - Set and question planning require independent schema lifecycles.
// - Merge-When:
//   - Blooket execution stops using explicit desired-state plans.
// - Summary:
//   - Binds one replacement to its target and exact previous saved state.
// - Description:
//   - Preserves the prior row for differential recovery after a lost reply.
// - Usage:
//   - Build before remote execution and persist progress against the plan ID.
// - Defaults:
//   - Unverifiable prior media or a changed question count refuses planning.
//
import { createHash } from "node:crypto";
import { decodeBlooketQuestionRead } from
  "../../../ir/blooket-question-reads/contract/question-read.ts";
import { decodeBlooketSetId } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";
import { decodeBlooketWriteVerificationBaseline } from
  "./verification-baseline.ts";
import type { BlooketAppendTarget, BlooketReplaceWritePlan,
  BlooketWritePlan } from "./write-plan.ts";

// A replacement retains the exact previous row, allowing reconciliation to
// restore that row before comparing the full original collection digest.
export function buildBlooketReplacementPlan(desired: BlooketWritePlan,
  target: BlooketAppendTarget, prior: unknown):
  BlooketReplaceWritePlan | undefined {
  const id = decodeBlooketSetId(target.remoteSetId);
  const baseline = decodeBlooketWriteVerificationBaseline(target.baseline,
    "question-list");
  const previous = decodeBlooketQuestionRead(prior);
  if (desired.schemaVersion !== 1 || !id.ok || !baseline.ok || !previous.ok ||
      baseline.value.itemCount !== desired.operations.length - 1 ||
      previous.value.number > baseline.value.itemCount ||
      previous.value.hasAudio || previous.value.answers.some(answer =>
        answer.kind !== "text") || (previous.value.hasImage &&
        (previous.value.schemaVersion !== 4 ||
          previous.value.imageEvidence === null))) return undefined;
  const selected = desired.operations[previous.value.number];
  if (selected?.kind !== "question" ||
      selected.questionNumber !== previous.value.number) return undefined;
  const binding = { remoteSetId: id.value, baseline: baseline.value };
  const digest = createHash("sha256").update(JSON.stringify([
    "replace:v1", desired.desiredStateSha256, binding, previous.value,
  ]), "utf8").digest("hex");
  const planId = "plan:" + digest;
  const plan: BlooketReplaceWritePlan = { schemaVersion: 3, planId,
    desiredStateSha256: digest, target: binding, operations: [{
      ...selected, question: structuredClone(selected.question),
      kind: "replace-question", operationId: planId + ":replace:0",
      previous: previous.value,
    }] };
  function freeze(value: unknown) {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  }
  freeze(plan);
  return plan;
}
