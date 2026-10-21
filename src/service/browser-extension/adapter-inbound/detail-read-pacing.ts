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
//   - Serial admission and spacing of native Edit Info and write actions.
// - Must-Not:
//   - Retry provider actions, extend deadlines, or authorize mutations.
// - Allows:
//   - Inputs: A monotonic clock, bounded wait, and remaining action budget.
//   - Outputs: An exclusive release callback or unavailable admission.
//   - Side effects: One bounded cooldown wait per admission.
// - Split-When:
//   - Another provider needs a different read-action policy.
// - Merge-When:
//   - All provider read actions share the same proven pacing contract.
// - Summary:
//   - Prevents repeated read-only server actions from arriving in a burst.
// - Description:
//   - Cooldown starts after release, including failed read attempts.
// - Usage:
//   - Share one pacer across read/write jobs; release in a finally block.
// - Defaults:
//   - Five seconds is a conservative local policy, not a provider limit.
//
export function createDetailReadPacer(ports: {
  readonly now: () => number;
  readonly wait: (milliseconds: number) => Promise<void>;
}) {
  let occupied = false;
  let nextAt = 0;
  let observedAt = 0;
  const now = (): number | undefined => {
    try {
      const value = ports.now();
      if (!Number.isFinite(value) || value < observedAt || value < 0) {
        return undefined;
      }
      observedAt = value;
      return value;
    } catch {
      return undefined;
    }
  };
  return async (remaining: () => number) => {
    if (occupied) return undefined;
    occupied = true;
    let admitted = false;
    try {
      const started = now();
      if (started === undefined) return undefined;
      const delay = Math.max(0, Math.ceil(nextAt - started));
      const budget = remaining();
      if (!Number.isFinite(delay) || !Number.isFinite(budget) ||
          budget <= 0 || delay >= budget) return undefined;
      if (delay > 0) await ports.wait(delay);
      const checked = now();
      const left = remaining();
      if (checked === undefined || checked < nextAt ||
          !Number.isFinite(left) || left <= 0) return undefined;
      admitted = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        // A failed clock on release cannot strand the exclusive lease or
        // silently erase provider pacing. Refuse future native actions.
        const finished = now();
        nextAt = finished === undefined ? Infinity : finished + 5_000;
        occupied = false;
      };
    } finally {
      if (!admitted) occupied = false;
    }
  };
}
