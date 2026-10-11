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
  readonly status?: string;
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
): Promise<ReadTab | undefined> {
  const deadline = Math.min(readDeadline, now() + NAVIGATION_BUDGET_MS);
  if (now() >= deadline) return undefined;
  let previousOrigin: number | undefined;
  if (target) {
    // The caller's previous tab snapshot may be obsolete if the user moved.
    // Re-check its exact route before allowing a navigation request.
    const current = await tabs.get(tabId);
    if (now() >= deadline || !current.url ||
        current.url !== previous.url || current.status !== "complete")
      return undefined;
    const origin = await documentOrigin(current.url);
    if (now() >= deadline || !validOrigin(origin) ||
        (approvedSourceOrigin !== undefined &&
         origin !== approvedSourceOrigin)) return undefined;
    previousOrigin = origin;
    const checked = await tabs.get(tabId);
    if (now() >= deadline || checked.url !== current.url ||
        checked.status !== "complete") return undefined;
    // A same-URL document replacement after the first origin script may
    // contain a teacher's new unsaved work. Do not reload or leave it.
    const originAgain = await documentOrigin(current.url);
    if (now() >= deadline || originAgain !== previousOrigin)
      return undefined;
    if (current.url === target) {
      await tabs.reload(tabId, { bypassCache: true });
    } else {
      await tabs.update(tabId, { url: target });
    }
    if (now() >= deadline) return undefined;
  }
  while (now() < deadline) {
    const tab = await tabs.get(tabId);
    // A delayed tabs.get result cannot prove that the budget was respected.
    if (now() >= deadline) return undefined;
    if (tab.status === "complete" && (!target || tab.url === target)) {
      if (!target) return tab;
      // Chrome may still report the old complete document immediately after
      // reload/update. Only a changed native document epoch admits a read.
      let origin: unknown;
      try { origin = await documentOrigin(target); }
      catch { origin = null; }
      if (now() >= deadline) return undefined;
      if (validOrigin(origin) && origin !== previousOrigin) {
        const checked = await tabs.get(tabId);
        if (now() >= deadline || checked.url !== target ||
            checked.status !== "complete") return undefined;
        return checked;
      }
    }
    await pause(Math.min(POLL_MS, deadline - now()));
  }
  return undefined;
}

function validOrigin(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
