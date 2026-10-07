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
//   - Local manual check state, cancellation, and request coalescing.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Current product version, host target, and cancellation.
//   - Outputs: Validated release candidates or bounded failure statuses.
//   - Side effects: Explicit manual reads through the admitted catalog adapter.
// - Split-When:
//   - Trusted manifests add an independent installation contract.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Selects final public candidates without claiming installation trust.
// - Description:
//   - Rejects malformed metadata, foreign assets, and future releases.
// - Usage:
//   - Use local status and explicit manual checks only.
// - Defaults:
//   - Startup is offline and no check runs until explicitly requested.
//
import { PRODUCT_VERSION } from
  "../../../ir/product-version/contract/version.ts";
import {
  checkPublicUpdates,
  type UpdateCheckResult,
} from "../../../platforms/github-updates/adapter-outbound/catalog.ts";

export const MANUAL_CHECK_INTERVAL_MS = 30_000;
export interface UpdateStatus {
  readonly currentVersion: string;
  readonly phase: "idle" | "checking";
  readonly checkedAt: string | null;
  readonly nextCheckAt: string | null;
  readonly result: UpdateCheckResult | null;
}
export interface ApplicationUpdateChecker {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  close(): void;
}

// Test/composition options are trusted dependencies, never HTTP/MCP arguments.
export function createApplicationUpdateChecker(
  options: {
    readonly target?: string;
    readonly now?: () => Date;
    readonly check?: typeof checkPublicUpdates;
  } = {},
): ApplicationUpdateChecker {
  const target = options.target ?? `${process.platform}-${process.arch}`;
  const now = options.now ?? (() => new Date());
  const checkCatalog = options.check ?? checkPublicUpdates;
  let state: UpdateStatus = {
    currentVersion: PRODUCT_VERSION,
    phase: "idle",
    checkedAt: null,
    nextCheckAt: null,
    result: null,
  };
  let pending: Promise<UpdateStatus> | null = null;
  let controller: AbortController | null = null;
  let closed = false;
  const status = () => structuredClone(state);

  async function perform(): Promise<UpdateStatus> {
    const requestController = new AbortController();
    controller = requestController;
    state = { ...state, phase: "checking" };
    let result: UpdateCheckResult;
    const cancelled = new Promise<UpdateCheckResult>((resolve) => {
      requestController.signal.addEventListener(
        "abort",
        () =>
          resolve({
            status: "source-unavailable",
            reason: "cancelled",
          }),
        { once: true },
      );
    });
    try {
      result = await Promise.race([
        checkCatalog({
          currentVersion: PRODUCT_VERSION,
          target,
          now: now(),
          signal: requestController.signal,
        }),
        cancelled,
      ]);
    } catch {
      result = { status: "source-unavailable", reason: "network" };
    }
    controller = null;
    const checked = now();
    const retrySeconds =
      result.status === "source-unavailable"
        ? (result.retryAfterSeconds ?? 0)
        : 0;
    state = {
      currentVersion: PRODUCT_VERSION,
      phase: "idle",
      checkedAt: checked.toISOString(),
      nextCheckAt: new Date(
        checked.getTime() +
          Math.max(MANUAL_CHECK_INTERVAL_MS, retrySeconds * 1_000),
      ).toISOString(),
      result,
    };
    return status();
  }

  return {
    status,
    check() {
      if (pending) return pending;
      if (closed) return Promise.resolve(status());
      if (state.nextCheckAt && now().getTime() < Date.parse(state.nextCheckAt))
        return Promise.resolve(status());
      pending = perform().finally(() => {
        pending = null;
      });
      return pending;
    },
    close() {
      closed = true;
      controller?.abort();
    },
  };
}
