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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBrowserService } from
  "../../../../src/api/browser-service/adapter-inbound/server.ts";
import { createApplicationUpdateChecker } from
  "../../../../src/api/application-updates/application/checker.ts";

test(
  "update checks are explicit local requests with origin, CSRF, and exact body",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "update-service-"));
  let calls = 0;
  const updates = createApplicationUpdateChecker({
    target: "darwin-arm64",
    check: async () => {
      calls++;
      return { status: "current", skippedTags: 0 };
    },
  });
  const service = await startBrowserService({ root, port: 0, updates });
  try {
    const boot = await (await fetch(service.origin + "/api/bootstrap")).json();
    assert.equal(boot.updates.phase, "idle");
    assert.equal(boot.updates.result, null);
    assert.equal(calls, 0);
    const status = await fetch(service.origin + "/api/update-status");
    assert.deepEqual(await status.json(), boot.updates);
    const post = (body: unknown, headers: Record<string, string>) =>
      fetch(service.origin + "/api/update-check", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const headers = {
      "Content-Type": "application/json",
      Origin: service.origin,
      "X-CSRF-Token": boot.csrf,
    };
    assert.equal((await post({}, {})).status, 403);
    assert.equal(
      (await post({}, { ...headers, Origin: "https://example.test" })).status,
      403,
    );
    assert.equal(
      (await post({}, { ...headers, "X-CSRF-Token": "wrong" })).status,
      403,
    );
    for (const body of [
      null,
      [],
      { url: "https://example.test" },
      { target: "linux-x64" },
      { currentVersion: "26.4.1" },
    ]) {
      const result = await post(body, headers);
      assert.equal(result.status, 400);
      assert.equal((await result.json()).code, "invalid-update-check-request");
    }
    assert.equal(calls, 0);
    const result = await post({}, headers);
    assert.equal(result.status, 200);
    const checked = await result.json();
    assert.deepEqual(checked.result, { status: "current", skippedTags: 0 });
    assert.ok(checked.checkedAt);
    await post({}, headers);
    assert.equal(calls, 1);
    const source = await (await fetch(service.origin + "/")).text();
    assert.ok(source.includes('id="checkUpdates"'));
    assert.ok(source.includes('id="updateState" role="status"'));
  } finally {
    await new Promise<void>((resolve) => {
      service.server.close(() => resolve());
      service.server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "HTTP update failures remain distinct from a successful no-update check",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "update-service-error-"));
  const updates = createApplicationUpdateChecker({
    check: async () => ({
      status: "source-unavailable",
      reason: "timeout",
    }),
  });
  const service = await startBrowserService({ root, port: 0, updates });
  try {
    const boot = await (await fetch(service.origin + "/api/bootstrap")).json();
    const response = await fetch(service.origin + "/api/update-check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: service.origin,
        "X-CSRF-Token": boot.csrf,
      },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, {
      status: "source-unavailable",
      reason: "timeout",
    });
    assert.equal((await fetch(service.origin + "/")).status, 200);
  } finally {
    await new Promise<void>((resolve) => {
      service.server.close(() => resolve());
      service.server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  }
});
