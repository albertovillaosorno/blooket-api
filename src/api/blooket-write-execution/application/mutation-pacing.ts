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
//   - In-process serialization and conservative start pacing for Blooket
//     writes.
// - Must-Not:
//   - Persist progress, retry mutations, identify accounts, or confirm writes.
// - Allows:
//   - Inputs: Conservative pacing policy, clock, sleep, and cancellation
//     signal.
//   - Outputs: One exclusive mutation-start lease or cancellation.
//   - Side effects: Bounded waits before a mutation lease is granted.
// - Split-When:
//   - Multiple accounts require independently keyed queues.
// - Merge-When:
//   - Provider mutation pacing becomes a durable scheduler primitive.
// - Summary:
//   - Prevents parallel starts and enforces 2s / 20-per-minute defaults.
// - Description:
//   - Durable journals remain authoritative for ambiguity and recovery.
// - Usage:
//   - Acquire before journaling the mutation window; release after the attempt.
// - Defaults:
//   - Configuration may only make the default pacing more conservative.
//
export interface BlooketMutationPacingPolicy {
  readonly minimumStartIntervalMs: number;
  readonly maximumStartsPerMinute: number;
}

export const DEFAULT_BLOOKET_MUTATION_PACING: BlooketMutationPacingPolicy = {
  minimumStartIntervalMs: 2_000,
  maximumStartsPerMinute: 20,
};

export interface BlooketMutationLease {
  readonly startedAtMs: number;
  release(): void;
}

export type BlooketMutationLeaseResult =
  | { readonly ok: true; readonly lease: BlooketMutationLease }
  | { readonly ok: false; readonly code: "mutation-pacing-cancelled" };

export interface BlooketMutationPacer {
  acquire(signal?: AbortSignal): Promise<BlooketMutationLeaseResult>;
}

export interface BlooketMutationPacingRuntime {
  readonly now: () => number;
  readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const WINDOW_MS = 60_000;

export function createBlooketMutationPacer(
  policy: BlooketMutationPacingPolicy = DEFAULT_BLOOKET_MUTATION_PACING,
  runtime: BlooketMutationPacingRuntime = systemRuntime,
): BlooketMutationPacer {
  validatePolicy(policy);
  let tail: Promise<void> = Promise.resolve();
  let starts: number[] = [];

  return {
    async acquire(signal?: AbortSignal): Promise<BlooketMutationLeaseResult> {
      let releaseSlot!: () => void;
      const slot = new Promise<void>((resolve) => {
        releaseSlot = resolve;
      });
      const previous = tail;
      tail = previous.then(() => slot);
      if (!await waitForTurn(previous, signal)) {
        releaseSlot();
        return cancelled();
      }
      if (signal?.aborted) {
        releaseSlot();
        return cancelled();
      }
      try {
        await waitForStart(policy, runtime, starts, signal);
      } catch (error) {
        releaseSlot();
        if (signal?.aborted || isAbort(error)) return cancelled();
        throw error;
      }
      if (signal?.aborted) {
        releaseSlot();
        return cancelled();
      }
      const startedAtMs = runtime.now();
      starts = pruneStarts(starts, startedAtMs);
      starts.push(startedAtMs);
      let released = false;
      return {
        ok: true,
        lease: {
          startedAtMs,
          release() {
            if (released) return;
            released = true;
            releaseSlot();
          },
        },
      };
    },
  };
}

async function waitForTurn(
  previous: Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  if (!signal) {
    await previous;
    return true;
  }
  // Waiting for another lease must not hold a cancelled caller hostage.
  // Its reserved queue slot is still chained to the incumbent, so an early
  // cancellation cannot permit a later caller to overlap that lease.
  return await new Promise<boolean>((resolve) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      resolve(false);
    };
    signal.addEventListener("abort", aborted, { once: true });
    void previous.then(() => {
      signal.removeEventListener("abort", aborted);
      resolve(!signal.aborted);
    });
  });
}

async function waitForStart(
  policy: BlooketMutationPacingPolicy,
  runtime: BlooketMutationPacingRuntime,
  history: readonly number[],
  signal: AbortSignal | undefined,
): Promise<void> {
  while (true) {
    const now = runtime.now();
    const starts = pruneStarts(history, now);
    const afterInterval = starts.length === 0
      ? now
      : starts[starts.length - 1]! + policy.minimumStartIntervalMs;
    const afterWindow = starts.length < policy.maximumStartsPerMinute
      ? now
      : starts[0]! + WINDOW_MS;
    const waitMs = Math.max(afterInterval, afterWindow) - now;
    if (waitMs <= 0) return;
    await runtime.sleep(waitMs, signal);
  }
}

function pruneStarts(starts: readonly number[], now: number): number[] {
  return starts.filter((startedAt) => startedAt > now - WINDOW_MS);
}

function validatePolicy(policy: BlooketMutationPacingPolicy): void {
  if (
    !Number.isSafeInteger(policy.minimumStartIntervalMs) ||
    policy.minimumStartIntervalMs < 2_000 ||
    policy.minimumStartIntervalMs > WINDOW_MS ||
    !Number.isSafeInteger(policy.maximumStartsPerMinute) ||
    policy.maximumStartsPerMinute < 1 ||
    policy.maximumStartsPerMinute > 20
  )
    throw new Error("invalid-mutation-pacing-policy");
}

function cancelled(): BlooketMutationLeaseResult {
  return { ok: false, code: "mutation-pacing-cancelled" };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

const systemRuntime: BlooketMutationPacingRuntime = {
  now: () => Date.now(),
  sleep: async (milliseconds, signal) => {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const timer = setTimeout(done, milliseconds);
      signal?.addEventListener("abort", aborted, { once: true });
      function done() {
        signal?.removeEventListener("abort", aborted);
        resolve();
      }
      function aborted() {
        clearTimeout(timer);
        reject(abortError());
      }
    });
  },
};

function abortError(): Error {
  const error = new Error("mutation-pacing-cancelled");
  error.name = "AbortError";
  return error;
}
