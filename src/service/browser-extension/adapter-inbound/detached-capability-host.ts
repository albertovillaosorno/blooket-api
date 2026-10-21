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
//   - Temporary, background Blooket capability inspection under an owner.
// - Must-Not:
//   - Navigate the teacher's unsaved editor, submit, or keep a probe tab.
// - Allows:
//   - Inputs: Validated isolated-read owner and a bounded Chrome port.
//   - Outputs: Admitted capability evidence or conservative read failure.
//   - Side effects: Create, inspect, then remove a private temporary tab.
// - Split-When:
//   - Another read operation needs a different independent tab lifecycle.
// - Merge-When:
//   - Native read capabilities no longer need temporary browser tabs.
// - Summary:
//   - Lets publication inspect capabilities without erasing a submitted form.
// - Description:
//   - The browser worker must first bind one original submitted owner.
// - Usage:
//   - Called only from the admitted capabilities bridge read.
// - Defaults:
//   - Any failed cleanup invalidates the otherwise observed capabilities.
//
import {
  createExtensionCapabilityInspectionHost,
  type CapabilityInspectionChromePort,
  type ExtensionCapabilityInspectionResult,
} from "./capability-inspection-host.ts";
import { classifyBlooketReadTabLoad,
  exactCreatedBlooketReadTabId, snapshotBlooketReadTab } from
  "./read-navigation.ts";

interface BrowserTab {
  readonly id?: number;
  readonly url?: string;
  readonly pendingUrl?: string;
  readonly status?: string;
}

export interface DetachedCapabilityChromePort extends
  CapabilityInspectionChromePort {
  readonly tabs: CapabilityInspectionChromePort["tabs"] & {
    create(options: { readonly url: string; readonly active: false }):
      Promise<BrowserTab>;
    remove(id: number): Promise<void>;
  };
}

const MY_SETS = "https://dashboard.blooket.com/my-sets";
const failed = (): ExtensionCapabilityInspectionResult =>
  ({ ok: false, code: "blooket-browser-failed" });

export async function inspectDetachedBlooketCapabilities(
  chrome: DetachedCapabilityChromePort,
  textOnly: boolean,
  pause: (ms: number) => Promise<void>,
  now: () => number = Date.now,
): Promise<ExtensionCapabilityInspectionResult> {
  // Invalid or regressing clock readings cannot prove that a capability
  // inspection completed within the broker lease. Once invalid, the whole
  // temporary read must fail even if later samples appear plausible.
  let lastTick = -Infinity;
  let validClock = true;
  const checkedNow = () => {
    if (!validClock) return Infinity;
    try {
      const tick = now();
      if (!Number.isFinite(tick) || tick < 0 || tick < lastTick) {
        validClock = false;
        return Infinity;
      }
      lastTick = tick;
      return tick;
    } catch { validClock = false; return Infinity; }
  };
  const started = checkedNow();
  if (!Number.isFinite(started)) return failed();
  // Include background-tab loading and capability inspection under the
  // same deadline; the localhost bridge expects a bounded read reply.
  const deadline = started + 8_000;
  if (!Number.isFinite(deadline)) return failed();
  let tabId: number | undefined;
  let completed = false;
  let result: ExtensionCapabilityInspectionResult = failed();
  try {
    const created = await chrome.tabs.create({ url: MY_SETS, active: false });
    tabId = exactCreatedBlooketReadTabId(created);
    if (tabId === undefined) return failed();
    // The capability host still performs its own native document checks;
    // this outer probe never assumes a complete tab means hydrated content.
    let ready = false;
    for (let poll = 0; poll < 50 && checkedNow() - started < 3_000; poll++) {
      const tab = snapshotBlooketReadTab(
        await chrome.tabs.get(tabId!),
      );
      if (!tab) return failed();
      const load = classifyBlooketReadTabLoad(tab, MY_SETS, true);
      if (load === "changed") return failed();
      if (load === "ready") { ready = true; break; }
      await pause(50);
    }
    if (!ready || checkedNow() - started >= 3_000) return failed();
    const host = createExtensionCapabilityInspectionHost(
      chrome, tabId!, pause, checkedNow,
    );
    result = await host.inspect({ textOnly, deadline });
    if (checkedNow() >= deadline) return failed();
  } catch { return failed(); }
  finally {
    if (tabId !== undefined) {
      try { await chrome.tabs.remove(tabId); completed = true; }
      catch { /* An orphaned read tab never confirms a capability. */ }
    }
  }
  return completed ? result : failed();
}
