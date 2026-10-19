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
//   - Deadline-bounded Chrome tab navigation before Blooket reads.
// - Must-Not:
//   - Infer authentication, inspect cookies, or wait past the read budget.
// - Allows:
//   - Inputs: One owned tab, optional exact route, and a shared deadline.
//   - Outputs: A complete fresh document or an unverified result.
//   - Side effects: At most one navigation or reload and bounded polling.
// - Split-When:
//   - Another browser requires materially different navigation mechanics.
// - Merge-When:
//   - Session and read hosts share one equivalent navigation primitive.
// - Summary:
//   - Refuses a completed browser tab observed after the read deadline.
// - Description:
//   - Navigation uses the smaller of the local five-second and read budgets.
// - Usage:
//   - Call only after the worker admits the current tab's provider origin.
// - Defaults:
//   - Unknown routes, late browser calls, and incomplete tabs fail closed.
//
interface ReadTab {
  readonly url?: string;
  readonly pendingUrl?: string;
  readonly status?: string;
}

// A tab Create acknowledgement is authority to manage exactly one Chrome ID.
// An accessor cannot substitute a different existing teacher-owned tab.
export function exactCreatedBlooketReadTabId(value: unknown):
  number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "id");
  if (!descriptor?.enumerable || !("value" in descriptor) ||
      !Number.isSafeInteger(descriptor.value) || descriptor.value < 1)
    return undefined;
  return descriptor.value;
}


// Copy Chrome's route fields before using a tab to authorize page scripts.
// Property getters are not a committed browser document observation.
export function snapshotBlooketReadTab(value: unknown):
  ReadTab | undefined {
  if (!value || typeof value !== "object") return undefined;
  const copied: Record<string, string | undefined> = {};
  try {
    for (const key of ["url", "status", "pendingUrl"]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (!descriptor.enumerable || !("value" in descriptor) ||
          (descriptor.value !== undefined &&
           typeof descriptor.value !== "string")) return undefined;
      copied[key] = descriptor.value;
    }
  } catch { return undefined; }
  return copied;
}

// Chrome exposes a new tab's destination as pendingUrl until its first
// navigation commits. Only that exact owned destination may keep loading;
// a different pending URL also invalidates an otherwise matching old URL.
export function classifyBlooketReadTabLoad(
  tab: ReadTab, target: string,
): "ready" | "loading" | "changed" {
  const owned = snapshotBlooketReadTab(tab);
  if (!owned) return "changed";
  tab = owned;
  if (tab.pendingUrl !== undefined)
    return tab.pendingUrl === target && tab.status === "loading" &&
      (tab.url === undefined || tab.url === "" ||
       tab.url === "about:blank" || tab.url === target)
      ? "loading" : "changed";
  if (tab.url === target)
    return tab.status === "complete" ? "ready"
      : tab.status === "loading" ? "loading" : "changed";
  return "changed";
}

interface ReadTabsPort {
  get(tabId: number): Promise<ReadTab>;
  update(tabId: number, options: { url: string }): Promise<ReadTab>;
  reload(tabId: number, options: { bypassCache: true }): Promise<void>;
}

const NAVIGATION_BUDGET_MS = 5_000;
const POLL_MS = 100;

export async function confirmBlooketReadNavigation(
  tabs: ReadTabsPort,
  tabId: number,
  previous: ReadTab,
  target: string | null,
  readDeadline: number,
  pause: (ms: number) => Promise<void>,
  documentOrigin: (url: string) => Promise<unknown>,
  now: () => number = Date.now,
  approvedSourceOrigin?: number,
  onConfirmedTargetOrigin?: (origin: number) => void,
  safeBeforeNavigation?: () => Promise<boolean>,
): Promise<ReadTab | undefined> {
  const deadline = Math.min(readDeadline, now() + NAVIGATION_BUDGET_MS);
  if (now() >= deadline) return undefined;
  previous = snapshotBlooketReadTab(previous) ?? {};
  let previousOrigin: number | undefined;
  if (target) {
    // The caller's previous tab snapshot may be obsolete if the user moved.
    // Re-check its exact route before allowing a navigation request.
    const current = snapshotBlooketReadTab(await tabs.get(tabId));
    if (now() >= deadline || !current?.url ||
        current.url !== previous.url || current.status !== "complete" ||
        current.pendingUrl !== undefined)
      return undefined;
    const origin = await documentOrigin(current.url);
    if (now() >= deadline || !validOrigin(origin) ||
        (approvedSourceOrigin !== undefined &&
         origin !== approvedSourceOrigin)) return undefined;
    previousOrigin = origin;
    const checked = snapshotBlooketReadTab(await tabs.get(tabId));
    if (now() >= deadline || checked?.url !== current.url ||
        checked.status !== "complete" || checked.pendingUrl !== undefined)
      return undefined;
    // A same-URL document replacement after the first origin script may
    // contain a teacher's new unsaved work. Do not reload or leave it.
    const originAgain = await documentOrigin(current.url);
    if (now() >= deadline || originAgain !== previousOrigin)
      return undefined;
    // A teacher can begin changing the already-confirmed document while
    // navigation checks are pending. Recheck the actual editor right before
    // leaving it, not just once at the beginning of the read.
    if (safeBeforeNavigation) {
      if (!await safeBeforeNavigation() || now() >= deadline)
        return undefined;
      const last = snapshotBlooketReadTab(await tabs.get(tabId));
      if (now() >= deadline || last?.url !== current.url ||
          last.status !== "complete" || last.pendingUrl !== undefined)
        return undefined;
      const lastOrigin = await documentOrigin(current.url);
      if (now() >= deadline || lastOrigin !== previousOrigin)
        return undefined;
    }
    if (current.url === target) {
      await tabs.reload(tabId, { bypassCache: true });
    } else {
      await tabs.update(tabId, { url: target });
    }
    if (now() >= deadline) return undefined;
  }
  while (now() < deadline) {
    const tab = snapshotBlooketReadTab(await tabs.get(tabId));
    // A delayed tabs.get result cannot prove that the budget was respected.
    if (now() >= deadline) return undefined;
    if (!tab || (tab.pendingUrl !== undefined &&
        (target === null || tab.pendingUrl !== target))) return undefined;
    if (tab.status === "complete" && tab.pendingUrl === undefined &&
        (!target || tab.url === target)) {
      if (!target) return tab;
      // Chrome may still report the old complete document immediately after
      // reload/update. Only a changed native document epoch admits a read.
      let origin: unknown;
      try { origin = await documentOrigin(target); }
      catch { origin = null; }
      if (now() >= deadline) return undefined;
      if (validOrigin(origin) && origin !== previousOrigin) {
        const checked = snapshotBlooketReadTab(await tabs.get(tabId));
        if (now() >= deadline || checked?.url !== target ||
            checked.status !== "complete" ||
            checked.pendingUrl !== undefined) return undefined;
        // A native document can be replaced at the exact same URL while
        // Chrome resolves tabs.get. Re-observe its epoch before transferring
        // read authority; never adopt the replacement as the old document.
        let again: unknown;
        try { again = await documentOrigin(target); }
        catch { return undefined; }
        if (now() >= deadline || again !== origin) return undefined;
        const finalTab = snapshotBlooketReadTab(await tabs.get(tabId));
        if (now() >= deadline || finalTab?.url !== target ||
            finalTab.status !== "complete" ||
            finalTab.pendingUrl !== undefined) return undefined;
        onConfirmedTargetOrigin?.(origin);
        return finalTab;
      }
    }
    await pause(Math.min(POLL_MS, deadline - now()));
  }
  return undefined;
}

function validOrigin(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
