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
//   - Outputs: The confirmed complete tab or an unverified result.
//   - Side effects: At most one requested tab navigation and bounded polling.
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
  now: () => number = Date.now,
): Promise<ReadTab | undefined> {
  const deadline = Math.min(readDeadline, now() + NAVIGATION_BUDGET_MS);
  if (now() >= deadline) return undefined;
  if (target && previous.url !== target) {
    // The caller's previous tab snapshot may be obsolete if the user moved.
    // Re-check its exact route before allowing a navigation request.
    const current = await tabs.get(tabId);
    if (now() >= deadline ||
        (current.url !== previous.url && current.url !== target))
      return undefined;
    if (current.url !== target) {
      await tabs.update(tabId, { url: target });
      if (now() >= deadline) return undefined;
    }
  }
  while (now() < deadline) {
    const tab = await tabs.get(tabId);
    // A delayed tabs.get result cannot prove that the budget was respected.
    if (now() >= deadline) return undefined;
    if (tab.status === "complete" && (!target || tab.url === target))
      return tab;
    await pause(Math.min(POLL_MS, deadline - now()));
  }
  return undefined;
}
