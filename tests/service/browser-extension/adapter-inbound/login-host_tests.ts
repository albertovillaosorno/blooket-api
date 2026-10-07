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
//   - Synthetic host coverage for one explicit Blooket login submission.
// - Must-Not:
//   - Contact Blooket, retain fixture credentials, or infer login success.
// - Allows:
//   - Inputs: Synthetic tab state and page-helper replies.
//   - Outputs: Exact preparation/poll/submit and fail-closed assertions.
//   - Side effects: In-memory script-call tracking only.
// - Split-When:
//   - Another browser gains distinct authentication mechanics.
// - Merge-When:
//   - Session authentication no longer needs extension orchestration.
// - Summary:
//   - Proves the host clicks once only after exact prepared-state verification.
// - Description:
//   - The returned success means submit admitted, never authentication proven.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Foreign pages and malformed script replies fail before submission.
//
import assert from "node:assert/strict";
import test from "node:test";

import { createExtensionSessionAuthenticationHost } from
  "../../../../src/service/browser-extension/adapter-inbound/login-host.ts";

const credentials = {
  loginIdentifier: "teacher@example.test",
  password: "synthetic-password",
};

function fixture(options: {
  readonly url?: string;
  readonly preparedPolls?: readonly boolean[];
  readonly prepareReply?: unknown;
  readonly submitReply?: unknown;
}) {
  const calls: string[] = [];
  const argumentsSeen: unknown[] = [];
  const polls = [...(options.preparedPolls ?? [true])];
  const chrome = {
    tabs: {
      get: async () => ({
        url: options.url ?? "https://id.blooket.com/login",
        status: "complete",
      }),
    },
    scripting: {
      executeScript: async (request: {
        readonly func: (...args: never[]) => unknown;
        readonly args?: unknown[];
      }) => {
        const args = request.args ?? [];
        const action = args[0];
        calls.push(String(action));
        argumentsSeen.push(...args);
        switch (action) {
          case "prepare":
            return [{ result: options.prepareReply ?? { ok: true } }];
          case "is-prepared":
            return [{ result: polls.shift() ?? false }];
          case "submit":
            return [{ result: options.submitReply ?? { ok: true } }];
          default:
            throw new Error("unexpected-script");
        }
      },
    },
  };
  return { chrome, calls, argumentsSeen };
}

test("host prepares verifies and submits exactly once", async () => {
  const page = fixture({ preparedPolls: [false, true] });
  const host = createExtensionSessionAuthenticationHost(
    page.chrome,
    7,
    async () => undefined,
  );
  const result = await host.authenticate(credentials);
  assert.deepEqual(result, { ok: true, value: null });
  assert.deepEqual(page.calls, [
    "prepare",
    "is-prepared",
    "is-prepared",
    "submit",
  ]);
  assert.equal(page.calls.filter((name) => name === "submit").length, 1);
  assert.equal(JSON.stringify(result).includes(credentials.password), false);
});

test(
  "host refuses foreign tabs before passing credentials to scripts",
  async () => {
  const page = fixture({ url: "https://dashboard.blooket.com/my-sets" });
  const result = await createExtensionSessionAuthenticationHost(
    page.chrome,
    7,
    async () => undefined,
  ).authenticate(credentials);
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.deepEqual(page.calls, []);
  assert.deepEqual(page.argumentsSeen, []);
  },
);

test(
  "host never submits after malformed preparation or stale controls",
  async () => {
  for (const page of [
    fixture({ prepareReply: { ok: true, extra: true } }),
    fixture({ preparedPolls: Array.from({ length: 15 }, () => false) }),
  ]) {
    const result = await createExtensionSessionAuthenticationHost(
      page.chrome,
      7,
      async () => undefined,
    ).authenticate(credentials);
    assert.equal(result.ok, false);
    assert.equal(page.calls.includes("submit"), false);
  }
  },
);
