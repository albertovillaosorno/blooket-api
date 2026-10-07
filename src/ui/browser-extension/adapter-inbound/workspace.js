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
//   - Automatic workspace capability announcements from an isolated page.
// - Must-Not:
//   - Publish secrets to page scripts, external origins, logs, or AI tools.
// - Allows:
//   - Inputs: A bounded bootstrap from the page's admitted loopback origin.
//   - Outputs: A private runtime message containing only connection fields.
//   - Side effects: Local reads, worker messages, and a bounded polling timer.
// - Split-When:
//   - Workspace discovery needs a different browser transport.
// - Merge-When:
//   - Workspace connections no longer need page-local discovery.
// - Summary:
//   - Connects the extension without user-entered addresses or tokens.
// - Description:
//   - Uses the extension's isolated context and a fixed same-origin route.
// - Usage:
//   - Inject only into admitted local workspace pages.
// - Defaults:
//   - Foreign pages and unsupported application capsules are ignored.
//
(() => {
  if (globalThis.blooketWorkspaceRelay) return;
  if (
    location.protocol !== "http:" ||
    location.pathname !== "/" ||
    !["127.0.0.1", "127.0.0.2"].includes(location.hostname)
  )
    return;
  globalThis.blooketWorkspaceRelay = true;
  let active = false;
  async function announce() {
    if (active) return;
    active = true;
    try {
      const response = await fetch("/api/bootstrap", {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      let text = "",
        size = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 1_000_000) return;
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel();
      }
      const bridge = JSON.parse(text).browserBridge;
      if (
        bridge?.application !== "blooket-api" ||
        bridge.schemaVersion !== 1 ||
        typeof bridge.token !== "string" ||
        !/^[a-zA-Z0-9_-]{43}$/u.test(bridge.token)
      )
        return;
      await chrome.runtime.sendMessage({
        kind: "workspace-ready",
        origin: location.origin,
        token: bridge.token,
      });
    } catch {
      /* The local page may start before its service is available. */
    } finally {
      active = false;
    }
  }
  void announce();
  setInterval(() => {
    void announce();
  }, 10000);
})();
