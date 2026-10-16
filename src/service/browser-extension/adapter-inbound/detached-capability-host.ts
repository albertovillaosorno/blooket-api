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
import { classifyBlooketReadTabLoad } from "./read-navigation.ts";

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
  const started = now();
  if (!Number.isFinite(started)) return failed();
  // Include background-tab loading and capability inspection under the
  // same deadline; the localhost bridge expects a bounded read reply.
  const deadline = started + 8_000;
  let tabId: number | undefined;
  let completed = false;
  let result: ExtensionCapabilityInspectionResult = failed();
  try {
    const created = await chrome.tabs.create({ url: MY_SETS, active: false });
    if (!Number.isSafeInteger(created.id) || created.id! < 1)
      return failed();
    tabId = created.id;
    // The capability host still performs its own native document checks;
    // this outer probe never assumes a complete tab means hydrated content.
    let ready = false;
    for (let poll = 0; poll < 50 && now() - started < 3_000; poll++) {
      const tab = await chrome.tabs.get(tabId!);
      const load = classifyBlooketReadTabLoad(tab, MY_SETS);
      if (load === "changed") return failed();
      if (load === "ready") { ready = true; break; }
      await pause(50);
    }
    if (!ready || now() - started >= 3_000) return failed();
    const host = createExtensionCapabilityInspectionHost(
      chrome, tabId!, pause, now,
    );
    result = await host.inspect({ textOnly, deadline });
    if (now() >= deadline) return failed();
  } catch { return failed(); }
  finally {
    if (tabId !== undefined) {
      try { await chrome.tabs.remove(tabId); completed = true; }
      catch { /* An orphaned read tab never confirms a capability. */ }
    }
  }
  return completed ? result : failed();
}
