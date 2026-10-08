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
  blooketReadUrl,
  type PageReadOperation,
} from "../../../platforms/blooket-browser/adapter-outbound/page.ts";
import { createExtensionQuestionInspectionHost } from
  "./question-inspection-host.ts";
import { createExtensionAddQuestionHost } from "./add-question-host.ts";
import { createExtensionCapabilityInspectionHost } from
  "./capability-inspection-host.ts";
import { createExtensionCreateSetHost } from "./create-set-host.ts";
import { createExtensionSessionAuthenticationHost } from
  "./login-host.ts";
import { decodeBlooketBrowserBridgeRequest } from
  "../../../ir/blooket-browser-bridge/contract/message.ts";

interface BrowserTab {
  id?: number;
  url?: string;
  status?: string;
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
    query(options: { url: string[] }): Promise<BrowserTab[]>;
    create(options: { url: string; active: boolean }): Promise<BrowserTab>;
    get(id: number): Promise<BrowserTab>;
    update(
      id: number,
      options: { url?: string; active?: boolean },
    ): Promise<BrowserTab>;
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

async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("bridge-unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1_000_000) throw new Error("bridge-response-too-large");
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
      ...(value === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  return await jsonResponse(response);
}
async function script(
  current: Connection,
  func: (...args: never[]) => unknown,
  args: unknown[] = [],
) {
  const replies = await chrome.scripting.executeScript({
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
  let tab = await chrome.tabs.get(current.tabId);
  if (!tab.url) throw new Error("manual-blooket-sign-in-required");
  const origin = new URL(tab.url).origin;
  if (
    operation.kind === "session.observe"
      ? origin !== "https://dashboard.blooket.com" &&
        origin !== "https://id.blooket.com"
      : origin !== "https://dashboard.blooket.com"
  )
    throw new Error("manual-blooket-sign-in-required");
  if (target && tab.url !== target)
    await chrome.tabs.update(current.tabId, { url: target });
  const deadline = Date.now() + 5000;
  do {
    tab = await chrome.tabs.get(current.tabId);
    if (tab.status === "complete" && (!target || tab.url === target)) break;
    await pause(100);
  } while (Date.now() < deadline);
  if (tab.status !== "complete" || (target && tab.url !== target))
    throw new Error("browser-navigation-timeout");
  if (operation.kind === "questions.list") {
    const host = createExtensionQuestionInspectionHost(
      chrome, current.tabId, pause,
    );
    return await host.inspect(operation.setId, readDeadline);
  }
  if (operation.kind === "sets.list") {
    let initial: unknown;
    let captured = false;
    // React can hydrate after the document reaches the complete state.
    for (let attempt = 0; attempt < 15 && Date.now() < readDeadline;
      attempt++) {
      const currentTab = await chrome.tabs.get(current.tabId);
      if (currentTab.status !== "complete" || currentTab.url !== target)
        throw new Error("browser-set-list-unavailable");
      const result = await script(
        current,
        inspectBlooketPage as (...args: never[]) => unknown,
        [operation],
      );
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
    const tabAfter = await chrome.tabs.get(current.tabId);
    if (tabAfter.status !== "complete" || tabAfter.url !== target)
      throw new Error("browser-set-list-unavailable");
    const after = await script(
      current,
      inspectBlooketPage as (...args: never[]) => unknown,
      [operation],
    );
    if (
      Date.now() >= readDeadline ||
      JSON.stringify(initial) !== JSON.stringify(after)
    ) throw new Error("browser-set-list-unavailable");
    const checkedTab = await chrome.tabs.get(current.tabId);
    if (checkedTab.status !== "complete" || checkedTab.url !== target)
      throw new Error("browser-set-list-unavailable");
    return initial;
  }
  if (operation.kind === "sets.get") {
    let opened = false;
    for (let attempt = 0; attempt < 15 && Date.now() < readDeadline;
      attempt++) {
      const result = await script(
        current,
        openBlooketDetailPanel as (...args: never[]) => unknown,
        [operation.setId],
      );
      if (result === true) {
        opened = true;
        break;
      }
      await pause(100);
    }
    if (!opened) throw new Error("browser-details-unavailable");
    // Opening details is asynchronous; retry reads, never a form submission.
    for (let attempt = 0; attempt < 15 && Date.now() < readDeadline;
      attempt++) {
      const result = await script(
        current,
        inspectBlooketPage as (...args: never[]) => unknown,
        [operation],
      );
      if (
        result && typeof result === "object" && !Array.isArray(result) &&
        Object.keys(result).sort().join() === "ok,value" &&
        "ok" in result && result.ok === true
      ) return result;
      await pause(100);
    }
    throw new Error("browser-details-unavailable");
  }
  return await script(
    current,
    inspectBlooketPage as (...args: never[]) => unknown,
    [operation],
  );
}
async function relay(current: Connection, activeGeneration: number) {
  while (connection === current && generation === activeGeneration) {
    try {
      // A browser API call also keeps an explicitly connected worker alive.
      try {
        await chrome.tabs.get(current.tabId);
      } catch {
        await disconnect();
        status = "waiting-for-workspace";
        return;
      }
      const next = await bridgeFetch(current, "/api/browser-bridge/next");
      if (!next || typeof next !== "object" || !("job" in next))
        throw new Error("invalid-bridge-poll");
      if (next.job !== null) {
        const decoded = decodeBlooketBrowserBridgeRequest(next.job);
        if (!decoded.ok) throw new Error("invalid-browser-job");
        const job = decoded.value;
        let result: unknown = { ok: false, code: "blooket-browser-failed" };
        try {
          if (
            job.command.kind === "session.observe" ||
            job.command.kind === "sets.list" ||
            job.command.kind === "sets.get" ||
            job.command.kind === "questions.list"
          ) {
            result = await read(current, job.command);
          } else if (job.command.kind === "session.authenticate") {
            const host = createExtensionSessionAuthenticationHost(
              chrome,
              current.tabId,
              pause,
            );
            result = await host.authenticate({
              loginIdentifier: job.command.loginIdentifier,
              password: job.command.password,
            });
          } else if (job.command.kind === "capabilities.inspect") {
            const host = createExtensionCapabilityInspectionHost(
              chrome,
              current.tabId,
              pause,
            );
            result = await host.inspect();
          } else if (job.command.kind === "sets.create") {
            const host = createExtensionCreateSetHost(
              chrome,
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
                      value: await host.observeCreateSet(),
                    }
                  : { ok: true, value: submitted };
              }
            }
          } else if (job.command.kind === "questions.create") {
            const host = createExtensionAddQuestionHost(
              chrome,
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
              }),
            };
          }
        } catch {
          status = "blooket-attention-required";
        }
        if (generation !== activeGeneration) return;
        await bridgeFetch(current, "/api/browser-bridge/result", {
          schemaVersion: job.schemaVersion,
          id: job.id,
          ...(result as Record<string, unknown>),
        });
      }
      if (status !== "blooket-attention-required") status = "connected";
    } catch {
      status = "connection-unavailable";
    }
    await pause(1000);
  }
}
async function disconnect() {
  generation++;
  connection = undefined;
  status = "disconnected";
  await chrome.storage.session?.remove("connection");
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
  if (
    connection?.origin === candidate.origin &&
    connection.token === candidate.token
  )
    return { ok: true, status };
  const verified = await bridgeFetch(candidate, "/api/browser-bridge/status");
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
      tab = await chrome.tabs.get(connection.tabId);
    } catch {
      /* Closed. */
    }
  }
  if (!tab?.id)
    tab = await chrome.tabs.create({
      url: "https://dashboard.blooket.com/my-sets",
      active: false,
    });
  if (!tab.id) return { ok: false, status: "browser-unavailable" };
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
    await chrome.tabs.update(connection.tabId, { active: true });
    return { ok: true, status };
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

async function restoreConnection() {
  try {
    const previous = configured(
      (await chrome.storage.session?.get("connection"))?.["connection"],
    );
    if (previous) {
      connection = previous;
      void relay(previous, generation);
    }
    await discoverWorkspaces();
  } catch {
    status = "connection-unavailable";
  }
}
// Listener registration stays synchronous; actions wait for restoration.
pendingUiAction = restoreConnection();
