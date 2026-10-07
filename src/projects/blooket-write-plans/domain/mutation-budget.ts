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
//   - Versioned mutation-attempt and task-duration budget state.
// - Must-Not:
//   - Sleep, persist files, execute writes, or infer provider limits.
// - Allows:
//   - Inputs: Unknown state, bounded policy, and explicit current timestamp.
//   - Outputs: Next admitted state or a stable budget refusal.
//   - Side effects: None.
// - Split-When:
//   - Provider-specific quotas require independent budget contracts.
// - Merge-When:
//   - Resumable write plans no longer use task-level mutation budgets.
// - Summary:
//   - Counts attempted mutation starts without inventing restart progress.
// - Description:
//   - State is serializable so a durable adapter can persist it before writes.
// - Usage:
//   - Admit and persist the returned state before opening a mutation journal.
// - Defaults:
//   - Clock rollback, malformed state, and unsafe policies fail closed.
//
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
  const decoded = decodeBlooketMutationTaskBudgetState(candidate);
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
