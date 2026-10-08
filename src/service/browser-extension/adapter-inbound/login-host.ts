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
//   - Chrome orchestration for one explicit Blooket credential submission.
// - Must-Not:
//   - Persist, log, return, retry, or infer credentials or login success.
// - Allows:
//   - Inputs: One dedicated login tab and bounded credential pair.
//   - Outputs: Confirmation that exactly one admitted submit was clicked.
//   - Side effects: Fill the observed login controls and click submit once.
// - Split-When:
//   - Another browser requires materially different host mechanics.
// - Merge-When:
//   - Browser authentication no longer crosses extension orchestration.
// - Summary:
//   - Bridges the exact public login page into the session port.
// - Description:
//   - Authentication success remains owned by the later session observation.
// - Usage:
//   - Invoke only for the admitted session.authenticate bridge command.
// - Defaults:
//   - Foreign pages, stale controls, challenges, and script failures fail
//     closed.
//
import {
  runBlooketLoginPageAction,
  type BlooketLoginPageInput,
} from "../../../platforms/blooket-browser/adapter-outbound/login-page.ts";

interface BrowserTab {
  readonly url?: string;
  readonly status?: string;
}

export interface SessionAuthenticationChromePort {
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

export type ExtensionSessionAuthenticationResult =
  | { readonly ok: true; readonly value: null }
  | {
      readonly ok: false;
      readonly code:
        | "blooket-browser-unavailable"
        | "blooket-browser-failed";
    };

const LOGIN_ORIGIN = "https://id.blooket.com";
const MAX_POLLS = 15;
const POLL_MS = 50;
// Leave room for the broker's ten-second window and result delivery.
const LOGIN_BUDGET_MS = 7_000;

export function createExtensionSessionAuthenticationHost(
  chrome: SessionAuthenticationChromePort,
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
      throw new Error("browser-login-script-failed");
    return replies[0].result;
  };

  return {
    authenticate: async (
      input: BlooketLoginPageInput,
    ): Promise<ExtensionSessionAuthenticationResult> => {
      try {
        const deadline = now() + LOGIN_BUDGET_MS;
        const readyTab = async () => {
          if (now() >= deadline) return false;
          const tab = await chrome.tabs.get(tabId);
          return now() < deadline && exactLoginTab(tab);
        };
        if (!await readyTab()) return browserFailure();
        const prepared = await script(
          runBlooketLoginPageAction as (...args: never[]) => unknown,
          ["prepare", input],
        );
        if (now() >= deadline || !exactOk(prepared) || !await readyTab())
          return browserFailure();
        let ready = false;
        for (let attempt = 0; attempt < MAX_POLLS && now() < deadline;
          attempt++) {
          // Each poll forwards credentials to an injected function. A prior
          // login-tab check cannot authorize a later poll after navigation.
          if (!await readyTab()) return browserFailure();
          const observed = await script(
            runBlooketLoginPageAction as (...args: never[]) => unknown,
            ["is-prepared", input],
          );
          if (now() >= deadline || typeof observed !== "boolean" ||
              !await readyTab())
            return browserFailure();
          ready = observed;
          if (ready) break;
          await pause(Math.min(POLL_MS, deadline - now()));
        }
        if (!ready || !await readyTab()) return browserFailure();
        const submitted = await script(
          runBlooketLoginPageAction as (...args: never[]) => unknown,
          ["submit", input],
        );
        return now() < deadline && exactOk(submitted)
          ? { ok: true, value: null }
          : browserFailure();
      } catch {
        return browserFailure();
      }
    },
  };
}

function exactLoginTab(tab: BrowserTab): boolean {
  if (!tab.url || tab.status !== "complete") return false;
  try {
    const url = new URL(tab.url);
    return url.origin === LOGIN_ORIGIN && url.pathname === "/login";
  } catch {
    return false;
  }
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

function browserFailure(): ExtensionSessionAuthenticationResult {
  return { ok: false, code: "blooket-browser-failed" };
}
