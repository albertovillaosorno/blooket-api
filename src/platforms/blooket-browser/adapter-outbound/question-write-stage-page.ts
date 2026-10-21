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
  | "awaiting-finalization" | "ready-for-save" | "submit-attempted"
  | "post-submit-interrupted";

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
    if (own("submitted") === true) return result(
      own("dirty") === true ? "post-submit-interrupted" : "submit-attempted");
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

// A submitted latch can belong to an earlier SPA route in the same native
// document. Only the exact set that owns that latch may authorize a detached
// read. No account identifiers are ever returned by this injected probe.
export function inspectBlooketSubmittedQuestionOwner(
  setId: string,
): boolean {
  try {
    if (typeof setId !== "string" || !setId || setId.length > 512 ||
        /[\x00-\x1f\x7f]/u.test(setId)) return false;
    const url = new URL(location.href);
    if (url.origin !== "https://dashboard.blooket.com" ||
        url.pathname !== "/edit" || url.hash ||
        url.searchParams.size !== 1 ||
        url.searchParams.getAll("id").length !== 1 ||
        url.searchParams.get("id") !== setId) return false;
    const field = Object.getOwnPropertyDescriptor(
      globalThis, "__blooketAddQuestionFormWatch",
    );
    if (!field || !field.enumerable || !field.configurable ||
        !("value" in field)) return false;
    const watch = field.value;
    if (!watch || typeof watch !== "object" || Array.isArray(watch))
      return false;
    const own = (key: string): unknown => {
      const data = Object.getOwnPropertyDescriptor(watch, key);
      return data?.enumerable && "value" in data ? data.value : undefined;
    };
    return own("document") === document && own("setId") === setId &&
      own("submitted") === true && own("dirty") === false;
  } catch { return false; }
}

// The provider can keep an Edit form visible when a Save-triggered fetch was
// throttled. Observe only a same-origin HTTP 429 *after* the one owned submit
// latch. A 429 from initial navigation or another set cannot explain Save.
// This is a conservative wait signal, not proof of remote non-persistence.
export function inspectBlooketPostSubmitRateLimit(setId: string): boolean {
  try {
    if (!setId || setId.length > 512 ||
        /[\x00-\x1f\x7f]/u.test(setId)) return false;
    const url = new URL(location.href);
    if (url.origin !== "https://dashboard.blooket.com" ||
        url.pathname !== "/edit" || url.hash ||
        url.searchParams.size !== 1 ||
        url.searchParams.get("id") !== setId) return false;
    const owner = Object.getOwnPropertyDescriptor(
      globalThis, "__blooketAddQuestionFormWatch",
    );
    if (!owner || !("value" in owner) || !owner.enumerable ||
        !owner.configurable || !owner.value ||
        typeof owner.value !== "object") return false;
    const own = (key: string): unknown => {
      const field = Object.getOwnPropertyDescriptor(owner.value, key);
      return field && "value" in field && field.enumerable
        ? field.value : undefined;
    };
    const started = own("submitStartMs");
    if (own("document") !== document || own("setId") !== setId ||
        own("submitted") !== true || own("dirty") !== false ||
        typeof started !== "number" || !Number.isFinite(started) ||
        started < 0 || started > performance.now()) return false;
    const entries = performance.getEntriesByType("resource");
    // An evicted or huge timing buffer is inconclusive, never permission to
    // retry. We do not request headers, bodies, parameters or credentials.
    if (entries.length > 2_000) return false;
    return entries.some(entry => {
      if (entry.entryType !== "resource" ||
          (entry as PerformanceResourceTiming).initiatorType !== "fetch" ||
          (entry as PerformanceResourceTiming).responseStatus !== 429 ||
          !Number.isFinite(entry.startTime) ||
          entry.startTime < started ||
          entry.startTime > performance.now()) return false;
      const requested = new URL(entry.name);
      return requested.origin === url.origin &&
        requested.pathname === url.pathname &&
        requested.search === url.search;
    });
  } catch { return false; }
}
