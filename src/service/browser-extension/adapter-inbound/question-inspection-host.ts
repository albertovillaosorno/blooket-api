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
//   - Bounded, structurally stable reads of existing Blooket question panels.
// - Must-Not:
//   - Submit question forms, infer server completeness, or expose media URLs.
// - Allows:
//   - Inputs: One exact edit tab, opaque set ID, and a finite read deadline.
//   - Outputs: Untrusted question candidates or a stable browser failure.
//   - Side effects: Open and cancel each inspected question panel.
// - Split-When:
//   - Native browser read mechanisms require independent orchestration.
// - Merge-When:
//   - The worker's read transport owns the same bounded scan semantics.
// - Summary:
//   - Rejects mixed question enumerations and incomplete panel cleanup.
// - Description:
//   - A stable visible list is required before and after modal reads.
// - Usage:
//   - Invoke only from the admitted questions.list extension command.
// - Defaults:
//   - Ambiguous shape, list drift, or deadline exhaustion fails closed.
//
import { decodeBlooketQuestionRead, type BlooketQuestionRead } from
  "../../../ir/blooket-question-reads/contract/question-read.ts";
import {
  closeBlooketQuestionPanel,
  inspectOpenedBlooketQuestion,
  isBlooketQuestionPanelClosed,
  listBlooketQuestionNumbers,
  openBlooketQuestionPanel,
} from
  "../../../platforms/blooket-browser/adapter-outbound/question-page.ts";

interface BrowserTab {
  readonly url?: string;
  readonly status?: string;
}

export interface QuestionInspectionChromePort {
  readonly tabs: {
    get(tabId: number): Promise<BrowserTab>;
  };
  readonly scripting: {
    executeScript(options: {
      readonly target: { readonly tabId: number };
      readonly func: (...args: never[]) => unknown;
      readonly args?: unknown[];
    }): Promise<readonly { readonly result?: unknown }[]>;
  };
}

export type ExtensionQuestionInspectionResult =
  | { readonly ok: true; readonly value: readonly unknown[] }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

const POLL_MS = 100;
const MAX_POLLS = 15;
const MAX_QUESTIONS = 200;
// Leave space for the bridge response envelope and JSON framing (1 MB limit).
const MAX_RESULT_BYTES = 750_000;
const MAX_NUMBER = 10_000;
const DASHBOARD_ORIGIN = "https://dashboard.blooket.com";

export function createExtensionQuestionInspectionHost(
  chrome: QuestionInspectionChromePort,
  tabId: number,
  pause: (ms: number) => Promise<void> = async (ms) =>
    await new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = Date.now,
) {
  const script = async (
    func: (...args: never[]) => unknown,
    args: unknown[],
  ): Promise<unknown> => {
    const replies = await chrome.scripting.executeScript({
      target: { tabId }, func, args,
    });
    if (replies.length !== 1 || replies[0]?.result === undefined)
      throw new Error("browser-question-script-failed");
    return replies[0].result;
  };
  const ready = async (url: string, deadline: number): Promise<boolean> => {
    if (now() >= deadline) return false;
    const tab = await chrome.tabs.get(tabId);
    // Chrome may finish a tab request after the caller's read deadline.
    // Never let that late response authorize another page script or click.
    return now() < deadline &&
      tab.status === "complete" && tab.url === url;
  };
  const enumerate = async (
    setId: string, url: string, deadline: number,
    waitForControls = false,
  ): Promise<readonly number[] | undefined> => {
    const attempts = waitForControls ? MAX_POLLS : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (!await ready(url, deadline)) return undefined;
      const result = await script(
        listBlooketQuestionNumbers as (...args: never[]) => unknown,
        [setId],
      );
      // A failed page observation can mean that React is not hydrated yet.
      // Retry only the exact, secret-free failure, never malformed envelopes.
      if (
        waitForControls && result && typeof result === "object" &&
        !Array.isArray(result) &&
        Object.keys(result).sort().join() === "code,ok" &&
        "ok" in result && result.ok === false &&
        "code" in result && result.code === "blooket-browser-failed"
      ) {
        if (attempt + 1 >= attempts || now() >= deadline)
          return undefined;
        await pause(POLL_MS);
        continue;
      }
      if (!result || typeof result !== "object" || Array.isArray(result) ||
          Object.keys(result).sort().join() !== "ok,value" ||
          !("ok" in result) || result.ok !== true ||
          !("value" in result) || !Array.isArray(result.value) ||
          result.value.length === 0 ||
          result.value.length > MAX_QUESTIONS)
        return undefined;
      const seen = new Set<number>();
      for (const number of result.value) {
        if (!Number.isSafeInteger(number) || number < 1 ||
            number > MAX_NUMBER || seen.has(number)) return undefined;
        seen.add(number);
      }
      // A scripted answer from a tab that switched mid-flight is not evidence.
      return await ready(url, deadline) ? result.value as number[] : undefined;
    }
    return undefined;
  };
  const close = async (
    setId: string, url: string, deadline: number,
  ): Promise<boolean> => {
    // Cleanup is attempted even after a deadline; it cannot confirm success
    // unless the exact tab and panel closure are actually observed.
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab?.status !== "complete" || tab.url !== url) return false;
    const canceled = await script(
      closeBlooketQuestionPanel as (...args: never[]) => unknown,
      [setId],
    ).catch(() => false);
    if (canceled !== true) return false;
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      // A route change after Cancel must not authorize a closure probe in
      // the teacher's newly selected page, even during best-effort cleanup.
      const current = await chrome.tabs.get(tabId).catch(() => undefined);
      if (current?.status !== "complete" || current.url !== url)
        return false;
      const closed = await script(
        isBlooketQuestionPanelClosed as (...args: never[]) => unknown,
        [setId],
      ).catch(() => false);
      if (closed === true && await ready(url, deadline)) return true;
      if (now() >= deadline) break;
      await pause(POLL_MS);
    }
    return false;
  };
  return {
    inspect: async (
      setId: string,
      deadline: number,
    ): Promise<ExtensionQuestionInspectionResult> => {
      if (!setId || setId.length > 512 ||
          /[\x00-\x1f\x7f]/u.test(setId) ||
          !Number.isFinite(deadline) || deadline <= now())
        return browserFailure();
      const url = DASHBOARD_ORIGIN + "/edit?id=" +
        encodeURIComponent(setId);
      try {
        const numbers = await enumerate(setId, url, deadline, true);
        if (!numbers) return browserFailure();
        const questions: BlooketQuestionRead[] = [];
        const encoder = new TextEncoder();
        let totalBytes = 2; // JSON array brackets.
        for (const number of numbers) {
          if (!await ready(url, deadline)) return browserFailure();
          const opened = await script(
            openBlooketQuestionPanel as (...args: never[]) => unknown,
            [setId, number],
          );
          if (opened !== true) return browserFailure();
          let decoded: BlooketQuestionRead | undefined;
          let invalid = false;
          let closed = false;
          try {
            for (let attempt = 0; attempt < MAX_POLLS && now() < deadline;
              attempt++) {
              if (!await ready(url, deadline)) {
                invalid = true;
                break;
              }
              const inspected = await script(
                inspectOpenedBlooketQuestion as (...args: never[]) => unknown,
                [setId, number],
              );
              if (!await ready(url, deadline)) {
                invalid = true;
                break;
              }
              // Only an exact page-unavailable reply can reflect hydration.
              // Invalid successful data cannot be repaired by a later reply.
              if (
                inspected && typeof inspected === "object" &&
                !Array.isArray(inspected) &&
                Object.keys(inspected).sort().join() === "code,ok" &&
                "ok" in inspected && inspected.ok === false &&
                "code" in inspected &&
                inspected.code === "blooket-browser-failed"
              ) {
                await pause(POLL_MS);
                continue;
              }
              decoded = decodeInspectedQuestion(inspected, number);
              if (!decoded) invalid = true;
              break;
            }
            if (decoded && !invalid && await ready(url, deadline)) {
              // A question may change while the modal remains open even when
              // its row number is unchanged. Compare canonical facts twice.
              await pause(0);
              if (now() >= deadline || !await ready(url, deadline))
                invalid = true;
              else {
                const again = await script(
                  inspectOpenedBlooketQuestion as (...args: never[]) => unknown,
                  [setId, number],
                );
                const confirmed = decodeInspectedQuestion(again, number);
                if (
                  now() >= deadline || !confirmed ||
                  JSON.stringify(decoded) !== JSON.stringify(confirmed)
                ) invalid = true;
              }
            } else invalid = true;
          } finally {
            closed = await close(setId, url, deadline);
          }
          if (invalid || !closed || !decoded) return browserFailure();
          totalBytes += encoder.encode(JSON.stringify(decoded)).byteLength + 1;
          if (totalBytes > MAX_RESULT_BYTES) return browserFailure();
          questions.push(decoded);
        }
        const after = await enumerate(setId, url, deadline);
        if (!after || after.length !== numbers.length ||
            after.some((number, index) => number !== numbers[index]))
          return browserFailure();
        return { ok: true, value: questions };
      } catch {
        return browserFailure();
      }
    },
  };
}

function decodeInspectedQuestion(
  value: unknown, number: number,
): BlooketQuestionRead | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join() !== "ok,value" ||
      !("ok" in value) || value.ok !== true || !("value" in value))
    return undefined;
  const decoded = decodeBlooketQuestionRead(value.value);
  return decoded.ok && decoded.value.number === number
    ? decoded.value : undefined;
}

function browserFailure(): ExtensionQuestionInspectionResult {
  return { ok: false, code: "blooket-browser-failed" };
}
