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
import test from "node:test";
import assert from "node:assert/strict";
import {
  createApplicationUpdateChecker,
  MANUAL_CHECK_INTERVAL_MS,
} from "../../../../src/api/application-updates/application/checker.ts";
import { PRODUCT_VERSION } from
  "../../../../src/ir/product-version/contract/version.ts";
import type { UpdateCheckResult } from
  "../../../../src/platforms/github-updates/adapter-outbound/catalog.ts";

const start = Date.parse("2026-10-07T00:00:00Z");
test(
  "manual checks stay offline at startup, coalesce, and cool down",
  async () => {
  let clock = start;
  let calls = 0;
  let finish: (result: UpdateCheckResult) => void = () => {};
  const checker = createApplicationUpdateChecker({
    target: "darwin-arm64",
    now: () => new Date(clock),
    check: async (options) => {
      calls++;
      assert.equal(options.currentVersion, PRODUCT_VERSION);
      assert.equal(options.target, "darwin-arm64");
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(checker.status(), {
    currentVersion: PRODUCT_VERSION,
    phase: "idle",
    checkedAt: null,
    nextCheckAt: null,
    result: null,
  });
  const first = checker.check();
  assert.equal(checker.status().phase, "checking");
  assert.equal(checker.check(), first);
  finish({ status: "current", skippedTags: 0 });
  const result = await first;
  assert.equal(result.phase, "idle");
  assert.equal(result.checkedAt, new Date(clock).toISOString());
  assert.equal(calls, 1);
  assert.deepEqual(await checker.check(), result);
  assert.equal(calls, 1);
  // A consumer cannot mutate the cached status.
  const copy = checker.status() as { result: { status: string } };
  copy.result.status = "altered";
  assert.equal(checker.status().result?.status, "current");
  clock += MANUAL_CHECK_INTERVAL_MS;
  const second = checker.check();
  finish({ status: "current", skippedTags: 0 });
  await second;
  assert.equal(calls, 2);
  checker.close();
  clock += MANUAL_CHECK_INTERVAL_MS;
  await checker.check();
  assert.equal(calls, 2);
});

test(
  "manual status preserves failures and honors server retry instructions",
  async () => {
  let clock = start;
  let calls = 0;
  const checker = createApplicationUpdateChecker({
    now: () => new Date(clock),
    check: async () => {
      calls++;
      return {
        status: "source-unavailable",
        reason: "http",
        httpStatus: 429,
        retryAfterSeconds: 3600,
      };
    },
  });
  const failure = await checker.check();
  assert.equal(failure.result?.status, "source-unavailable");
  assert.equal(failure.nextCheckAt, new Date(clock + 3_600_000).toISOString());
  clock += MANUAL_CHECK_INTERVAL_MS;
  await checker.check();
  assert.equal(calls, 1);
  clock = start + 3_600_000;
  await checker.check();
  assert.equal(calls, 2);
  checker.close();
  const throwing = createApplicationUpdateChecker({
    check: async () => {
      throw new Error("do not expose raw adapter details");
    },
  });
  assert.deepEqual((await throwing.check()).result, {
    status: "source-unavailable",
    reason: "network",
  });
  throwing.close();
});

test(
  "close cancels a hanging check without resetting it to no updates",
  async () => {
  let signal: AbortSignal | undefined;
  const checker = createApplicationUpdateChecker({
    check: async (options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  const pending = checker.check();
  checker.close();
  assert.equal(signal?.aborted, true);
  assert.deepEqual((await pending).result, {
    status: "source-unavailable",
    reason: "cancelled",
  });
  assert.equal(checker.status().phase, "idle");
});
