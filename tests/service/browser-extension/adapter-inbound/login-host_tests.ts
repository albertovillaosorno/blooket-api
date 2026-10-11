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
  readonly preparedPolls?: readonly unknown[];
  readonly nextUrlAfterPoll?: string;
  readonly prepareReply?: unknown;
  readonly submitReply?: unknown;
  readonly readLatencyMs?: number;
  readonly scriptLatencyMs?: number;
  readonly nextUrlAfterPrepare?: string;
  readonly reloadAfterAction?: "prepare" | "is-prepared";
  readonly nativeOrigin?: number | null;
}) {
  const calls: string[] = [];
  const argumentsSeen: unknown[] = [];
  const polls = [...(options.preparedPolls ?? [true])];
  let tick = 0;
  let url = options.url ?? "https://id.blooket.com/login";
  let origin = options.nativeOrigin === undefined
    ? 1_000 : options.nativeOrigin;
  let reloaded = false;
  const chrome = {
    tabs: {
      get: async () => {
        tick += options.readLatencyMs ?? 0;
        return { url, status: "complete" };
      },
    },
    scripting: {
      executeScript: async (request: {
        readonly func: (...args: never[]) => unknown;
        readonly args?: unknown[];
      }) => {
        const args = request.args ?? [];
        if (request.func.name === "inspectBlooketSessionDocumentOrigin") {
          assert.deepEqual(args, [url]);
          return [{ result: origin }];
        }
        const action = args[0];
        if (!reloaded && options.reloadAfterAction === action) {
          reloaded = true;
          origin = 2_000;
        }
        calls.push(String(action));
        argumentsSeen.push(...args);
        tick += options.scriptLatencyMs ?? 0;
        switch (action) {
          case "prepare":
            if (options.nextUrlAfterPrepare)
              url = options.nextUrlAfterPrepare;
            return [{ result: options.prepareReply ?? { ok: true } }];
          case "is-prepared": {
            if (options.nextUrlAfterPoll)
              url = options.nextUrlAfterPoll;
            const observed = polls.shift();
            return [{ result: observed === undefined ? false : observed }];
          }
          case "submit":
            return [{ result: options.submitReply ?? { ok: true } }];
          default:
            throw new Error("unexpected-script");
        }
      },
    },
  };
  return { chrome, calls, argumentsSeen, now: () => tick };
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

test(
  "slow initial tab inspection never passes credentials to page scripts",
  async () => {
  const page = fixture({ readLatencyMs: 7_100 });
  const result = await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => {}, page.now,
  ).authenticate(credentials);
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.deepEqual(page.calls, []);
  assert.deepEqual(page.argumentsSeen, []);
  },
);

test("overdue login preparation never polls or submits", async () => {
  const page = fixture({ scriptLatencyMs: 7_100 });
  const result = await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => {}, page.now,
  ).authenticate(credentials);
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.deepEqual(page.calls, ["prepare"]);
});

test("a changed tab after preparation is never submitted", async () => {
  const page = fixture({
    nextUrlAfterPrepare: "https://id.blooket.com/something-else",
  });
  const result = await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => {}, page.now,
  ).authenticate(credentials);
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.calls.includes("submit"), false);
});

test("polling consumes the shared login deadline", async () => {
  const page = fixture({
    scriptLatencyMs: 600,
    preparedPolls: Array.from({ length: 15 }, () => false),
  });
  const result = await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async (ms) => {
      // The clock moves through page scripts; pauses need not contribute.
      void ms;
    }, page.now,
  ).authenticate(credentials);
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.calls.includes("submit"), false);
  assert.ok(page.calls.length < 16);
});

test(
  "login polling rejects non-boolean observations without a retry",
  async () => {
  const page = fixture({ preparedPolls: ["true", true] });
  const result = await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => {}, page.now,
  ).authenticate(credentials);
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.deepEqual(page.calls, ["prepare", "is-prepared"]);
  },
);

test(
  "a tab switch after prepared-state observation never submits",
  async () => {
  const page = fixture({
    nextUrlAfterPoll: "https://id.blooket.com/security-verification",
  });
  const result = await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => {}, page.now,
  ).authenticate(credentials);
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.calls.includes("submit"), false);
  },
);

test(
  "a tab switched after a pending login poll receives no more credentials",
  async () => {
  const page = fixture({
    preparedPolls: [false, true],
    nextUrlAfterPoll: "https://id.blooket.com/security-verification",
  });
  const result = await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => {}, page.now,
  ).authenticate(credentials);
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.deepEqual(page.calls, ["prepare", "is-prepared"]);
  assert.equal(page.calls.includes("submit"), false);
  },
);

test("same-route identity reload cannot receive another credential step",
  async () => {
  for (const phase of ["prepare", "is-prepared"] as const) {
    const page = fixture({ reloadAfterAction: phase });
    const result = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async () => {}, page.now,
    ).authenticate(credentials);
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.calls.includes("submit"), false);
    assert.deepEqual(page.calls, phase === "prepare"
      ? ["prepare"] : ["prepare", "is-prepared"]);
    assert.equal(JSON.stringify(result).includes(credentials.password), false);
  }
  },
);

test("invalid native identity-origin evidence blocks credential delivery",
  async () => {
  for (const nativeOrigin of [null, 0, -1, NaN, Infinity]) {
    const page = fixture({ nativeOrigin });
    const result = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async () => {}, page.now,
    ).authenticate(credentials);
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.deepEqual(page.calls, []);
    assert.deepEqual(page.argumentsSeen, []);
  }
  },
);
