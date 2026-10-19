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
//   - Fresh, read-only question inspection in a temporary background tab.
// - Must-Not:
//   - Navigate the teacher tab, retry writes, or adopt stale page content.
// - Allows:
//   - Inputs: An exact target set, bounded deadline and owned Chrome port.
//   - Outputs: Verified question reads or a conservative browser failure.
//   - Side effects: Create and close only its own temporary browser tab.
// - Split-When:
//   - Detached reads for other provider routes require separate mechanics.
// - Merge-When:
//   - The provider supplies a stable, non-navigating read capability.
// - Summary:
//   - Keeps attempted question forms untouched during fresh verification.
// - Description:
//   - An unowned page, changed document or failed cleanup cannot confirm.
// - Usage:
//   - Invoke only for an exact submitted owner verified by the worker.
// - Defaults:
//   - No source-tab changes, background focus or remote mutations.
//
import { createExtensionQuestionInspectionHost } from
  "./question-inspection-host.ts";
import { inspectBlooketDocumentOrigin } from
  "../../../platforms/blooket-browser/adapter-outbound/document-page.ts";
import { inspectBlooketPage } from
  "../../../platforms/blooket-browser/adapter-outbound/page.ts";
import { snapshotExactDenseArray } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";
import { classifyBlooketReadTabLoad,
  exactCreatedBlooketReadTabId } from "./read-navigation.ts";

interface Tab {
  readonly id?: number;
  readonly url?: string;
  readonly pendingUrl?: string;
  readonly status?: string;
}

export interface DetachedQuestionReadChromePort {
  readonly tabs: {
    create(options: { readonly url: string; readonly active: false }):
      Promise<Tab>;
    get(id: number): Promise<Tab>;
    remove(id: number): Promise<void>;
  };
  readonly scripting: {
    executeScript(options: {
      readonly target: { readonly tabId: number };
      readonly func: (...args: never[]) => unknown;
      readonly args?: unknown[];
    }): Promise<readonly { readonly result?: unknown }[]>;
  };
}

export type DetachedQuestionReadResult =
  | { readonly ok: true; readonly value: readonly unknown[] }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

const failed = (): DetachedQuestionReadResult =>
  ({ ok: false, code: "blooket-browser-failed" });

export async function inspectDetachedBlooketQuestions(
  chrome: DetachedQuestionReadChromePort,
  setId: string,
  deadline: number,
  pause: (ms: number) => Promise<void>,
  now: () => number = Date.now,
): Promise<DetachedQuestionReadResult> {
  if (!setId || setId.length > 512 || /[\x00-\x1f\x7f]/u.test(setId) ||
      !Number.isFinite(deadline) || now() >= deadline)
    return failed();
  const target = "https://dashboard.blooket.com/edit?id=" +
    encodeURIComponent(setId);
  let createdId: number | undefined;
  let answer: DetachedQuestionReadResult = failed();
  let closed = false;
  try {
    const created = await chrome.tabs.create({ url: target, active: false });
    createdId = exactCreatedBlooketReadTabId(created);
    if (createdId === undefined) return failed();
    // A newly opened background tab can still be hydrating after Chrome
    // reports complete. The existing reader owns further bounded retries.
    let loaded = false;
    for (let attempt = 0; attempt < 40 && now() < deadline; attempt++) {
      const tab = await chrome.tabs.get(createdId!);
      const load = classifyBlooketReadTabLoad(tab, target);
      if (load === "changed") return failed();
      if (load === "ready") { loaded = true; break; }
      await pause(100);
    }
    if (!loaded || now() >= deadline) return failed();
    const script = async (
      func: (...args: never[]) => unknown, args: unknown[],
    ): Promise<unknown> => {
      const replies = await chrome.scripting.executeScript({
        target: { tabId: createdId! }, func, args,
      });
      const frames = snapshotExactDenseArray(replies, 1);
      const frame = frames?.length === 1 ? frames[0] : undefined;
      if (!frame || typeof frame !== "object")
        throw Error("detached-question-read-unavailable");
      const frameId = Object.getOwnPropertyDescriptor(frame, "frameId");
      if (frameId && (!frameId.enumerable ||
          !("value" in frameId) || frameId.value !== 0))
        throw Error("detached-question-read-unavailable");
      const data = Object.getOwnPropertyDescriptor(frame, "result");
      if (!data || !data.enumerable || !("value" in data))
        throw Error("detached-question-read-unavailable");
      return data.value;
    };
    const origin = await script(
      inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
      [target],
    );
    if (typeof origin !== "number" || !Number.isFinite(origin) ||
        origin <= 0 || now() >= deadline) return failed();
    // Chrome's complete document can precede React's authenticated Edit
    // shell. Poll only a precise transitional page within the same native
    // document. Login, challenges and malformed replies stop immediately.
    let ready = false;
    for (let attempt = 0; attempt < 40 && now() < deadline; attempt++) {
      const tab = await chrome.tabs.get(createdId!);
      if (tab.url !== target || tab.status !== "complete" ||
          tab.pendingUrl !== undefined ||
          await script(inspectBlooketDocumentOrigin as
            (...args: never[]) => unknown, [target]) !== origin)
        return failed();
      const state = await script(
        inspectBlooketPage as (...args: never[]) => unknown,
        [{ kind: "session.observe" }],
      );
      if (!state || typeof state !== "object" || Array.isArray(state) ||
          Reflect.ownKeys(state).length !== 2) return failed();
      const admitted = Object.getOwnPropertyDescriptor(state, "ok");
      if (!admitted || !admitted.enumerable ||
          !("value" in admitted) || admitted.value !== true)
        return failed();
      const status = Object.getOwnPropertyDescriptor(state, "value");
      if (!status || !status.enumerable || !("value" in status))
        return failed();
      const afterTab = await chrome.tabs.get(createdId!);
      if (afterTab.url !== target || afterTab.status !== "complete" ||
          afterTab.pendingUrl !== undefined ||
          await script(inspectBlooketDocumentOrigin as
            (...args: never[]) => unknown, [target]) !== origin)
        return failed();
      if (status.value === "edit") { ready = true; break; }
      if (status.value !== "unexpected-page") return failed();
      await pause(100);
    }
    if (!ready || now() >= deadline) return failed();
    const host = createExtensionQuestionInspectionHost(
      chrome, createdId!, pause, now,
    );
    answer = await host.inspect(setId, deadline, origin);
    if (!answer.ok || now() >= deadline) return failed();
    // A challenge can replace React's Edit shell in the same native document
    // after all cards were read. Never certify a stale page just because its
    // URL and performance.timeOrigin have not changed.
    const afterReadState = await script(
      inspectBlooketPage as (...args: never[]) => unknown,
      [{ kind: "session.observe" }],
    );
    if (!afterReadState || typeof afterReadState !== "object" ||
        Array.isArray(afterReadState) ||
        Reflect.ownKeys(afterReadState).length !== 2) return failed();
    const admittedFinal = Object.getOwnPropertyDescriptor(
      afterReadState, "ok",
    );
    if (!admittedFinal || !admittedFinal.enumerable ||
        !("value" in admittedFinal) || admittedFinal.value !== true)
      return failed();
    const finalStatus = Object.getOwnPropertyDescriptor(
      afterReadState, "value",
    );
    if (!finalStatus || !finalStatus.enumerable ||
        !("value" in finalStatus) || finalStatus.value !== "edit")
      return failed();
    const check = await chrome.tabs.get(createdId!);
    const finalOrigin = await script(
      inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
      [target],
    );
    if (check.status !== "complete" || check.url !== target ||
        check.pendingUrl !== undefined ||
        finalOrigin !== origin || now() >= deadline) return failed();
  } catch { return failed(); }
  finally {
    if (createdId !== undefined) {
      try {
        await chrome.tabs.remove(createdId);
        closed = true;
      } catch { /* A leaked temporary tab cannot confirm a read. */ }
    }
  }
  return closed ? answer : failed();
}
