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
// Reserve three seconds for modal cleanup and navigation restoration.
const PROBE_BUDGET_MS = 6_000;
const TOTAL_BUDGET_MS = 9_000;

export function createExtensionCapabilityInspectionHost(
  chrome: CapabilityInspectionChromePort,
  tabId: number,
  pause: (ms: number) => Promise<void> = async (ms) =>
    await new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = Date.now,
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
      const startedAt = now();
      const probeDeadline = startedAt + PROBE_BUDGET_MS;
      const finishDeadline = startedAt + TOTAL_BUDGET_MS;
      let expectedReadUrl = MY_SETS_URL;
      const readScript = async (
        func: (...args: never[]) => unknown,
        args: unknown[] = [],
      ): Promise<unknown> => {
        if (now() >= probeDeadline)
          throw new Error("browser-capability-deadline");
        const beforeScript = await chrome.tabs.get(tabId);
        if (
          now() >= probeDeadline || beforeScript.status !== "complete" ||
          beforeScript.url !== expectedReadUrl
        ) throw new Error("browser-capability-tab-changed");
        const result = await script(func, args);
        if (now() >= probeDeadline)
          throw new Error("browser-capability-deadline");
        const afterScript = await chrome.tabs.get(tabId);
        if (
          now() >= probeDeadline || afterScript.status !== "complete" ||
          afterScript.url !== expectedReadUrl
        ) throw new Error("browser-capability-tab-changed");
        return result;
      };
      const editorReady = async (url: string): Promise<boolean> => {
        if (now() >= probeDeadline) return false;
        const tab = await chrome.tabs.get(tabId);
        return now() < probeDeadline &&
          tab.status === "complete" && tab.url === url;
      };
      let originalUrl: string | undefined;
      let setId: string | undefined;
      let panelOpened = false;
      let drawerOpened = false;
      let outcome: ExtensionCapabilityInspectionResult = browserFailure();
      try {
        const before = await chrome.tabs.get(tabId);
        if (!before.url || !dashboardTab(before)) return browserFailure();
        originalUrl = before.url;

        if (!await navigate(
          chrome, tabId, MY_SETS_URL, originalUrl, pause,
          probeDeadline, now,
        ))
          return browserFailure();
        const observed = await readScript(
          inspectBlooketPage as (...args: never[]) => unknown,
          [{ kind: "session.observe" }],
        );
        if (!exactObservedState(observed, "my-sets")) return browserFailure();
        const listed = await readScript(
          inspectBlooketPage as (...args: never[]) => unknown,
          [{ kind: "sets.list" }],
        );
        const selected = firstSetId(listed);
        if (selected === undefined) return browserFailure();
        // Compare two My Sets views before selecting a probe set or
        // accepting the recovered empty-account state.
        await pause(Math.min(POLL_MS, probeDeadline - now()));
        if (now() >= probeDeadline) return browserFailure();
        const beforeListConfirmation = await chrome.tabs.get(tabId);
        if (
          now() >= probeDeadline ||
          beforeListConfirmation.status !== "complete" ||
          beforeListConfirmation.url !== MY_SETS_URL
        ) return browserFailure();
        const listedAgain = await readScript(
          inspectBlooketPage as (...args: never[]) => unknown,
          [{ kind: "sets.list" }],
        );
        if (JSON.stringify(listed) !== JSON.stringify(listedAgain) ||
            firstSetId(listedAgain) !== selected) return browserFailure();
        const afterListConfirmation = await chrome.tabs.get(tabId);
        if (
          now() >= probeDeadline ||
          afterListConfirmation.status !== "complete" ||
          afterListConfirmation.url !== MY_SETS_URL
        ) return browserFailure();

        let accountMedia: BlooketAccountMediaAvailability = "account-dependent";
        if (selected !== null) {
          setId = selected;
          const editUrl = DASHBOARD_ORIGIN + "/edit?id=" +
            encodeURIComponent(setId);
          if (!await navigate(
            chrome, tabId, editUrl, MY_SETS_URL, pause,
            probeDeadline, now,
          ))
            return browserFailure();
          expectedReadUrl = editUrl;
          const editState = await readScript(
            inspectBlooketPage as (...args: never[]) => unknown,
            [{ kind: "session.observe" }],
          );
          if (!exactObservedState(editState, "edit")) return browserFailure();

          if (!await editorReady(editUrl)) return browserFailure();
          const opened = await script(
            openBlooketCapabilityQuestionPanel as (...args: never[]) => unknown,
            [setId],
          );
          panelOpened = opened === true;
          if (!panelOpened || !await editorReady(editUrl))
            return browserFailure();
          if (!await pollTrue(
            readScript,
            isBlooketCapabilityQuestionPanelReady,
            [setId],
            pause,
            probeDeadline,
            now,
          ))
            return browserFailure();

          if (!await editorReady(editUrl)) return browserFailure();
          const drawer = await script(
            openBlooketAudioCapabilityDrawer as (...args: never[]) => unknown,
            [setId],
          );
          drawerOpened = drawer === true;
          if (!drawerOpened || !await editorReady(editUrl))
            return browserFailure();
          const inspected = await pollCapability(
            readScript, setId, pause, probeDeadline, now,
          );
          if (inspected === undefined) return browserFailure();
          // A Plus gate can change while the Audio drawer is open. Require
          // two exact observations, without retrying a contradictory reply.
          await pause(Math.min(POLL_MS, probeDeadline - now()));
          if (now() >= probeDeadline) return browserFailure();
          const tabBeforeConfirmation = await chrome.tabs.get(tabId);
          if (
            now() >= probeDeadline ||
            tabBeforeConfirmation.status !== "complete" ||
            tabBeforeConfirmation.url !== editUrl
          ) return browserFailure();
          const again = await readScript(
            inspectBlooketAudioCapabilityDrawer as
              (...args: never[]) => unknown,
            [setId],
          );
          if (
            !again || typeof again !== "object" || Array.isArray(again) ||
            Object.keys(again).sort().join() !== "ok,value" ||
            !("ok" in again) || again.ok !== true ||
            !("value" in again) || again.value !== inspected
          ) return browserFailure();
          const tabAfterConfirmation = await chrome.tabs.get(tabId);
          if (
            now() >= probeDeadline ||
            tabAfterConfirmation.status !== "complete" ||
            tabAfterConfirmation.url !== editUrl
          ) return browserFailure();
          accountMedia = inspected;
        }

        if (now() >= probeDeadline) return browserFailure();
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
        // If the user navigated away, this probe no longer owns the editor
        // DOM and must not inject cleanup actions into their new page.
        const cleanupUrl = setId === undefined ? undefined :
          DASHBOARD_ORIGIN + "/edit?id=" + encodeURIComponent(setId);
        const tabBeforeCleanup = await chrome.tabs.get(tabId)
          .catch(() => undefined);
        const canClean = cleanupUrl !== undefined &&
          tabBeforeCleanup?.status === "complete" &&
          tabBeforeCleanup.url === cleanupUrl;
        // Chrome serializes each cleanup helper independently. The initial
        // route check does not own later scripts if the user navigates during
        // Cancel or a closure poll, so recheck around every helper.
        const cleanupScript = async (
          func: (...args: never[]) => unknown,
          args: unknown[] = [],
        ): Promise<unknown> => {
          const before = await chrome.tabs.get(tabId);
          if (before.status !== "complete" || before.url !== cleanupUrl)
            throw new Error("browser-capability-tab-changed");
          const result = await script(func, args);
          const after = await chrome.tabs.get(tabId);
          if (after.status !== "complete" || after.url !== cleanupUrl)
            throw new Error("browser-capability-tab-changed");
          return result;
        };
        if (!canClean && (panelOpened || drawerOpened))
          outcome = browserFailure();
        if (canClean && setId !== undefined && drawerOpened) {
          const cleaned = await closeDrawer(
            cleanupScript, setId, pause, finishDeadline, now,
          );
          if (!cleaned) outcome = browserFailure();
        }
        if (canClean && setId !== undefined && panelOpened) {
          const cleaned = await closeQuestionPanel(
            cleanupScript, setId, pause, finishDeadline, now,
          );
          if (!cleaned) outcome = browserFailure();
        }
        if (originalUrl !== undefined) {
          const restored = await restore(
            chrome,
            tabId,
            originalUrl,
            [MY_SETS_URL, ...(setId === undefined ? [] : [
              DASHBOARD_ORIGIN + "/edit?id=" + encodeURIComponent(setId),
            ])],
            pause,
            finishDeadline,
            now,
          ).catch(() => false);
          if (!restored) outcome = browserFailure();
        }
        if (now() >= finishDeadline) outcome = browserFailure();
      }
      return outcome;
    },
  };
}

async function navigate(
  chrome: CapabilityInspectionChromePort,
  tabId: number,
  url: string,
  allowedPreviousUrl: string,
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
): Promise<boolean> {
  if (now() >= deadline) return false;
  const current = await chrome.tabs.get(tabId);
  if (now() >= deadline ||
      (current.url !== url && current.url !== allowedPreviousUrl))
    return false;
  if (current.url !== url) await chrome.tabs.update(tabId, { url });
  for (let attempt = 0; attempt < MAX_POLLS && now() < deadline;
    attempt++) {
    const tab = await chrome.tabs.get(tabId);
    if (now() >= deadline) return false;
    if (tab.status === "complete" && tab.url === url) return true;
    await pause(Math.min(POLL_MS, deadline - now()));
  }
  return false;
}

async function restore(
  chrome: CapabilityInspectionChromePort,
  tabId: number,
  url: string,
  ownedRoutes: readonly string[],
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
): Promise<boolean> {
  if (new URL(url).origin !== DASHBOARD_ORIGIN) return false;
  // The user may have navigated the tab independently. An unfamiliar route,
  // even on the same provider origin, is no longer ours to overwrite.
  const current = await chrome.tabs.get(tabId);
  if (current.url !== url && !ownedRoutes.includes(current.url ?? ""))
    return false;
  if (now() >= deadline) {
    // Best-effort restoration after timeout is permitted only on a route the
    // probe navigated itself; it cannot be confirmed as a successful result.
    if (current.url !== url) await chrome.tabs.update(tabId, { url });
    return false;
  }
  return await navigate(
    chrome, tabId, url, current.url ?? url, pause, deadline, now,
  );
}

async function pollTrue(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  func: (...args: never[]) => unknown,
  args: unknown[],
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 15 && now() < deadline; attempt++) {
    const observed = await script(func, args);
    if (now() >= deadline) return false;
    if (observed === true) return true;
    // A pending panel is exactly false, never a string or missing result.
    if (observed !== false) return false;
    await pause(Math.min(POLL_MS, deadline - now()));
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
  deadline: number,
  now: () => number,
): Promise<"supported" | "unsupported" | undefined> {
  for (let attempt = 0; attempt < 15 && now() < deadline; attempt++) {
    const result = await script(
      inspectBlooketAudioCapabilityDrawer as (...args: never[]) => unknown,
      [setId],
    );
    if (now() >= deadline || !result || typeof result !== "object" ||
        Array.isArray(result)) return undefined;
    const keys = Object.keys(result).sort().join();
    if (keys === "ok,value" && "ok" in result && result.ok === true &&
        "value" in result &&
        (result.value === "supported" || result.value === "unsupported"))
      return result.value;
    // A genuine page-unavailable state can mean drawer hydration. Invalid
    // success or diagnostic envelopes must not become true after a later poll.
    if (keys !== "code,ok" || !("ok" in result) ||
        result.ok !== false || !("code" in result) ||
        result.code !== "blooket-browser-failed") return undefined;
    await pause(Math.min(POLL_MS, deadline - now()));
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
  deadline: number,
  now: () => number,
): Promise<boolean> {
  const alreadyClosed = await script(
    isBlooketAudioCapabilityDrawerClosed as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (alreadyClosed === true) return true;
  if (alreadyClosed !== false) return false;
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
    deadline,
    now,
  ).catch(() => false);
}

async function closeQuestionPanel(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  setId: string,
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
): Promise<boolean> {
  const alreadyClosed = await script(
    isBlooketCapabilityQuestionPanelClosed as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (alreadyClosed === true) return true;
  if (alreadyClosed !== false) return false;
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
    deadline,
    now,
  ).catch(() => false);
}

function firstSetId(value: unknown): string | null | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== "ok,value" ||
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
      value.value.items.length !== 0) ||
    (value.value.items.length === 0 &&
      value.value.completeness !== "complete")
  )
    return undefined;
  let first: string | null = null;
  const seen = new Set<string>();
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
      /[\x00-\x1f\x7f]/u.test(record["id"]) ||
      seen.has(record["id"]) ||
      typeof record["title"] !== "string" ||
      !record["title"].trim() ||
      record["title"].length > 1_000
    )
      return undefined;
    seen.add(record["id"]);
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
