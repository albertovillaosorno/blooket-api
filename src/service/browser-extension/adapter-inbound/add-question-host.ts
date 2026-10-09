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
//   - Chrome mechanics for one observed Add Question mutation.
// - Must-Not:
//   - Expose bytes, choose paths, retry submit, or infer success.
// - Allows:
//   - Inputs: One dedicated tab, exact semantics, and admitted prepared bytes.
//   - Outputs: Confirmed read-back success or explicit navigation/browser stop.
//   - Side effects: Navigate, open modal, submit once, inspect and close panel.
// - Split-When:
//   - Another media family requires independent host mechanics.
// - Merge-When:
//   - Browser worker directly owns all guarded question-write orchestration.
// - Summary:
//   - Confirms Add Question only through exact post-submit question read-back.
// - Description:
//   - Failure after submit remains ambiguous for persisted reconciliation.
// - Usage:
//   - Invoke only behind an admitted internal browser bridge command.
// - Defaults:
//   - Navigation drift, malformed scripts, or cleanup failure fail closed.
//
import { BLOOKET_NAVIGATION_STATE_KINDS } from
  "../../../ir/blooket-navigation/domain/navigation-state.ts";
import { blooketPreparedImageBytes } from
  "../../../ir/blooket-browser-bridge/contract/prepared-image.ts";
import { decodeBlooketBrowserBridgeRequest } from
  "../../../ir/blooket-browser-bridge/contract/message.ts";
import { inspectOpenedBlooketQuestionImage } from
  "../../../platforms/blooket-browser/adapter-outbound/question-image-page.ts";
import { decodeBlooketQuestionRead, type BlooketQuestionRead } from
  "../../../ir/blooket-question-reads/contract/question-read.ts";
import {
  runBlooketAddQuestionPageAction,
  type BlooketTextQuestionPageInput,
} from
  "../../../platforms/blooket-browser/adapter-outbound/add-question-page.ts";
import { inspectBlooketPage } from
  "../../../platforms/blooket-browser/adapter-outbound/page.ts";
import { canLeaveBlooketPageForRead } from
  "../../../platforms/blooket-browser/adapter-outbound/capability-page.ts";
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

export interface AddQuestionChromePort {
  readonly tabs: {
    get(tabId: number): Promise<BrowserTab>;
    update(
      tabId: number,
      options: { readonly url: string },
    ): Promise<BrowserTab>;
  };
  readonly scripting: {
    executeScript(options: {
      readonly target: { readonly tabId: number };
      readonly func: (...args: never[]) => unknown;
      readonly args?: unknown[];
    }): Promise<readonly { readonly result?: unknown }[]>;
  };
}

export type ExtensionAddQuestionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: "navigation";
      readonly state:
        | "signed-out"
        | "organization-prompt"
        | "expired-session"
        | "rate-limited"
        | "security-challenge"
        | "unexpected-page";
    }
  | {
      readonly ok: false;
      readonly kind: "browser";
      readonly code: "blooket-browser-failed";
    };

const DASHBOARD_ORIGIN = "https://dashboard.blooket.com";
const MAX_POLLS = 50;
const POLL_MS = 100;
const OBSERVED_STATES: ReadonlySet<string> = new Set(
  BLOOKET_NAVIGATION_STATE_KINDS.filter(
    (state) =>
      state !== "authenticating" &&
      state !== "authenticated" &&
      state !== "human-action-required",
  ),
);

export function createExtensionAddQuestionHost(
  chrome: AddQuestionChromePort,
  tabId: number,
  pause: (ms: number) => Promise<void> = async (ms) =>
    await new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const script = async (
    func: (...args: never[]) => unknown,
    args: unknown[] = [],
  ): Promise<unknown> => {
    const replies = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
    });
    if (replies.length !== 1 || replies[0]?.result === undefined)
      throw new Error("browser-write-script-failed");
    return replies[0].result;
  };

  return {
    addQuestion: async (
      candidate: BlooketTextQuestionPageInput,
    ): Promise<ExtensionAddQuestionResult> => {
      try {
        const decoded = decodeBlooketBrowserBridgeRequest({
          schemaVersion: 1,
          id: "00000000-0000-0000-0000-000000000000",
          command: { ...candidate, kind: "questions.create" },
        });
        if (!decoded.ok || decoded.value.command.kind !== "questions.create")
          return browserFailure();
        const input = decoded.value.command;
        let imageIdentity: { byteLength: number; sha256: string } | undefined;
        if (input.image) {
          const bytes = blooketPreparedImageBytes(input.image);
          if (!bytes) return browserFailure();
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          imageIdentity = {
            byteLength: bytes.length,
            sha256: Array.from(new Uint8Array(digest))
              .map(byte => byte.toString(16).padStart(2, "0")).join(""),
          };
        }
        const editUrl = DASHBOARD_ORIGIN + "/edit?id=" +
          encodeURIComponent(input.setId);
        const before = await chrome.tabs.get(tabId);
        if (!dashboardTab(before) || before.status !== "complete")
          return browserFailure();
        // Do not replace a route the teacher selected after the first tab
        // observation. Reaching the correct edit page needs no second update.
        const current = await chrome.tabs.get(tabId);
        if (current.status !== "complete" || current.url !== before.url)
          return browserFailure();
        if (current.url !== editUrl) {
          // A write may navigate from My Sets or another dashboard view.
          // Never discard an existing teacher editor to reach its target.
          const canLeave = await script(
            canLeaveBlooketPageForRead as (...args: never[]) => unknown,
          );
          if (canLeave !== true) return browserFailure();
          const afterGuard = await chrome.tabs.get(tabId);
          if (afterGuard.status !== "complete" ||
              afterGuard.url !== current.url) return browserFailure();
          await chrome.tabs.update(tabId, { url: editUrl });
        }

        const ready = await waitForEdit(
          script, chrome, tabId, editUrl, pause,
        );
        if (!ready.ok) return ready;

        // An acknowledged injected function may finish on a different route.
        // Confirm ownership around *every* subsequent browser interaction.
        const ownedScript: Script = async (func, args) => {
          const beforeScript = await chrome.tabs.get(tabId);
          if (beforeScript.status !== "complete" ||
              beforeScript.url !== editUrl)
            throw new Error("browser-write-tab-changed");
          const result = await script(func, args);
          const afterScript = await chrome.tabs.get(tabId);
          if (afterScript.status !== "complete" ||
              afterScript.url !== editUrl)
            throw new Error("browser-write-tab-changed");
          return result;
        };
        // Recheck the target editor before taking control of an Add Question
        // modal. A manual Edit Info or question form may already be open.
        const safeToOpen = await ownedScript(
          canLeaveBlooketPageForRead as (...args: never[]) => unknown,
        );
        if (safeToOpen !== true) return browserFailure();
        const opened = await ownedScript(
          runBlooketAddQuestionPageAction as (...args: never[]) => unknown,
          [input.image ? "open-image" : "open", input.setId],
        );
        if (opened !== true) return browserFailure();

        let panelReady = false;
        for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
          const result = await ownedScript(
            runBlooketAddQuestionPageAction as (...args: never[]) => unknown,
            ["is-ready", input.setId],
          );
          if (result === true) {
            panelReady = true;
            break;
          }
          await pause(POLL_MS);
        }
        if (!panelReady) return browserFailure();

        const prepared = await ownedScript(
          runBlooketAddQuestionPageAction as (...args: never[]) => unknown,
          ["prepare", input],
        );
        if (!exactOk(prepared)) {
          if (input.image) await ownedScript(
            runBlooketAddQuestionPageAction as (...args: never[]) => unknown,
            ["cancel-image", input.setId],
          ).catch(() => undefined);
          return browserFailure();
        }

        if (input.image) {
          // Provider media state settles asynchronously after the file change.
          // Do not submit until its owned hidden field and preview agree.
          let imageReady = false;
          for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
            const result = await ownedScript(
              runBlooketAddQuestionPageAction as (...args: never[]) => unknown,
              ["is-image-ready", input.setId],
            );
            if (result === true) { imageReady = true; break; }
            await pause(POLL_MS);
          }
          const finalized = imageReady ? await ownedScript(
            runBlooketAddQuestionPageAction as (...args: never[]) => unknown,
            ["finalize-image", input],
          ) : undefined;
          if (!exactOk(finalized)) {
            await ownedScript(
              runBlooketAddQuestionPageAction as (...args: never[]) => unknown,
              ["cancel-image", input.setId],
            ).catch(() => undefined);
            return browserFailure();
          }
        }

        const submittedResult = await ownedScript(
          runBlooketAddQuestionPageAction as (...args: never[]) => unknown,
          ["submit", input],
        );
        if (!exactOk(submittedResult)) return browserFailure();
        return await observeQuestion(
          input,
          ownedScript,
          chrome,
          tabId,
          pause,
          imageIdentity,
        );
      } catch {
        return browserFailure();
      }
    },
  };
}

async function waitForEdit(
  script: Script,
  chrome: AddQuestionChromePort,
  tabId: number,
  editUrl: string,
  pause: (ms: number) => Promise<void>,
): Promise<ExtensionAddQuestionResult> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      if (tab.url !== editUrl) return browserFailure();
      const observed = await observe(script);
      const after = await chrome.tabs.get(tabId);
      if (after.status !== "complete" || after.url !== editUrl)
        return browserFailure();
      if (observed === "edit") return { ok: true };
      if (observed !== undefined)
        return navigationFailure(normalizeUnexpected(observed));
    }
    await pause(POLL_MS);
  }
  return browserFailure();
}

async function observeQuestion(
  input: BlooketTextQuestionPageInput,
  script: Script,
  chrome: AddQuestionChromePort,
  tabId: number,
  pause: (ms: number) => Promise<void>,
  imageIdentity?: { readonly byteLength: number; readonly sha256: string },
): Promise<ExtensionAddQuestionResult> {
  const editUrl = DASHBOARD_ORIGIN + "/edit?id=" +
    encodeURIComponent(input.setId);
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url !== editUrl) return browserFailure();
    if (tab.status !== "complete") {
      await pause(POLL_MS);
      continue;
    }
    const observed = await observe(script);
    if (observed !== "edit") {
      if (observed !== undefined)
        return navigationFailure(normalizeUnexpected(observed));
      await pause(POLL_MS);
      continue;
    }

    const panel = await script(
      runBlooketAddQuestionPageAction as (...args: never[]) => unknown,
      ["is-ready", input.setId],
    );
    if (panel === true) {
      await pause(POLL_MS);
      continue;
    }

    const listed = await script(
      listBlooketQuestionNumbers as (...args: never[]) => unknown,
      [input.setId],
    );
    if (!questionNumberPresent(listed, input.number)) {
      await pause(POLL_MS);
      continue;
    }

    const opened = await script(
      openBlooketQuestionPanel as (...args: never[]) => unknown,
      [input.setId, input.number],
    );
    if (opened !== true) return browserFailure();

    let confirmed = false;
    try {
      for (let readAttempt = 0; readAttempt < 15; readAttempt++) {
        const inspected = await script(
          inspectOpenedBlooketQuestion as (...args: never[]) => unknown,
          [input.setId, input.number],
        );
        // Only the exact page-not-ready reply permits another read.
        // Inconsistent successful data cannot become a receipt later.
        if (pageUnavailable(inspected)) {
          await pause(POLL_MS);
          continue;
        }
        const first = matchingQuestion(inspected, input);
        if (first) {
          // A hydrated question may change even with an unchanged row number.
          await pause(0);
          const again = await script(
            inspectOpenedBlooketQuestion as (...args: never[]) => unknown,
            [input.setId, input.number],
          );
          const second = matchingQuestion(again, input);
          confirmed = !!second &&
            JSON.stringify(first) === JSON.stringify(second);
          if (confirmed && imageIdentity) {
            const image = await script(
              inspectOpenedBlooketQuestionImage as
                (...args: never[]) => unknown,
              [input.setId, input.number, 5_000],
            );
            confirmed = imageMatches(image, imageIdentity);
            if (confirmed) {
              const final = matchingQuestion(await script(
                inspectOpenedBlooketQuestion as (...args: never[]) => unknown,
                [input.setId, input.number],
              ), input);
              confirmed = !!final &&
                JSON.stringify(first) === JSON.stringify(final);
            }
          }
        }
        break;
      }
    } catch {
      // Best-effort Cancel remains necessary after an uncertain read.
    }
    const closed = await script(
      closeBlooketQuestionPanel as (...args: never[]) => unknown,
      [input.setId],
    ).catch(() => false);
    if (closed !== true) return browserFailure();
    for (let closeAttempt = 0; closeAttempt < 15; closeAttempt++) {
      const isClosed = await script(
        isBlooketQuestionPanelClosed as (...args: never[]) => unknown,
        [input.setId],
      ).catch(() => false);
      if (isClosed === true)
        return confirmed ? { ok: true } : browserFailure();
      if (isClosed !== false) return browserFailure();
      await pause(POLL_MS);
    }
    return browserFailure();
  }
  return browserFailure();
}

type Script = (
  func: (...args: never[]) => unknown,
  args?: unknown[],
) => Promise<unknown>;

async function observe(script: Script): Promise<string | undefined> {
  const result = await script(
    inspectBlooketPage as (...args: never[]) => unknown,
    [{ kind: "session.observe" }],
  );
  if (
    !result ||
    typeof result !== "object" ||
    !("ok" in result) ||
    result.ok !== true ||
    !("value" in result) ||
    typeof result.value !== "string" ||
    !OBSERVED_STATES.has(result.value)
  )
    return undefined;
  return result.value;
}

function matchingQuestion(
  result: unknown,
  input: BlooketTextQuestionPageInput,
): BlooketQuestionRead | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      Object.keys(result).sort().join() !== "ok,value" ||
      !("ok" in result) || result.ok !== true ||
      !("value" in result)) return undefined;
  const decoded = decodeBlooketQuestionRead(result.value);
  if (!decoded.ok) return undefined;
  const value = decoded.value;
  const answers = input.answers.map((answer, index) => ({
    kind: "text",
    content: answer.text,
    correct: answer.correct,
    match: input.answerTypes?.[index] ?? null,
  }));
  return value.number === input.number &&
    value.question === input.question &&
    value.equation === null &&
    value.qType === input.qType &&
    value.random === input.random &&
    value.timeLimit === input.timeLimit &&
    JSON.stringify(value.answers) === JSON.stringify(answers) &&
    value.hasImage === (input.image !== undefined) && value.hasAudio === false
    ? value : undefined;
}

function imageMatches(
  result: unknown,
  expected: { readonly byteLength: number; readonly sha256: string },
): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      Object.keys(result).sort().join() !== "ok,value" ||
      !("ok" in result) || result.ok !== true || !("value" in result) ||
      !result.value || typeof result.value !== "object" ||
      Array.isArray(result.value) ||
      Object.keys(result.value).sort().join() !== "byteLength,sha256")
    return false;
  return "byteLength" in result.value && "sha256" in result.value &&
    result.value.byteLength === expected.byteLength &&
    result.value.sha256 === expected.sha256;
}

function pageUnavailable(result: unknown): boolean {
  return !!result && typeof result === "object" &&
    !Array.isArray(result) &&
    Object.keys(result).sort().join() === "code,ok" &&
    "ok" in result && result.ok === false &&
    "code" in result && result.code === "blooket-browser-failed";
}

function questionNumberPresent(result: unknown, number: number): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      Object.keys(result).sort().join() !== "ok,value" ||
      !("ok" in result) || result.ok !== true ||
      !("value" in result) || !Array.isArray(result.value) ||
      result.value.length > 200) return false;
  const seen = new Set<number>();
  for (const value of result.value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10_000 ||
        seen.has(value)) return false;
    seen.add(value);
  }
  return seen.has(number);
}

function exactOk(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    "ok" in value &&
    value.ok === true
  );
}

function dashboardTab(tab: BrowserTab): boolean {
  if (!tab.url) return false;
  try {
    return new URL(tab.url).origin === DASHBOARD_ORIGIN;
  } catch {
    return false;
  }
}

function normalizeUnexpected(
  state: string,
):
  | "signed-out"
  | "organization-prompt"
  | "expired-session"
  | "rate-limited"
  | "security-challenge"
  | "unexpected-page" {
  if (
    state === "signed-out" ||
    state === "organization-prompt" ||
    state === "expired-session" ||
    state === "rate-limited" ||
    state === "security-challenge"
  )
    return state;
  return "unexpected-page";
}

function navigationFailure(
  state: ReturnType<typeof normalizeUnexpected>,
): ExtensionAddQuestionResult {
  return { ok: false, kind: "navigation", state };
}

function browserFailure(): ExtensionAddQuestionResult {
  return {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  };
}
