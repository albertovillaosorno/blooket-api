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
//   - Chrome mechanics for one observed text-only Add Question mutation.
// - Must-Not:
//   - Expose bridge commands, upload media, retry submit, or infer success.
// - Allows:
//   - Inputs: One dedicated tab and exact text-question form semantics.
//   - Outputs: Confirmed read-back success or explicit navigation/browser stop.
//   - Side effects: Navigate, open modal, submit once, inspect and close panel.
// - Split-When:
//   - Media-backed questions require independent host mechanics.
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
import {
  isBlooketAddQuestionPanelReady,
  openBlooketAddQuestionPanel,
  prepareBlooketAddQuestionForm,
  submitBlooketAddQuestionForm,
  type BlooketTextQuestionPageInput,
} from
  "../../../platforms/blooket-browser/adapter-outbound/add-question-page.ts";
import { inspectBlooketPage } from
  "../../../platforms/blooket-browser/adapter-outbound/page.ts";
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
      input: BlooketTextQuestionPageInput,
    ): Promise<ExtensionAddQuestionResult> => {
      try {
        const before = await chrome.tabs.get(tabId);
        if (!dashboardTab(before)) return browserFailure();
        await chrome.tabs.update(tabId, {
          url: DASHBOARD_ORIGIN + "/edit?id=" + encodeURIComponent(input.setId),
        });

        const ready = await waitForEdit(script, chrome, tabId, pause);
        if (!ready.ok) return ready;

        const opened = await script(
          openBlooketAddQuestionPanel as (...args: never[]) => unknown,
          [input.setId],
        );
        if (opened !== true) return browserFailure();

        let panelReady = false;
        for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
          const result = await script(
            isBlooketAddQuestionPanelReady as (...args: never[]) => unknown,
            [input.setId],
          );
          if (result === true) {
            panelReady = true;
            break;
          }
          await pause(POLL_MS);
        }
        if (!panelReady) return browserFailure();

        const prepared = await script(
          prepareBlooketAddQuestionForm as (...args: never[]) => unknown,
          [input],
        );
        if (!exactOk(prepared)) return browserFailure();

        const submittedResult = await script(
          submitBlooketAddQuestionForm as (...args: never[]) => unknown,
          [input],
        );
        if (!exactOk(submittedResult)) return browserFailure();
        return await observeQuestion(
          input,
          script,
          chrome,
          tabId,
          pause,
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
  pause: (ms: number) => Promise<void>,
): Promise<ExtensionAddQuestionResult> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      const observed = await observe(script);
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
): Promise<ExtensionAddQuestionResult> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const tab = await chrome.tabs.get(tabId);
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
      isBlooketAddQuestionPanelReady as (...args: never[]) => unknown,
      [input.setId],
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
      [input.number],
    );
    if (opened !== true) return browserFailure();

    let inspected: unknown;
    for (let readAttempt = 0; readAttempt < 15; readAttempt++) {
      inspected = await script(
        inspectOpenedBlooketQuestion as (...args: never[]) => unknown,
        [input.number],
      );
      if (matchesQuestion(inspected, input)) break;
      await pause(POLL_MS);
    }
    if (!matchesQuestion(inspected, input)) return browserFailure();

    const closed = await script(
      closeBlooketQuestionPanel as (...args: never[]) => unknown,
    );
    if (closed !== true) return browserFailure();
    for (let closeAttempt = 0; closeAttempt < 15; closeAttempt++) {
      const isClosed = await script(
        isBlooketQuestionPanelClosed as (...args: never[]) => unknown,
      );
      if (isClosed === true) return { ok: true };
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

function matchesQuestion(
  result: unknown,
  input: BlooketTextQuestionPageInput,
): boolean {
  if (
    !result ||
    typeof result !== "object" ||
    !("ok" in result) ||
    result.ok !== true ||
    !("value" in result) ||
    !result.value ||
    typeof result.value !== "object"
  )
    return false;
  const value = result.value as Record<string, unknown>;
  const answers = input.answers.map((answer) => answer.text);
  const correctAnswers = input.answers
    .filter((answer) => answer.correct)
    .map((answer) => answer.text);
  return (
    value["schemaVersion"] === 1 &&
    value["number"] === input.number &&
    value["question"] === input.question &&
    value["qType"] === input.qType &&
    value["random"] === input.random &&
    value["timeLimit"] === input.timeLimit &&
    JSON.stringify(value["answers"]) === JSON.stringify(answers) &&
    JSON.stringify(value["correctAnswers"]) ===
      JSON.stringify(correctAnswers) &&
    JSON.stringify(value["answerTypes"]) ===
      JSON.stringify(input.answerTypes) &&
    value["hasImage"] === false &&
    value["hasAudio"] === false
  );
}

function questionNumberPresent(result: unknown, number: number): boolean {
  if (
    !result ||
    typeof result !== "object" ||
    !("ok" in result) ||
    result.ok !== true ||
    !("value" in result) ||
    !Array.isArray(result.value)
  )
    return false;
  return result.value.filter((value) => value === number).length === 1;
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
