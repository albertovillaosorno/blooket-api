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
//   - Chrome tab/scripting mechanics for the observed text Create Set flow.
// - Must-Not:
//   - Expose bridge commands, retry submissions, upload media, or store
//     secrets.
// - Allows:
//   - Inputs: One dedicated Blooket tab, Chrome subset, and page helpers.
//   - Outputs: Create Set host steps with explicit navigation stops.
//   - Side effects: Navigate one tab, edit observed controls, submit once.
// - Split-When:
//   - Safari needs a materially different browser host implementation.
// - Merge-When:
//   - Extension workers directly own the browser write surface.
// - Summary:
//   - Implements the host beneath the fail-closed Create Set surface.
// - Description:
//   - Post-submit success requires the separately observed edit redirect.
// - Usage:
//   - Compose only behind an explicitly admitted browser write command.
// - Defaults:
//   - Unexpected navigation and malformed script replies fail closed.
//
import { BLOOKET_NAVIGATION_STATE_KINDS } from
  "../../../ir/blooket-navigation/domain/navigation-state.ts";
import {
  observeBlooketCreateSetSuccess,
  prepareBlooketCreateSetForm,
  submitBlooketCreateSetForm,
} from
  "../../../platforms/blooket-browser/adapter-outbound/create-set-page.ts";
import { inspectBlooketPage } from
  "../../../platforms/blooket-browser/adapter-outbound/page.ts";

interface BrowserTab {
  readonly url?: string;
  readonly status?: string;
}

export type ExtensionCreateSetFailure =
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
      readonly code:
        | "blooket-browser-unavailable"
        | "blooket-browser-failed";
    };

export interface ExtensionCreateSetHost {
  openCreateSet(): Promise<{ readonly ok: true } | ExtensionCreateSetFailure>;
  prepareCreateSet(input: {
    readonly title: string;
    readonly description: string;
    readonly private: boolean;
  }): Promise<{ readonly ok: true } | ExtensionCreateSetFailure>;
  submitCreateSet(expected: {
    readonly title: string;
    readonly description: string;
    readonly private: boolean;
  }): Promise<{ readonly ok: true } | ExtensionCreateSetFailure>;
  observeCreateSet(): Promise<
    | { readonly ok: true; readonly remoteSetId: unknown }
    | ExtensionCreateSetFailure
  >;
}

export interface CreateSetChromePort {
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

const DASHBOARD_ORIGIN = "https://dashboard.blooket.com";
const CREATE_URL = DASHBOARD_ORIGIN + "/create";
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

export function createExtensionCreateSetHost(
  chrome: CreateSetChromePort,
  tabId: number,
  pause: (ms: number) => Promise<void> = async (ms) =>
    await new Promise((resolve) => setTimeout(resolve, ms)),
): ExtensionCreateSetHost {
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

  const createTabReady = async (): Promise<boolean> => {
    const tab = await chrome.tabs.get(tabId);
    return tab.status === "complete" && tab.url === CREATE_URL;
  };
  return {
    openCreateSet: async () => {
      try {
        const before = await chrome.tabs.get(tabId);
        if (!dashboardTab(before) || before.status !== "complete")
          return browserFailure();
        // A manual route selection between browser calls belongs to the user.
        const current = await chrome.tabs.get(tabId);
        if (current.status !== "complete" || current.url !== before.url)
          return browserFailure();
        if (current.url !== CREATE_URL)
          await chrome.tabs.update(tabId, { url: CREATE_URL });
        for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
          const tab = await chrome.tabs.get(tabId);
          if (tab.status === "complete") {
            // A page-level state alone cannot authorize writes on a different
            // route; a post-script tab check rejects late navigation as well.
            if (tab.url !== CREATE_URL) return browserFailure();
            const observed = await observe(script);
            if (!await createTabReady()) return browserFailure();
            if (observed === "create") return { ok: true };
            if (observed !== undefined)
              return navigationFailure(normalizeUnexpected(observed));
          }
          await pause(POLL_MS);
        }
        return browserFailure();
      } catch {
        return browserFailure();
      }
    },

    prepareCreateSet: async (input) => {
      try {
        if (!await createTabReady()) return browserFailure();
        const result = await script(
          prepareBlooketCreateSetForm as (...args: never[]) => unknown,
          [input],
        );
        return await createTabReady() && exactOk(result)
          ? { ok: true } : browserFailure();
      } catch {
        return browserFailure();
      }
    },

    submitCreateSet: async (expected) => {
      try {
        if (!await createTabReady()) return browserFailure();
        const result = await script(
          submitBlooketCreateSetForm as (...args: never[]) => unknown,
          [expected],
        );
        // Submission may immediately redirect to /edit. An acknowledgment
        // from an unrelated route cannot authorize subsequent read-back.
        const after = await chrome.tabs.get(tabId);
        return exactOk(result) && expectedSubmitRoute(after)
          ? { ok: true } : browserFailure();
      } catch {
        return browserFailure();
      }
    },

    observeCreateSet: async () => {
      try {
        for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
          const tab = await chrome.tabs.get(tabId);
          if (tab.status === "complete" && tab.url) {
            const url = new URL(tab.url);
            if (
              url.origin === DASHBOARD_ORIGIN &&
              url.pathname === "/edit"
            ) {
              const ids = url.searchParams.getAll("id");
              if (ids.length !== 1 || !ids[0] || ids[0].length > 512 ||
                  /[\x00-\x1f\x7f]/u.test(ids[0]))
                return browserFailure();
              const result = await script(
                observeBlooketCreateSetSuccess as
                  (...args: never[]) => unknown,
              );
              const after = await chrome.tabs.get(tabId);
              if (after.status !== "complete" || after.url !== tab.url ||
                  !exactRedirectReceipt(result, ids[0]))
                return browserFailure();
              // An edit redirect can hydrate after the first complete page
              // event. One claim is not a stable persisted read-back.
              await pause(0);
              const beforeAgain = await chrome.tabs.get(tabId);
              if (beforeAgain.status !== "complete" ||
                  beforeAgain.url !== tab.url)
                return browserFailure();
              const again = await script(
                observeBlooketCreateSetSuccess as
                  (...args: never[]) => unknown,
              );
              const afterAgain = await chrome.tabs.get(tabId);
              if (afterAgain.status !== "complete" ||
                  afterAgain.url !== tab.url ||
                  !exactRedirectReceipt(again, ids[0]) ||
                  JSON.stringify(result) !== JSON.stringify(again))
                return browserFailure();
              return { ok: true, remoteSetId: ids[0] };
            }
            const observed = await observe(script);
            if (observed !== undefined && observed !== "create")
              return navigationFailure(normalizeUnexpected(observed));
          }
          await pause(POLL_MS);
        }
        return browserFailure();
      } catch {
        return browserFailure();
      }
    },
  };
}

async function observe(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
): Promise<string | undefined> {
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

function dashboardTab(tab: BrowserTab): boolean {
  if (!tab.url) return false;
  try {
    return new URL(tab.url).origin === DASHBOARD_ORIGIN;
  } catch {
    return false;
  }
}

function expectedSubmitRoute(tab: BrowserTab): boolean {
  if (!tab.url || (tab.status !== "complete" && tab.status !== "loading"))
    return false;
  if (tab.url === CREATE_URL) return true;
  const url = new URL(tab.url);
  const ids = url.searchParams.getAll("id");
  return url.origin === DASHBOARD_ORIGIN && url.pathname === "/edit" &&
    ids.length === 1 && !!ids[0] && ids[0].length <= 512;
}

function exactRedirectReceipt(
  value: unknown,
  id: string,
): value is { readonly ok: true; readonly remoteSetId: string } {
  return !!value && typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === "ok,remoteSetId" &&
    "ok" in value && value.ok === true &&
    "remoteSetId" in value && value.remoteSetId === id;
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
) {
  return {
    ok: false as const,
    kind: "navigation" as const,
    state,
  };
}

function browserFailure() {
  return {
    ok: false as const,
    kind: "browser" as const,
    code: "blooket-browser-failed" as const,
  };
}
