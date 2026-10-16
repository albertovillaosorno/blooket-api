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
//   - Serial admission and spacing of native Edit Info read actions.
// - Must-Not:
//   - Retry provider actions, extend deadlines, or authorize mutations.
// - Allows:
//   - Inputs: A monotonic clock, bounded wait, and remaining read budget.
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
//   - Share one pacer across worker jobs and release in a finally block.
// - Defaults:
//   - Five seconds is a conservative local policy, not a provider limit.
//
export function createDetailReadPacer(ports: {
  readonly now: () => number;
  readonly wait: (milliseconds: number) => Promise<void>;
}) {
  let occupied = false;
  let nextAt = 0;
  return async (remaining: () => number) => {
    if (occupied) return undefined;
    occupied = true;
    let admitted = false;
    try {
      const delay = Math.max(0, Math.ceil(nextAt - ports.now()));
      if (!Number.isFinite(delay) || delay >= remaining()) return undefined;
      if (delay > 0) await ports.wait(delay);
      if (ports.now() < nextAt || remaining() <= 0) return undefined;
      admitted = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        nextAt = ports.now() + 5_000;
        occupied = false;
      };
    } finally {
      if (!admitted) occupied = false;
    }
  };
}
