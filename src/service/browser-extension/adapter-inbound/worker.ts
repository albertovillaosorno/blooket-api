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
//   - Automatic local workspace discovery and serial browser read delivery.
// - Must-Not:
//   - Persist credentials, bypass provider stops, or execute arbitrary
//     commands.
// - Allows:
//   - Inputs: Trusted local workspace transport and exact read requests.
//   - Outputs: Admitted browser replies and connection status without tokens.
//   - Side effects: One owned tab, temporary pairing, and local polling.
// - Split-When:
//   - A transport needs different connection and lifecycle guarantees.
// - Merge-When:
//   - Browser connections no longer cross a process boundary.
// - Summary:
//   - Keeps browser APIs in host composition and delegates page semantics.
// - Description:
//   - Validates jobs and keeps credential submission separate from
//     confirmation.
// - Usage:
//   - Compile as the extension worker; discover the running local workspace.
// - Defaults:
//   - Restart invalidates service tokens; disconnect stops the owned relay.
//
import {
  inspectBlooketPage,
  openBlooketDetailPanel,
  inspectBlooketDetailSidebar,
  closeBlooketDetailPanel,
  isBlooketDetailPanelClosed,
  blooketReadUrl,
  type PageReadOperation,
} from "../../../platforms/blooket-browser/adapter-outbound/page.ts";
import { createExtensionQuestionInspectionHost } from
  "./question-inspection-host.ts";
import { createExtensionAddQuestionHost } from "./add-question-host.ts";
import { createExtensionCapabilityInspectionHost } from
  "./capability-inspection-host.ts";
import { canLeaveBlooketPageForRead } from
  "../../../platforms/blooket-browser/adapter-outbound/capability-page.ts";
import { createExtensionCreateSetHost } from "./create-set-host.ts";
import { createExtensionSessionAuthenticationHost } from
  "./login-host.ts";
import { confirmBlooketReadNavigation } from "./read-navigation.ts";
import {
  inspectBlooketDocumentOrigin,
  inspectBlooketSessionDocumentOrigin,
} from "../../../platforms/blooket-browser/adapter-outbound/document-page.ts";
import { captureBlooketLibraryModel } from
  "../../../platforms/blooket-browser/adapter-outbound/library-model-page.ts";
import { checkBlooketLibraryObservation } from "./library-observation.ts";
import {
  BLOOKET_BROWSER_CLIENT_HEADER, decodeBlooketBrowserBridgeRequest,
} from
  "../../../ir/blooket-browser-bridge/contract/message.ts";

interface BrowserTab {
  id?: number;
  url?: string;
  title?: string;
  status?: string;
  windowId?: number;
}
interface Connection {
  origin: string;
  token: string;
  tabId: number;
}
declare const chrome: {
  runtime: {
    getURL(path: string): string;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: { url?: string; tab?: { id?: number } },
          reply: (value: unknown) => void,
        ) => boolean,
      ): void;
    };
  };
  tabs: {
    onUpdated: {
      addListener(listener: (
        tabId: number,
        changeInfo: { title?: string },
        tab: BrowserTab,
      ) => void): void;
    };
    query(options: { url: string[] }): Promise<BrowserTab[]>;
    create(options: { url: string; active: boolean }): Promise<BrowserTab>;
    get(id: number): Promise<BrowserTab>;
    reload(id: number, options: { bypassCache: true }): Promise<void>;
    update(
      id: number,
      options: { url?: string; active?: boolean },
    ): Promise<BrowserTab>;
  };
  windows: {
    update(id: number, options: { focused: boolean }): Promise<unknown>;
  };
  scripting: {
    executeScript(options: {
      target: { tabId: number };
      func?: (...args: never[]) => unknown;
      args?: unknown[];
      files?: string[];
    }): Promise<{ result?: unknown }[]>;
  };
  storage: {
    local?: {
      get(key: string): Promise<Record<string, unknown>>;
      set(value: Record<string, unknown>): Promise<void>;
    };
    session?: {
      get(key: string): Promise<Record<string, unknown>>;
      set(value: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
};

let connection: Connection | undefined;
let generation = 0;
let status = "waiting-for-workspace";
let pendingUiAction = Promise.resolve();
let humanWindowRaised = false;
let browserClientLabel: Promise<string> | undefined;
class BrowserBridgeCompatibilityError extends Error {}

function pairedBrowserLabel(): Promise<string> {
  browserClientLabel ??= (async () => {
    // Each browser profile retains its own anonymous extension identity.
    // The bridge can then refuse jobs if a second profile with unrelated
    // cookies is paired to the same local service. No account data stored.
    const key = "blooket-browser-profile-id";
    let id: string | undefined;
    try {
      const stored = (await chrome.storage.local?.get(key))?.[key];
      if (typeof stored === "string" &&
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(stored))
        id = stored;
    } catch { /* Storage may be disabled in a browser variant. */ }
    id ??= crypto.randomUUID();
    try {
      await chrome.storage.local?.set({ [key]: id });
    } catch { /* Remain stable until this worker is recreated. */ }
    return chrome.runtime.getURL("") + "#" + id;
  })();
  return browserClientLabel;
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function configured(value: unknown): Connection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join() !== "origin,tabId,token" ||
    typeof record["origin"] !== "string" ||
    typeof record["token"] !== "string" ||
    !/^[a-zA-Z0-9_-]{43}$/u.test(record["token"]) ||
    typeof record["tabId"] !== "number" ||
    !Number.isSafeInteger(record["tabId"]) ||
    record["tabId"] < 1
  )
    return undefined;
  try {
    const url = new URL(record["origin"]);
    if (
      url.protocol !== "http:" ||
      !url.port ||
      !["127.0.0.1", "127.0.0.2"].includes(url.hostname) ||
      url.origin !== record["origin"]
    )
      return undefined;
    return record as unknown as Connection;
  } catch {
    return undefined;
  }
}

async function jsonResponse(
  response: Response,
  maxBytes = 1_000_000,
): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("bridge-unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maxBytes || chunks.length >= 2_048 || part.value.length === 0)
        throw new Error("bridge-response-too-large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
async function bridgeFetch(
  current: Connection,
  route: string,
  value?: unknown,
) {
  const response = await fetch(current.origin + route, {
    method: value === undefined ? "GET" : "POST",
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(2000),
    headers: {
      Authorization: "Bearer " + current.token,
      [BLOOKET_BROWSER_CLIENT_HEADER]: await pairedBrowserLabel(),
      ...(value === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  if (response.status === 426) throw new BrowserBridgeCompatibilityError();
  // Base64 expands one admitted image to ~3.34 MB. Only job delivery receives
  // that allowance; status and result responses keep their original bound.
  return await jsonResponse(response,
    route === "/api/browser-bridge/next" ? 4_000_000 : 1_000_000);
}
async function script(
  current: Connection,
  browser: ReturnType<typeof ownedBrowser>,
  func: (...args: never[]) => unknown,
  args: unknown[] = [],
) {
  const replies = await browser.scripting.executeScript({
    target: { tabId: current.tabId },
    func,
    args,
  });
  if (replies.length !== 1 || replies[0]?.result === undefined)
    throw new Error("browser-read-unavailable");
  return replies[0].result;
}
async function read(
  current: Connection,
  browser: ReturnType<typeof ownedBrowser>,
  operation:
    | PageReadOperation
    | { readonly kind: "questions.list"; readonly setId: string },
) {
  // Leave room for the ten-second bridge deadline, including navigation.
  const readDeadline = Date.now() + 8_000;
  const target =
    operation.kind === "questions.list"
      ? "https://dashboard.blooket.com/edit?id=" +
        encodeURIComponent(operation.setId)
      : blooketReadUrl(operation);
  let tab = await browser.tabs.get(current.tabId);
  if (!tab.url) throw new Error("manual-blooket-sign-in-required");
  const origin = new URL(tab.url).origin;
  if (
    operation.kind === "session.observe"
      ? origin !== "https://dashboard.blooket.com" &&
        origin !== "https://id.blooket.com"
      : origin !== "https://dashboard.blooket.com"
  )
    throw new Error("manual-blooket-sign-in-required");
  let approvedSourceOrigin: number | undefined;
  if (target !== null) {
    // The teacher may be editing a question, metadata, or a fresh set in
    // the current tab. Refuse navigation or a same-route reload first.
    if (tab.status !== "complete")
      throw new Error("browser-navigation-unsafe");
    const nativeSource = await script(current, browser,
      inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
      [tab.url]);
    if (typeof nativeSource !== "number" ||
        !Number.isFinite(nativeSource) || nativeSource <= 0 ||
        Date.now() >= readDeadline)
      throw new Error("browser-navigation-unsafe");
    approvedSourceOrigin = nativeSource;
    const safe = await script(
      current, browser,
      canLeaveBlooketPageForRead as (...args: never[]) => unknown,
    );
    const checked = await browser.tabs.get(current.tabId);
    if (safe !== true || checked.status !== "complete" ||
        checked.url !== tab.url || Date.now() >= readDeadline)
      throw new Error("browser-navigation-unsafe");
    const afterGuardOrigin = await script(current, browser,
      inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
      [tab.url]);
    if (afterGuardOrigin !== approvedSourceOrigin ||
        Date.now() >= readDeadline)
      throw new Error("browser-navigation-unsafe");
  }
  const confirmed = await confirmBlooketReadNavigation(
    browser.tabs, current.tabId, tab, target, readDeadline, pause,
    async url => await script(current, browser,
      inspectBlooketDocumentOrigin as (...args: never[]) => unknown, [url]),
    Date.now, approvedSourceOrigin,
  );
  if (!confirmed) throw new Error("browser-navigation-timeout");
  tab = confirmed;
  if (operation.kind === "questions.list") {
    const host = createExtensionQuestionInspectionHost(
      browser, current.tabId, pause,
    );
    return await host.inspect(operation.setId, readDeadline);
  }
  if (operation.kind === "sets.list") {
    const expectedOrigin = await script(current, browser,
      inspectBlooketDocumentOrigin as (...args: never[]) => unknown, [target]);
    if (typeof expectedOrigin !== "number" ||
        !Number.isFinite(expectedOrigin) || expectedOrigin <= 0 ||
        Date.now() >= readDeadline)
      throw new Error("browser-set-list-unavailable");
    const observe = async () => {
      const observed = await script(current, browser,
        inspectBlooketPage as (...args: never[]) => unknown, [operation]);
      const captured = await script(current, browser,
        captureBlooketLibraryModel as (...args: never[]) => unknown);
      const afterOrigin = await script(current, browser,
        inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
        [target]);
      // Both scripts must belong to the same native document. A same-route
      // replacement cannot make two unrelated snapshots look consistent.
      if (afterOrigin !== expectedOrigin || Date.now() >= readDeadline)
        throw new Error("browser-set-list-unavailable");
      // Raw initial model text remains inside this local extension call.
      return checkBlooketLibraryObservation(observed, captured);
    };
    let initial: unknown;
    let captured = false;
    // React can hydrate after the document reaches the complete state.
    for (let attempt = 0; attempt < 15 && Date.now() < readDeadline;
      attempt++) {
      const currentTab = await browser.tabs.get(current.tabId);
      if (currentTab.status !== "complete" || currentTab.url !== target)
        throw new Error("browser-set-list-unavailable");
      const result = await observe();
      if (
        result && typeof result === "object" && !Array.isArray(result) &&
        Object.keys(result).sort().join() === "code,ok" &&
        "ok" in result && result.ok === false &&
        "code" in result && result.code === "blooket-browser-failed"
      ) {
        await pause(100);
        continue;
      }
      if (
        !result || typeof result !== "object" || Array.isArray(result) ||
        Object.keys(result).sort().join() !== "ok,value" ||
        !("ok" in result) || result.ok !== true ||
        !("value" in result) || !result.value ||
        typeof result.value !== "object" || Array.isArray(result.value) ||
        Object.keys(result.value).sort().join() !== "completeness,items" ||
        !("completeness" in result.value) ||
        !("items" in result.value) ||
        !Array.isArray(result.value.items) ||
        result.value.items.length > 200 ||
        (result.value.completeness !== "complete" &&
          result.value.completeness !== "unknown") ||
        (result.value.items.length === 0
          ? result.value.completeness !== "complete"
          : result.value.completeness !== "unknown")
      ) throw new Error("browser-set-list-unavailable");
      initial = result;
      captured = true;
      break;
    }
    if (!captured || Date.now() >= readDeadline)
      throw new Error("browser-set-list-unavailable");
    // Read again after an event-loop yield: loading or card changes are not a
    // complete baseline. The second observation is never retried.
    await pause(100);
    if (Date.now() >= readDeadline)
      throw new Error("browser-set-list-unavailable");
    const tabAfter = await browser.tabs.get(current.tabId);
    if (tabAfter.status !== "complete" || tabAfter.url !== target)
      throw new Error("browser-set-list-unavailable");
    const after = await observe();
    if (
      Date.now() >= readDeadline ||
      JSON.stringify(initial) !== JSON.stringify(after)
    ) throw new Error("browser-set-list-unavailable");
    const checkedTab = await browser.tabs.get(current.tabId);
    if (checkedTab.status !== "complete" || checkedTab.url !== target)
      throw new Error("browser-set-list-unavailable");
    return initial;
  }
  if (operation.kind === "sets.get") {
    // A new document can occupy the same /edit?id URL after the worker's
    // navigation check. Keep all panel observations and Cancel in one lifetime.
    const documentOrigin = await script(current, browser,
      inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
      [target]);
    if (typeof documentOrigin !== "number" ||
        !Number.isFinite(documentOrigin) || documentOrigin <= 0 ||
        Date.now() >= readDeadline)
      throw new Error("browser-details-unavailable");
    const ownsDetailRoute = async () => {
      const observed = await browser.tabs.get(current.tabId);
      if (Date.now() >= readDeadline || observed.status !== "complete" ||
          observed.url !== target) return false;
      const currentOrigin = await script(current, browser,
        inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
        [target]);
      const after = await browser.tabs.get(current.tabId);
      return Date.now() < readDeadline && after.status === "complete" &&
        after.url === target && currentOrigin === documentOrigin;
    };
    // Module 12048 unmounts the original title/description sidebar once
    // Edit Info opens. Capture two identical independent sidebar readings
    // before interacting with the editor; never infer saved state from a
    // mutable editor field by itself.
    const sidebarValue = async () => {
      if (!await ownsDetailRoute())
        throw new Error("browser-details-unavailable");
      const reply = await script(
        current, browser,
        inspectBlooketDetailSidebar as (...args: never[]) => unknown,
        [operation.setId],
      );
      if (!await ownsDetailRoute() || !reply ||
          typeof reply !== "object" || Array.isArray(reply) ||
          Object.keys(reply).sort().join() !== "ok,value" ||
          !("ok" in reply) || reply.ok !== true ||
          !("value" in reply) || !reply.value ||
          typeof reply.value !== "object" ||
          Array.isArray(reply.value) ||
          Object.keys(reply.value).sort().join() !== "description,title" ||
          !("title" in reply.value) ||
          typeof reply.value.title !== "string" ||
          !("description" in reply.value) ||
          typeof reply.value.description !== "string")
        throw new Error("browser-details-unavailable");
      return reply.value as { title: string; description: string };
    };
    const baseline = await sidebarValue();
    await pause(0);
    const baselineAgain = await sidebarValue();
    if (JSON.stringify(baseline) !== JSON.stringify(baselineAgain))
      throw new Error("browser-details-unavailable");
    let opened = false;
    for (let attempt = 0; attempt < 15 && Date.now() < readDeadline;
      attempt++) {
      if (!await ownsDetailRoute())
        throw new Error("browser-details-unavailable");
      const result = await script(
        current,
        browser,
        openBlooketDetailPanel as (...args: never[]) => unknown,
        [operation.setId],
      );
      if (!await ownsDetailRoute())
        throw new Error("browser-details-unavailable");
      if (result === true) {
        opened = true;
        break;
      }
      if (result !== false) throw new Error("browser-details-unavailable");
      await pause(100);
    }
    if (!opened) throw new Error("browser-details-unavailable");
    let cancellationEvidence: {
      readonly title: string;
      readonly description: string;
      readonly visibility: "private" | "public";
    } | undefined;
    try {
      // Opening details is asynchronous; retry only reads.
      // Never submit a Save Set mutation.
      for (let attempt = 0; attempt < 15 && Date.now() < readDeadline;
        attempt++) {
        if (!await ownsDetailRoute())
          throw new Error("browser-details-unavailable");
        const result = await script(
          current,
          browser,
          inspectBlooketPage as (...args: never[]) => unknown,
          [operation],
        );
        if (!await ownsDetailRoute())
          throw new Error("browser-details-unavailable");
        if (
          result && typeof result === "object" && !Array.isArray(result) &&
          Object.keys(result).sort().join() === "ok,value" &&
          "ok" in result && result.ok === true && "value" in result
        ) {
          if (Date.now() >= readDeadline)
            throw new Error("browser-details-unavailable");
          const confirmed = await browser.tabs.get(current.tabId);
          if (confirmed.status !== "complete" || confirmed.url !== target)
            throw new Error("browser-details-unavailable");
          // A freshly opened metadata panel can still hydrate asynchronously.
          await pause(100);
          if (Date.now() >= readDeadline)
            throw new Error("browser-details-unavailable");
          const again = await script(
            current,
            browser,
            inspectBlooketPage as (...args: never[]) => unknown,
            [operation],
          );
          if (JSON.stringify(result) !== JSON.stringify(again))
            throw new Error("browser-details-unavailable");
          const candidate = result.value;
          if (!candidate || typeof candidate !== "object" ||
              Array.isArray(candidate) ||
              !("title" in candidate) ||
              !("description" in candidate) ||
              !("visibility" in candidate) ||
              candidate.title !== baseline.title ||
              candidate.description !== baseline.description ||
              (candidate.visibility !== "private" &&
                candidate.visibility !== "public"))
            throw new Error("browser-details-unavailable");
          const after = await browser.tabs.get(current.tabId);
          if (
            Date.now() >= readDeadline || after.status !== "complete" ||
            after.url !== target
          ) throw new Error("browser-details-unavailable");
          cancellationEvidence = {
            title: candidate.title,
            description: candidate.description,
            visibility: candidate.visibility,
          };
          return result;
        }
        if (
          !result || typeof result !== "object" || Array.isArray(result) ||
          Object.keys(result).sort().join() !== "code,ok" ||
          !("ok" in result) || result.ok !== false ||
          !("code" in result) || result.code !== "blooket-browser-failed"
        ) throw new Error("browser-details-unavailable");
        await pause(100);
      }
      throw new Error("browser-details-unavailable");
    } finally {
      // Recovered edit module 12048 exposes a Cancel button. A read-owned
      // sidebar editor must not remain available for the next request to
      // confuse local unsaved edits with independently fetched remote state.
      // Never inject cleanup into a tab the teacher has navigated away from.
      let closed = false;
      if (!cancellationEvidence)
        throw new Error("browser-details-unconfirmed");
      if (await ownsDetailRoute().catch(() => false)) {
        const canceled = await script(
          current, browser,
          closeBlooketDetailPanel as (...args: never[]) => unknown,
          [operation.setId, baseline, cancellationEvidence],
        ).catch(() => false);
        if (canceled === true) {
          for (let attempt = 0; attempt < 15 && Date.now() < readDeadline;
            attempt++) {
            if (!await ownsDetailRoute().catch(() => false)) break;
            const result = await script(
              current, browser,
              isBlooketDetailPanelClosed as (...args: never[]) => unknown,
              [operation.setId],
            ).catch(() => false);
            if (result === true && await ownsDetailRoute().catch(
              () => false,
            )) {
              closed = true;
              break;
            }
            if (result !== false) break;
            await pause(100);
          }
        }
      }
      if (!closed) throw new Error("browser-details-cleanup-failed");
    }
  }
  const sessionOrigin = operation.kind === "session.observe"
    ? await script(current, browser,
      inspectBlooketSessionDocumentOrigin as (...args: never[]) => unknown,
      [tab.url]) : null;
  if (operation.kind === "session.observe" &&
      (typeof sessionOrigin !== "number" ||
       !Number.isFinite(sessionOrigin) || sessionOrigin <= 0))
    throw new Error("browser-session-changed");
  const observed = await script(
    current,
    browser,
    inspectBlooketPage as (...args: never[]) => unknown,
    [operation],
  );
  if (operation.kind === "session.observe") {
    // A result from a tab that navigated while the script ran cannot prove
    // the current authentication state, regardless of which state it claimed.
    const currentTab = await browser.tabs.get(current.tabId);
    const afterOrigin = await script(current, browser,
      inspectBlooketSessionDocumentOrigin as (...args: never[]) => unknown,
      [tab.url]);
    if (
      Date.now() >= readDeadline ||
      currentTab.status !== "complete" ||
      currentTab.url !== tab.url || afterOrigin !== sessionOrigin
    ) throw new Error("browser-session-changed");
    // React or a verification interstitial can change without navigation.
    // A single read cannot establish the current state in that transition.
    await pause(100);
    if (Date.now() >= readDeadline)
      throw new Error("browser-session-changed");
    const beforeAgain = await browser.tabs.get(current.tabId);
    if (beforeAgain.status !== "complete" || beforeAgain.url !== tab.url)
      throw new Error("browser-session-changed");
    const again = await script(
      current,
      browser,
      inspectBlooketPage as (...args: never[]) => unknown,
      [operation],
    );
    const afterAgain = await browser.tabs.get(current.tabId);
    const finalOrigin = await script(current, browser,
      inspectBlooketSessionDocumentOrigin as (...args: never[]) => unknown,
      [tab.url]);
    if (
      Date.now() >= readDeadline ||
      afterAgain.status !== "complete" ||
      afterAgain.url !== tab.url || finalOrigin !== sessionOrigin ||
      JSON.stringify(observed) !== JSON.stringify(again)
    ) throw new Error("browser-session-changed");
  }
  return observed;
}
function ownedBrowser(
  current: Connection,
  activeGeneration: number,
  deadline = Infinity,
) {
  const requireOwner = () => {
    if (connection !== current || generation !== activeGeneration ||
        Date.now() >= deadline)
      throw new Error("retired-browser-connection");
  };
  return {
    tabs: {
      get: async (id: number) => {
        requireOwner();
        const result = await chrome.tabs.get(id);
        requireOwner();
        return result;
      },
      update: async (
        id: number,
        options: { url?: string; active?: boolean },
      ) => {
        requireOwner();
        const result = await chrome.tabs.update(id, options);
        requireOwner();
        return result;
      },
      reload: async (id: number, options: { bypassCache: true }) => {
        requireOwner();
        await chrome.tabs.reload(id, options);
        requireOwner();
      },
    },
    scripting: {
      executeScript: async (
        options: Parameters<typeof chrome.scripting.executeScript>[0],
      ) => {
        requireOwner();
        const result = await chrome.scripting.executeScript(options);
        requireOwner();
        return result;
      },
    },
  };
}

// A verified human challenge is shown in the real browser's existing tab.
// Never launch an automated solver, change the User-Agent, or copy cookies.
async function showHumanBlooketTab(
  tabId: number,
  stillOwned: () => boolean = () => true,
): Promise<boolean> {
  if (!stillOwned()) return false;
  const tab = await chrome.tabs.get(tabId);
  if (tab.id !== tabId || !tab.url || !stillOwned() ||
      !["https://dashboard.blooket.com", "https://id.blooket.com"]
        .includes(new URL(tab.url).origin)) return false;
  if (typeof tab.windowId !== "number" ||
      !Number.isSafeInteger(tab.windowId) || tab.windowId < 0)
    return false;
  const active = await chrome.tabs.update(tabId, { active: true });
  if (!stillOwned() || active.id !== tabId || active.url !== tab.url ||
      active.windowId !== tab.windowId) return false;
  // A manual tab switch may finish while activation is pending. Never focus
  // the remembered window if the active tab has become foreign or replaced.
  const checked = await chrome.tabs.get(tabId);
  if (!stillOwned() || checked.id !== tabId ||
      checked.url !== tab.url || checked.windowId !== tab.windowId ||
      !checked.url ||
      !["https://dashboard.blooket.com", "https://id.blooket.com"]
        .includes(new URL(checked.url).origin)) return false;
  await chrome.windows.update(tab.windowId, { focused: true });
  return stillOwned();
}

async function relay(current: Connection, activeGeneration: number) {
  const browser = ownedBrowser(current, activeGeneration);
  const isOwner = () => connection === current &&
    generation === activeGeneration;
  while (isOwner()) {
    try {
      // A browser API call also keeps an explicitly connected worker alive.
      try {
        await browser.tabs.get(current.tabId);
      } catch {
        if (!isOwner()) return;
        await disconnect();
        status = "waiting-for-workspace";
        return;
      }
      const next = await bridgeFetch(current, "/api/browser-bridge/next");
      if (!isOwner()) return;
      if (!next || typeof next !== "object" || !("job" in next))
        throw new Error("invalid-bridge-poll");
      if (next.job !== null) {
        const decoded = decodeBlooketBrowserBridgeRequest(next.job);
        if (!decoded.ok) throw new Error("invalid-browser-job");
        const job = decoded.value;
        // Read jobs have ten seconds; writes have a bounded thirty-second
        // budget. Reserve margin so a late browser call cannot mutate after
        // its caller has stopped waiting. In-flight scripts remain ambiguous.
        const budgetMs = job.command.kind === "session.authenticate"
          ? 7_500
          : job.command.kind === "sets.create" ||
              job.command.kind === "questions.create"
            ? 27_000
            : job.command.kind === "capabilities.inspect"
              ? 9_000 : 8_000;
        const jobBrowser = ownedBrowser(
          current, activeGeneration, Date.now() + budgetMs,
        );
        let result: unknown = { ok: false, code: "blooket-browser-failed" };
        try {
          if (job.command.kind === "browser.activate") {
            const visible = await showHumanBlooketTab(current.tabId,
              isOwner);
            result = visible
              ? { ok: true, value: { focused: true } }
              : { ok: false, code: "blooket-browser-failed" };
          } else if (
            job.command.kind === "session.observe" ||
            job.command.kind === "sets.list" ||
            job.command.kind === "sets.get" ||
            job.command.kind === "questions.list"
          ) {
            result = await read(current, jobBrowser, job.command);
          } else if (job.command.kind === "session.authenticate") {
            const host = createExtensionSessionAuthenticationHost(
              jobBrowser,
              current.tabId,
              pause,
            );
            result = await host.authenticate({
              loginIdentifier: job.command.loginIdentifier,
              password: job.command.password,
            });
          } else if (job.command.kind === "capabilities.inspect") {
            const host = createExtensionCapabilityInspectionHost(
              jobBrowser,
              current.tabId,
              pause,
            );
            result = await host.inspect();
          } else if (job.command.kind === "sets.create") {
            const host = createExtensionCreateSetHost(
              jobBrowser,
              current.tabId,
              pause,
            );
            const input = {
              title: job.command.title,
              description: job.command.description,
              private: job.command.private,
            };
            const opened = await host.openCreateSet();
            if (!opened.ok) {
              result = { ok: true, value: opened };
            } else {
              const prepared = await host.prepareCreateSet(input);
              if (!prepared.ok) {
                result = { ok: true, value: prepared };
              } else {
                const submitted = await host.submitCreateSet(input);
                result = submitted.ok
                  ? {
                      ok: true,
                      value: await host.observeCreateSet(input),
                    }
                  : { ok: true, value: submitted };
              }
            }
          } else if (job.command.kind === "questions.create") {
            const host = createExtensionAddQuestionHost(
              jobBrowser,
              current.tabId,
              pause,
            );
            result = {
              ok: true,
              value: await host.addQuestion({
                setId: job.command.setId,
                number: job.command.number,
                question: job.command.question,
                answers: job.command.answers,
                qType: job.command.qType,
                random: job.command.random,
                answerTypes: job.command.answerTypes,
                timeLimit: job.command.timeLimit,
                ...(job.command.image ? { image: job.command.image } : {}),
              }),
            };
          }
        } catch {
          if (!isOwner()) return;
          status = "blooket-attention-required";
        }
        // An old relay cannot change the new connection's popup status.
        if (!isOwner()) return;
        // Popup status tracks the last *confirmed* session observation.
        // Successful form submission never implies authenticated readiness.
        if (
          job.command.kind === "session.observe" &&
          result && typeof result === "object" && !Array.isArray(result) &&
          Object.keys(result).sort().join() === "ok,value" &&
          "ok" in result && result.ok === true &&
          "value" in result && typeof result.value === "string"
        ) {
          const state = result.value;
          if (state === "dashboard" || state === "my-sets" ||
              state === "create" || state === "edit")
            humanWindowRaised = false;
          if (
            state === "signed-out" || state === "expired-session" ||
            state === "security-challenge" ||
            state === "organization-prompt" || state === "unexpected-page"
          ) status = "blooket-attention-required";
          else if (
            state === "dashboard" || state === "my-sets" ||
            state === "create" || state === "edit"
          ) status = "connected";
        }
        await bridgeFetch(current, "/api/browser-bridge/result", {
          schemaVersion: job.schemaVersion,
          id: job.id,
          ...(result as Record<string, unknown>),
        });
        // The client must get its result before any best-effort window
        // activation. Never steal focus repeatedly in a challenge loop.
        if (job.command.kind === "session.observe" &&
            !humanWindowRaised && result && typeof result === "object" &&
            !Array.isArray(result) && "ok" in result &&
            result.ok === true && "value" in result &&
            (result.value === "security-challenge" ||
              result.value === "organization-prompt")) {
          humanWindowRaised = true;
          await showHumanBlooketTab(current.tabId, isOwner)
            .catch(() => undefined);
        }
      }
      if (status === "connection-unavailable") status = "connected";
    } catch (error) {
      if (!isOwner()) return;
      if (error instanceof BrowserBridgeCompatibilityError) {
        await disconnect();
        status = "extension-update-required";
        return;
      }
      status = "connection-unavailable";
    }
    // Write leases need 9.5 seconds of the broker's ten-second window.
    // A one-second poll can consume that margin before any form is opened.
    await pause(250);
  }
}
async function disconnect() {
  humanWindowRaised = false;
  generation++;
  connection = undefined;
  status = "disconnected";
  await chrome.storage.session?.remove("connection");
}
function admittedBlooketTab(tab: BrowserTab | undefined): boolean {
  if (!tab?.id || !tab.url) return false;
  try {
    return ["https://dashboard.blooket.com", "https://id.blooket.com"]
      .includes(new URL(tab.url).origin);
  } catch { return false; }
}

function reclaimableBlooketTab(tab: BrowserTab | undefined): boolean {
  // Local storage outlives extension and browser restarts. A recycled numeric
  // tab ID at /edit or /create may contain a teacher's unfinished work.
  // Reclaim only our previous landing route, never an editor or modal route.
  if (!admittedBlooketTab(tab)) return false;
  const url = new URL(tab!.url!);
  const landing = url.origin === "https://dashboard.blooket.com" &&
    url.pathname === "/my-sets" ||
    url.origin === "https://id.blooket.com" &&
    url.pathname === "/login";
  if (!landing || url.hash) return false;
  if (!url.search) return true;
  // Cloudflare can append this provider-owned one-time query while showing
  // its challenge. Preserve the *same* tab through an extension reload, but
  // never reclaim an arbitrary editor, search, or foreign query.
  return tab?.title === "Just a moment..." &&
    url.searchParams.size === 1 &&
    url.searchParams.getAll("__cf_chl_rt_tk").length === 1 &&
    (url.searchParams.get("__cf_chl_rt_tk")?.length ?? 0) <= 1_024 &&
    (url.searchParams.get("__cf_chl_rt_tk")?.length ?? 0) > 0;
}

async function connectWorkspace(message: unknown) {
  if (
    !message ||
    typeof message !== "object" ||
    !("origin" in message) ||
    !("token" in message)
  )
    return { ok: false, status: "invalid-request" };
  const candidate = configured({
    origin: message.origin,
    token: message.token,
    tabId: connection?.tabId ?? 1,
  });
  if (!candidate) return { ok: false, status: "connection-unavailable" };
  // Multiple Blooket API workspace tabs may announce every ten seconds.
  // A healthy paired service must not be silently replaced by whichever
  // different local service happened to announce most recently.
  if (connection && connection.origin !== candidate.origin &&
      status !== "connection-unavailable")
    return { ok: false, status: "workspace-already-connected" };
  if (
    connection?.origin === candidate.origin &&
    connection.token === candidate.token
  ) {
    try {
      const tab = await chrome.tabs.get(connection.tabId);
      if (tab.id === connection.tabId && admittedBlooketTab(tab))
        return { ok: true, status };
    } catch { /* The owned tab was closed. Reconnect to a new one. */ }
  }
  let verified: unknown;
  try {
    verified = await bridgeFetch(candidate, "/api/browser-bridge/status");
  } catch (error) {
    if (error instanceof BrowserBridgeCompatibilityError) {
      status = "extension-update-required";
      return { ok: false, status };
    }
    throw error;
  }
  if (
    !verified ||
    typeof verified !== "object" ||
    !("ok" in verified) ||
    verified.ok !== true ||
    !("pending" in verified) ||
    typeof verified.pending !== "number" ||
    !Number.isSafeInteger(verified.pending) ||
    verified.pending < 0 ||
    !("connected" in verified) ||
    typeof verified.connected !== "boolean"
  )
    return { ok: false, status: "connection-unavailable" };
  let tab: BrowserTab | undefined;
  if (connection) {
    try {
      const existing = await chrome.tabs.get(connection.tabId);
      if (existing.id === connection.tabId && admittedBlooketTab(existing))
        tab = existing;
    } catch {
      /* Closed. */
    }
  }
  // An extension reload clears session storage but does not close the
  // browser tab it created. Reclaim only its recorded, still-open Blooket
  // tab; never grab a teacher's unrelated pre-existing tab or draft.
  if (!tab?.id) {
    try {
      const owned = (await chrome.storage.local?.get(
        "blooket-owned-tab-id",
      ))?.["blooket-owned-tab-id"];
      if (typeof owned === "number" && Number.isSafeInteger(owned) &&
          owned > 0) {
        const previousTab = await chrome.tabs.get(owned);
        if (previousTab.id === owned && reclaimableBlooketTab(previousTab))
          tab = previousTab;
      }
    } catch { /* A remembered tab can be closed or unavailable. */ }
  }
  if (!tab?.id)
    tab = await chrome.tabs.create({
      url: "https://dashboard.blooket.com/my-sets",
      active: false,
    });
  if (!tab.id) return { ok: false, status: "browser-unavailable" };
  try {
    await chrome.storage.local?.set({ "blooket-owned-tab-id": tab.id });
  } catch { /* Continue with the ephemeral, owned tab. */ }
  await disconnect();
  connection = { ...candidate, tabId: tab.id };
  await chrome.storage.session?.set({ connection });
  status = "connected";
  void relay(connection, generation);
  return { ok: true, status };
}
async function discoverWorkspaces() {
  const tabs = await chrome.tabs.query({
    url: ["http://127.0.0.1/*", "http://127.0.0.2/*"],
  });
  for (const tab of tabs.slice(0, 16)) {
    if (!tab.id || !tab.url || new URL(tab.url).pathname !== "/") continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/ui/browser-extension/adapter-inbound/workspace.js"],
      });
    } catch {
      /* A tab can close during discovery. */
    }
  }
}
async function handlePopup(message: unknown) {
  if (!message || typeof message !== "object" || !("kind" in message))
    return { ok: false, status: "invalid-request" };
  if (message.kind === "status") {
    if (!connection) await discoverWorkspaces();
    return { ok: true, status };
  }
  if (message.kind === "open-workspace") {
    await chrome.tabs.create({
      url: connection?.origin ?? "http://127.0.0.1:2607",
      active: true,
    });
    return { ok: true, status };
  }
  if (message.kind === "open-blooket" && connection) {
    const selected = connection;
    const focused = await showHumanBlooketTab(selected.tabId,
      () => connection === selected);
    return focused ? { ok: true, status } :
      { ok: false, status: "blooket-tab-unavailable" };
  }
  return { ok: false, status: "invalid-request" };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const popup =
    sender.url ===
    chrome.runtime.getURL(
      "src/ui/browser-extension/adapter-inbound/popup.html",
    );
  let workspace = false;
  try {
    if (
      sender.url &&
      sender.tab?.id &&
      message &&
      typeof message === "object" &&
      "kind" in message &&
      message.kind === "workspace-ready" &&
      "origin" in message
    ) {
      const page = new URL(sender.url);
      workspace =
        page.origin === message.origin &&
        page.pathname === "/" &&
        page.protocol === "http:" &&
        ["127.0.0.1", "127.0.0.2"].includes(page.hostname);
    }
  } catch {
    /* Untrusted sender URL. */
  }
  if (!popup && !workspace) return false;
  const result = pendingUiAction.then(() =>
    workspace ? connectWorkspace(message) : handlePopup(message),
  );
  pendingUiAction = result.then(
    () => undefined,
    () => undefined,
  );
  void result.then(reply, () =>
    reply({
      ok: false,
      status: "connection-unavailable",
    }),
  );
  return true;
});

// A newly opened background Blooket tab may show a Cloudflare page before
// the first CLI read. Surface it once, based only on the owned tab's URL and
// interstitial title. This is visibility, not authentication evidence.
chrome.tabs.onUpdated.addListener((tabId, changes, tab) => {
  if (!connection || tabId !== connection.tabId || humanWindowRaised ||
      changes.title !== "Just a moment..." || !tab.url) return;
  const owned = connection;
  humanWindowRaised = true;
  void showHumanBlooketTab(tabId, () => connection === owned)
    .catch(() => undefined);
});

async function restoreConnection() {
  try {
    const saved = (await chrome.storage.session?.get(
      "connection",
    ))?.["connection"];
    const previous = configured(saved);
    if (saved !== undefined && !previous) {
      try { await chrome.storage.session?.remove("connection"); }
      catch { /* Invalid bytes are never imported into live state. */ }
    }
    if (previous) {
      let valid = false;
      try {
        const tab = await chrome.tabs.get(previous.tabId);
        valid = tab.id === previous.tabId && admittedBlooketTab(tab);
      } catch { /* The stored tab might have been closed or replaced. */ }
      if (valid) {
        connection = previous;
        status = "connected";
        void relay(previous, generation);
      } else {
        try { await chrome.storage.session?.remove("connection"); }
        catch { /* The new workspace still needs discovery. */ }
      }
    }
    await discoverWorkspaces();
  } catch {
    status = "connection-unavailable";
  }
}
// Listener registration stays synchronous; actions wait for restoration.
pendingUiAction = restoreConnection();
