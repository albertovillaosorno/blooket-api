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
      await previous;
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

export interface BlooketMutationTaskBudgetPolicy {
  readonly maximumStarts: number;
  readonly maximumDurationMs: number;
}

export interface BlooketMutationTaskBudgetState {
  readonly version: 1;
  readonly startedAtMs: number;
  readonly starts: number;
}

export type BlooketMutationTaskBudgetResult =
  | {
      readonly ok: true;
      readonly state: BlooketMutationTaskBudgetState;
    }
  | {
      readonly ok: false;
      readonly code:
        | "mutation-task-start-budget-exhausted"
        | "mutation-task-duration-exhausted"
        | "mutation-task-budget-invalid";
    };

export function admitBlooketMutationTaskStart(
  candidate: unknown,
  policy: BlooketMutationTaskBudgetPolicy,
  nowMs: number,
): BlooketMutationTaskBudgetResult {
  if (!validTaskBudgetPolicy(policy) || !safeTimestamp(nowMs))
    return { ok: false, code: "mutation-task-budget-invalid" };
  const decoded = decodeTaskBudgetState(candidate);
  if (decoded === undefined)
    return { ok: false, code: "mutation-task-budget-invalid" };
  const state = decoded ?? { version: 1, startedAtMs: nowMs, starts: 0 };
  if (nowMs < state.startedAtMs)
    return { ok: false, code: "mutation-task-budget-invalid" };
  if (nowMs - state.startedAtMs >= policy.maximumDurationMs)
    return { ok: false, code: "mutation-task-duration-exhausted" };
  if (state.starts >= policy.maximumStarts)
    return { ok: false, code: "mutation-task-start-budget-exhausted" };
  return {
    ok: true,
    state: { ...state, starts: state.starts + 1 },
  };
}

export function decodeBlooketMutationTaskBudgetState(
  candidate: unknown,
): BlooketMutationTaskBudgetState | null | undefined {
  return decodeTaskBudgetState(candidate);
}

function decodeTaskBudgetState(
  candidate: unknown,
): BlooketMutationTaskBudgetState | null | undefined {
  if (candidate === null) return null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return undefined;
  const value = candidate as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "startedAtMs" ||
    keys[1] !== "starts" ||
    keys[2] !== "version" ||
    value["version"] !== 1 ||
    !safeTimestamp(value["startedAtMs"]) ||
    !Number.isSafeInteger(value["starts"]) ||
    (value["starts"] as number) < 0
  )
    return undefined;
  return {
    version: 1,
    startedAtMs: value["startedAtMs"] as number,
    starts: value["starts"] as number,
  };
}

function validTaskBudgetPolicy(
  policy: BlooketMutationTaskBudgetPolicy,
): boolean {
  return (
    Number.isSafeInteger(policy.maximumStarts) &&
    policy.maximumStarts >= 1 &&
    policy.maximumStarts <= 10_000 &&
    Number.isSafeInteger(policy.maximumDurationMs) &&
    policy.maximumDurationMs >= 1_000 &&
    policy.maximumDurationMs <= 86_400_000
  );
}

function safeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
