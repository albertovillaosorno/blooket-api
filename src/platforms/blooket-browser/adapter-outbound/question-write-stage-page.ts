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
//   - Read-only diagnostic stages of a locally owned Add Question form.
// - Must-Not:
//   - Click, type, reload, navigate, read personal content or infer a receipt.
// - Allows:
//   - Inputs: An existing owned browser isolated-world question watch.
//   - Outputs: One fixed state enum without IDs, text or URLs.
//   - Side effects: None.
// - Split-When:
//   - Different provider write surfaces require independent state probes.
// - Merge-When:
//   - Browser-owned writes expose stable, non-sensitive stage telemetry.
// - Summary:
//   - Separates missing ownership, incomplete controls and submitted states.
// - Description:
//   - A self-contained Chrome scripting function; no extension messages.
// - Usage:
//   - Optional authorized read-only diagnosis in the same isolated tab world.
// - Defaults:
//   - Unrecognized data, accessors or replaced documents are inconclusive.
//
export type BlooketQuestionWriteStage =
  | "no-owner" | "unavailable" | "replaced-document" | "detached-form"
  | "interrupted" | "opening" | "awaiting-controls" | "controls-prepared"
  | "awaiting-finalization" | "ready-for-save" | "submit-attempted";

export interface BlooketQuestionWriteStageRead {
  readonly kind: "blooket-question-write-stage";
  readonly stage: BlooketQuestionWriteStage;
}

export function inspectBlooketQuestionWriteStage():
  BlooketQuestionWriteStageRead {
  const result = (stage: BlooketQuestionWriteStage):
    BlooketQuestionWriteStageRead => ({
    kind: "blooket-question-write-stage", stage,
  });
  try {
    const field = Object.getOwnPropertyDescriptor(
      globalThis, "__blooketAddQuestionFormWatch",
    );
    if (!field) return result("no-owner");
    if (!("value" in field) || !field.enumerable ||
        !field.configurable) return result("unavailable");
    const watch: unknown = field.value;
    if (!watch || typeof watch !== "object" || Array.isArray(watch))
      return result("unavailable");
    const keys = ["document", "dirty", "submitted", "prepared", "finalized"];
    const own = (name: string): unknown => {
      const data = Object.getOwnPropertyDescriptor(watch, name);
      return data && data.enumerable && "value" in data
        ? data.value : undefined;
    };
    if (keys.some(key => own(key) === undefined))
      return result("unavailable");
    if (own("document") !== document) return result("replaced-document");
    if (["dirty", "submitted", "prepared", "finalized"].some(key =>
      typeof own(key) !== "boolean")) return result("unavailable");
    // A submit latch is set synchronously *before* the single provider click.
    // It remains evidence of an attempted write even if React unmounts the
    // form immediately afterwards. It is never proof of remote persistence.
    if (own("submitted") === true) return result("submit-attempted");
    if (own("dirty") === true) return result("interrupted");
    const form = own("form");
    const question = own("question");
    if (form !== undefined && (!form || typeof form !== "object" ||
        (form as Element).isConnected !== true))
      return result("detached-form");
    if (question !== undefined && (!question ||
        typeof question !== "object" ||
        (question as Element).isConnected !== true))
      return result("detached-form");
    if (form === undefined || question === undefined)
      return result("opening");
    if (own("controlsStarted") !== true ||
        own("controlsPrepared") !== true)
      return result("awaiting-controls");
    if (own("prepared") !== true)
      return result("controls-prepared");
    if (own("finalized") !== true)
      return result("awaiting-finalization");
    return result("ready-for-save");
  } catch {
    return result("unavailable");
  }
}
