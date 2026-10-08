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
//   - Chrome orchestration for one non-mutating Blooket capability inspection.
// - Must-Not:
//   - Submit forms, create sets, upload media, retain IDs, or expose account
//     data.
// - Allows:
//   - Inputs: One dedicated authenticated Blooket tab and Chrome subset.
//   - Outputs: One untrusted capability snapshot candidate or stable failure.
//   - Side effects: Navigate, open/cancel capability UI, then restore prior
//     URL.
// - Split-When:
//   - Safari capability inspection requires materially different mechanics.
// - Merge-When:
//   - Browser capability inspection no longer crosses extension orchestration.
// - Summary:
//   - Resolves the shared Plus media gate only when an existing set exists.
// - Description:
//   - Empty accounts stay account-dependent and never create probe content.
// - Usage:
//   - Invoke only for the admitted capabilities.inspect bridge command.
// - Defaults:
//   - Cleanup, navigation, or malformed page evidence fails closed.
//
import {
  blooketCapabilitySnapshotCandidate,
  closeBlooketAudioCapabilityDrawer,
  closeBlooketCapabilityQuestionPanel,
  inspectBlooketAudioCapabilityDrawer,
  isBlooketAudioCapabilityDrawerClosed,
  isBlooketCapabilityQuestionPanelClosed,
  isBlooketCapabilityQuestionPanelReady,
  openBlooketAudioCapabilityDrawer,
  openBlooketCapabilityQuestionPanel,
  type BlooketAccountMediaAvailability,
} from
  "../../../platforms/blooket-browser/adapter-outbound/capability-page.ts";
import { inspectBlooketPage } from
  "../../../platforms/blooket-browser/adapter-outbound/page.ts";

interface BrowserTab {
  readonly url?: string;
  readonly status?: string;
}

export interface CapabilityInspectionChromePort {
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

export type ExtensionCapabilityInspectionResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly code:
        | "blooket-browser-unavailable"
        | "blooket-browser-failed";
    };

const DASHBOARD_ORIGIN = "https://dashboard.blooket.com";
const MY_SETS_URL = DASHBOARD_ORIGIN + "/my-sets";
const MAX_POLLS = 50;
const POLL_MS = 100;

export function createExtensionCapabilityInspectionHost(
  chrome: CapabilityInspectionChromePort,
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
      throw new Error("browser-capability-script-failed");
    return replies[0].result;
  };

  return {
    inspect: async (): Promise<ExtensionCapabilityInspectionResult> => {
      let originalUrl: string | undefined;
      let setId: string | undefined;
      let panelOpened = false;
      let drawerOpened = false;
      let outcome: ExtensionCapabilityInspectionResult = browserFailure();
      try {
        const before = await chrome.tabs.get(tabId);
        if (!dashboardTab(before)) return browserFailure();
        originalUrl = before.url;

        if (!await navigate(chrome, tabId, MY_SETS_URL, pause))
          return browserFailure();
        const observed = await script(
          inspectBlooketPage as (...args: never[]) => unknown,
          [{ kind: "session.observe" }],
        );
        if (!exactObservedState(observed, "my-sets")) return browserFailure();
        const listed = await script(
          inspectBlooketPage as (...args: never[]) => unknown,
          [{ kind: "sets.list" }],
        );
        const selected = firstSetId(listed);
        if (selected === undefined) return browserFailure();

        let accountMedia: BlooketAccountMediaAvailability = "account-dependent";
        if (selected !== null) {
          setId = selected;
          const editUrl = DASHBOARD_ORIGIN + "/edit?id=" +
            encodeURIComponent(setId);
          if (!await navigate(chrome, tabId, editUrl, pause))
            return browserFailure();
          const editState = await script(
            inspectBlooketPage as (...args: never[]) => unknown,
            [{ kind: "session.observe" }],
          );
          if (!exactObservedState(editState, "edit")) return browserFailure();

          const opened = await script(
            openBlooketCapabilityQuestionPanel as (...args: never[]) => unknown,
            [setId],
          );
          if (opened !== true) return browserFailure();
          panelOpened = true;
          if (!await pollTrue(
            script,
            isBlooketCapabilityQuestionPanelReady,
            [setId],
            pause,
          ))
            return browserFailure();

          const drawer = await script(
            openBlooketAudioCapabilityDrawer as (...args: never[]) => unknown,
            [setId],
          );
          if (drawer !== true) return browserFailure();
          drawerOpened = true;
          const inspected = await pollCapability(script, setId, pause);
          if (inspected === undefined) return browserFailure();
          accountMedia = inspected;
        }

        outcome = {
          ok: true,
          value: blooketCapabilitySnapshotCandidate(
            new Date().toISOString().slice(0, 10),
            accountMedia,
          ),
        };
      } catch {
        outcome = browserFailure();
      } finally {
        if (setId !== undefined && drawerOpened) {
          const cleaned = await closeDrawer(script, setId, pause);
          if (!cleaned) outcome = browserFailure();
        }
        if (setId !== undefined && panelOpened) {
          const cleaned = await closeQuestionPanel(script, setId, pause);
          if (!cleaned) outcome = browserFailure();
        }
        if (originalUrl !== undefined) {
          const restored = await restore(
            chrome,
            tabId,
            originalUrl,
            pause,
          ).catch(() => false);
          if (!restored) outcome = browserFailure();
        }
      }
      return outcome;
    },
  };
}

async function navigate(
  chrome: CapabilityInspectionChromePort,
  tabId: number,
  url: string,
  pause: (ms: number) => Promise<void>,
): Promise<boolean> {
  const current = await chrome.tabs.get(tabId);
  if (current.url !== url) await chrome.tabs.update(tabId, { url });
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && tab.url === url) return true;
    await pause(POLL_MS);
  }
  return false;
}

async function restore(
  chrome: CapabilityInspectionChromePort,
  tabId: number,
  url: string,
  pause: (ms: number) => Promise<void>,
): Promise<boolean> {
  if (new URL(url).origin !== DASHBOARD_ORIGIN) return false;
  return await navigate(chrome, tabId, url, pause);
}

async function pollTrue(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  func: (...args: never[]) => unknown,
  args: unknown[],
  pause: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 15; attempt++) {
    if (await script(func, args) === true) return true;
    await pause(POLL_MS);
  }
  return false;
}

async function pollCapability(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  setId: string,
  pause: (ms: number) => Promise<void>,
): Promise<"supported" | "unsupported" | undefined> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const result = await script(
      inspectBlooketAudioCapabilityDrawer as (...args: never[]) => unknown,
      [setId],
    );
    if (
      result &&
      typeof result === "object" &&
      Object.keys(result).sort().join() === "ok,value" &&
      "ok" in result &&
      result.ok === true &&
      "value" in result &&
      (result.value === "supported" || result.value === "unsupported")
    )
      return result.value;
    await pause(POLL_MS);
  }
  return undefined;
}

async function closeDrawer(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  setId: string,
  pause: (ms: number) => Promise<void>,
): Promise<boolean> {
  const alreadyClosed = await script(
    isBlooketAudioCapabilityDrawerClosed as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (alreadyClosed === true) return true;
  const closed = await script(
    closeBlooketAudioCapabilityDrawer as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (closed !== true) return false;
  return await pollTrue(
    script,
    isBlooketAudioCapabilityDrawerClosed,
    [setId],
    pause,
  ).catch(() => false);
}

async function closeQuestionPanel(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  setId: string,
  pause: (ms: number) => Promise<void>,
): Promise<boolean> {
  const alreadyClosed = await script(
    isBlooketCapabilityQuestionPanelClosed as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (alreadyClosed === true) return true;
  const closed = await script(
    closeBlooketCapabilityQuestionPanel as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (closed !== true) return false;
  return await pollTrue(
    script,
    isBlooketCapabilityQuestionPanelClosed,
    [setId],
    pause,
  ).catch(() => false);
}

function firstSetId(value: unknown): string | null | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("ok" in value) ||
    value.ok !== true ||
    !("value" in value) ||
    !value.value ||
    typeof value.value !== "object" ||
    Array.isArray(value.value) ||
    Object.keys(value.value).sort().join() !== "completeness,items" ||
    !("items" in value.value) ||
    !Array.isArray(value.value.items) ||
    value.value.items.length > 200 ||
    !("completeness" in value.value) ||
    (value.value.completeness !== "complete" &&
      value.value.completeness !== "unknown") ||
    (value.value.completeness === "complete" &&
      value.value.items.length !== 0)
  )
    return undefined;
  let first: string | null = null;
  for (const item of value.value.items) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      return undefined;
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).sort().join() !== "id,schemaVersion,title" ||
      record["schemaVersion"] !== 1 ||
      typeof record["id"] !== "string" ||
      record["id"].length < 1 ||
      record["id"].length > 512 ||
      record["id"].includes("\0") ||
      typeof record["title"] !== "string" ||
      record["title"].length < 1 ||
      record["title"].length > 1_000
    )
      return undefined;
    if (first === null) first = record["id"];
  }
  return first;
}

function exactObservedState(value: unknown, state: string): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).sort().join() === "ok,value" &&
    "ok" in value &&
    value.ok === true &&
    "value" in value &&
    value.value === state
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

function browserFailure(): ExtensionCapabilityInspectionResult {
  return { ok: false, code: "blooket-browser-failed" };
}
