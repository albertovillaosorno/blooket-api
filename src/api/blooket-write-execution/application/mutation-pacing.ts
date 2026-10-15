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

export const DEFAULT_BLOOKET_MUTATION_PACING: BlooketMutationPacingPolicy =
  Object.freeze({
    minimumStartIntervalMs: 2_000,
    maximumStartsPerMinute: 20,
  });

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

/** Optional durable account-wide admission after in-memory queue pacing. */
export interface BlooketMutationStartGate {
  reserve(policy: BlooketMutationPacingPolicy): Promise<
    | { readonly kind: "admitted" }
    | { readonly kind: "wait"; readonly waitMs: number }
  >;
}

const WINDOW_MS = 60_000;

export function createBlooketMutationPacer(
  policy: BlooketMutationPacingPolicy = DEFAULT_BLOOKET_MUTATION_PACING,
  runtime: BlooketMutationPacingRuntime = systemRuntime,
  durable?: BlooketMutationStartGate,
): BlooketMutationPacer {
  // A later settings change cannot rewrite the policy of an already running
  // queue. Read only exact own data fields; never invoke injected accessors.
  const admittedPolicy = snapshotPolicy(policy);
  let tail: Promise<void> = Promise.resolve();
  let starts: number[] = [];
  // The in-process queue uses one nondecreasing timeline, independent of the
  // durable task budget's wall-clock timestamps. Refuse invalid injected clocks
  // rather than waiting hours after rollback or silently skipping intervals.
  let observedAtMs = 0;
  const clock: BlooketMutationPacingRuntime = {
    now: () => {
      const value = runtime.now();
      if (!Number.isFinite(value) || value < observedAtMs || value < 0)
        throw Error("mutation-pacing-clock-invalid");
      observedAtMs = value;
      return value;
    },
    sleep: runtime.sleep,
  };

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
      let startedAtMs: number;
      try {
        // A new service process loses in-memory timestamps. The optional
        // durable gate owns the account-wide rolling history across restarts.
        // Its reservation is committed before any write journal opens.
        for (let checks = 0;; checks++) {
          if (checks >= 64) throw Error("mutation-pacing-history-unavailable");
          await waitForStart(admittedPolicy, clock, starts, signal);
          if (signal?.aborted) {
            releaseSlot();
            return cancelled();
          }
          if (durable) {
            const admitted = await durable.reserve(admittedPolicy);
            if (!admitted || typeof admitted !== "object" ||
                Array.isArray(admitted))
              throw Error("mutation-pacing-history-unavailable");
            const fields = Reflect.ownKeys(admitted);
            const descriptor = Object.getOwnPropertyDescriptor(
              admitted, "kind");
            if (!descriptor || !descriptor.enumerable ||
                !Object.hasOwn(descriptor, "value"))
              throw Error("mutation-pacing-history-unavailable");
            if (descriptor.value === "wait") {
              const wait = Object.getOwnPropertyDescriptor(
                admitted, "waitMs");
              if (fields.length !== 2 || !wait || !wait.enumerable ||
                  !Object.hasOwn(wait, "value") ||
                  !Number.isSafeInteger(wait.value) || wait.value < 1 ||
                  wait.value > WINDOW_MS)
                throw Error("mutation-pacing-history-unavailable");
              const beforeWaitMs = clock.now();
              await clock.sleep(wait.value, signal);
              if (clock.now() <= beforeWaitMs)
                throw Error("mutation-pacing-clock-invalid");
              continue;
            }
            if (descriptor.value !== "admitted" || fields.length !== 1)
              throw Error("mutation-pacing-history-unavailable");
          }
          startedAtMs = clock.now();
          break;
        }
      } catch (error) {
        releaseSlot();
        if (signal?.aborted || isAbort(error)) return cancelled();
        throw error;
      }
      if (signal?.aborted) {
        releaseSlot();
        return cancelled();
      }
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
  for (let checks = 0; checks < 64; checks++) {
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
    // A custom sleep or unreliable monotonic clock can return before any
    // time passes. Never spin on the same timestamp and starve cancellation.
    if (runtime.now() <= now) throw Error("mutation-pacing-clock-invalid");
  }
  throw Error("mutation-pacing-clock-invalid");
}

function pruneStarts(starts: readonly number[], now: number): number[] {
  return starts.filter((startedAt) => startedAt > now - WINDOW_MS);
}

function snapshotPolicy(
  policy: BlooketMutationPacingPolicy,
): BlooketMutationPacingPolicy {
  const keys = ["minimumStartIntervalMs", "maximumStartsPerMinute"];
  if (!policy || typeof policy !== "object" || Array.isArray(policy) ||
      Reflect.ownKeys(policy).length !== keys.length)
    throw Error("invalid-mutation-pacing-policy");
  const own = keys.map(key =>
    Object.getOwnPropertyDescriptor(policy, key));
  if (own.some(descriptor => !descriptor || !descriptor.enumerable ||
      !("value" in descriptor)))
    throw Error("invalid-mutation-pacing-policy");
  const fixed = Object.freeze({
    minimumStartIntervalMs: own[0]!.value as number,
    maximumStartsPerMinute: own[1]!.value as number,
  });
  validatePolicy(fixed);
  return fixed;
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
  // Wall-clock jumps are handled by the durable task-budget policy. Only
  // elapsed in-process time is relevant to this separate pacing window.
  now: () => performance.now(),
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
