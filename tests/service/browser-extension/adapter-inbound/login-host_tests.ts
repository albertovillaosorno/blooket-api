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
  readonly scriptFrameId?: number;
  readonly scriptFrameGetter?: boolean;
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
        const frame = (result: unknown): { readonly result: unknown } => {
          const item = { result } as { result: unknown; frameId?: number };
          if (options.scriptFrameId !== undefined)
            item.frameId = options.scriptFrameId;
          if (options.scriptFrameGetter)
            Object.defineProperty(item, "frameId", { enumerable: true,
              get() { throw new Error("frame accessor must not run"); },
            });
          return item;
        };
        if (request.func.name === "inspectBlooketSessionDocumentOrigin") {
          assert.deepEqual(args, [url]);
          return [frame(origin)];
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
            return [frame(options.prepareReply ?? { ok: true })];
          case "is-prepared": {
            if (options.nextUrlAfterPoll)
              url = options.nextUrlAfterPoll;
            const observed = polls.shift();
            return [frame(observed === undefined ? false : observed)];
          }
          case "submit":
            return [frame(options.submitReply ?? { ok: true })];
          default:
            throw new Error("unexpected-script");
        }
      },
    },
  };
  return { chrome, calls, argumentsSeen, now: () => tick };
}

test("invalid or regressed login clocks never submit credentials",
  async () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const page = fixture({});
    const result = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async () => {}, () => invalid,
    ).authenticate(credentials);
    assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
    assert.equal(page.calls.includes("submit"), false);
  }
  for (const invalid of [Number.NaN, 900]) {
    const page = fixture({});
    let samples = 0;
    const result = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async () => {},
      () => ++samples < 17 ? 1_000 : invalid,
    ).authenticate(credentials);
    assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
    assert.equal(page.calls.includes("submit"), false,
      "a clock failure after form preparation must prevent credential submit");
  }
});

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

test("login refuses query or fragment redirects before credential scripts",
  async () => {
  for (const suffix of ["?next=https://foreign.invalid/", "#redirect",
    "?provider=other#redirect"]) {
    const page = fixture({ url: "https://id.blooket.com/login" + suffix });
    const result = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async () => undefined,
    ).authenticate(credentials);
    assert.equal(result.ok, false, suffix);
    assert.deepEqual(page.calls, [], suffix);
    assert.deepEqual(page.argumentsSeen, [], suffix);
  }
});

test("login never trusts tab URL getters with credentials", async () => {
  const page = fixture({});
  let reads = 0;
  const get = page.chrome.tabs.get;
  page.chrome.tabs.get = async () => {
    const tab = { ...await get() };
    Object.defineProperty(tab, "url", { enumerable: true,
      get() { reads++; return "https://id.blooket.com/login"; },
    });
    return tab;
  };
  const result = await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => undefined,
  ).authenticate(credentials);
  assert.equal(result.ok, false);
  assert.equal(reads, 0);
  assert.deepEqual(page.argumentsSeen, []);
});

test("tab accessors cannot authorize credentials", async () => {
  for (const key of ["status", "pendingUrl"] as const) {
    const page = fixture({});
    let reads = 0;
    const get = page.chrome.tabs.get;
    page.chrome.tabs.get = async () => {
      const tab = { ...await get() };
      Object.defineProperty(tab, key, { enumerable: true,
        get() { reads++; return key === "status" ? "complete" : undefined; },
      });
      return tab;
    };
    const response = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async () => undefined,
    ).authenticate(credentials);
    assert.equal(response.ok, false, key);
    assert.equal(reads, 0, key);
    assert.deepEqual(page.argumentsSeen, [], key);
  }
});

test("login never sends credentials to a pending foreign page", async () => {
  for (const phase of ["initial", "after-prepare", "after-poll"] as const) {
    const page = fixture({});
    let pending = phase === "initial";
    const get = page.chrome.tabs.get;
    page.chrome.tabs.get = async () => ({ ...await get(),
      ...(pending ? { pendingUrl: "https://foreign.invalid/login" } : {}),
    });
    const execute = page.chrome.scripting.executeScript;
    page.chrome.scripting.executeScript = async request => {
      const reply = await execute(request);
      if ((phase === "after-prepare" &&
          request.args?.[0] === "prepare") ||
          (phase === "after-poll" &&
            request.args?.[0] === "is-prepared")) pending = true;
      return reply;
    };
    const result = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async () => undefined,
    ).authenticate(credentials);
    assert.equal(result.ok, false, phase);
    assert.equal(page.calls.includes("submit"), false, phase);
    if (phase === "initial")
      assert.deepEqual(page.argumentsSeen, []);
  }
});

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

test("login never passes an expired or invalid budget to the poll waiter",
  async () => {
  // A previously valid clock can fail at the exact time a sleep duration
  // is calculated, after the preceding successful readiness observation.
  for (let failedSample = 1; failedSample <= 55; failedSample++) {
    const page = fixture({ preparedPolls: Array(15).fill(false) });
    let sample = 0;
    const requested: number[] = [];
    const result = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async ms => { requested.push(ms); },
      () => ++sample === failedSample ? Number.NaN : 0,
    ).authenticate(credentials);
    assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
    assert.equal(page.calls.includes("submit"), false);
    assert.ok(requested.every(ms => Number.isFinite(ms) && ms > 0 &&
      ms <= 50), `bad wait on clock sample ${failedSample}: ${requested}`);
  }
  for (const stride of [35, 90, 140, 250, 350, 500, 650, 900, 1_200]) {
    const page = fixture({ preparedPolls: Array(15).fill(false) });
    let time = 0;
    const requested: number[] = [];
    const result = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async ms => { requested.push(ms); },
      () => (time += stride),
    ).authenticate(credentials);
    assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
    assert.equal(page.calls.includes("submit"), false);
    assert.ok(requested.every(ms => Number.isFinite(ms) && ms > 0 &&
      ms <= 50), `invalid clock budget for stride ${stride}: ${requested}`);
  }
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

test("login host never evaluates accessor-backed Chrome result fields",
  async () => {
    for (const kind of ["getter", "hidden", "absent"] as const) {
      const fake = fixture({});
      let getterCalls = 0;
      const chrome = {
        ...fake.chrome,
        scripting: {
          executeScript: async (request: Parameters<
            typeof fake.chrome.scripting.executeScript
          >[0]) => {
            if (request.func.name !== "inspectBlooketSessionDocumentOrigin")
              return fake.chrome.scripting.executeScript(request);
            const reply: { result?: unknown; frameId?: number } = {
              frameId: 0,
            };
            if (kind !== "absent") Object.defineProperty(reply, "result", {
              configurable: true,
              enumerable: kind !== "hidden",
              ...(kind === "getter"
                ? { get() { getterCalls++; return 1_000; } }
                : { value: 1_000 }),
            });
            return [reply];
          },
        },
      };
      const result = await createExtensionSessionAuthenticationHost(
        chrome, 7, async () => undefined,
      ).authenticate(credentials);
      assert.equal(result.ok, false, kind);
      assert.equal(getterCalls, 0);
      assert.deepEqual(fake.argumentsSeen, []);
      assert.equal(fake.calls.includes("submit"), false);
    }
  },
);

test("login acknowledgement fields must be enumerable data, not getters",
  async () => {
    for (const kind of ["getter", "hidden"] as const) {
      let getterReads = 0;
      const reply: { ok?: boolean } = {};
      Object.defineProperty(reply, "ok", {
        enumerable: kind !== "hidden",
        ...(kind === "getter"
          ? { get() { getterReads++; return true; } }
          : { value: true }),
      });
      const fake = fixture({ prepareReply: reply });
      assert.equal((await createExtensionSessionAuthenticationHost(
        fake.chrome, 7, async () => undefined,
      ).authenticate(credentials)).ok, false);
      assert.equal(getterReads, 0);
      assert.equal(fake.calls.includes("submit"), false);
    }
  },
);


test("login scripts reject accessor-backed Chrome array slots",
  async () => {
    const page = fixture({});
    const original = page.chrome.scripting.executeScript;
    let getters = 0;
    page.chrome.scripting.executeScript = async request => {
      const result = await original(request);
      if (request.func.name === "runBlooketLoginPageAction" &&
          request.args?.[0] === "prepare")
        Object.defineProperty(result, "0", { enumerable: true, get() {
          getters++;
          return { result: { ok: true } };
        } });
      return result;
    };
    const output = await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async () => undefined,
    ).authenticate(credentials);
    assert.equal(output.ok, false);
    assert.equal(getters, 0);
    assert.equal(page.calls.includes("submit"), false);
  },
);

test("login host owns Chrome frame slots without reading proxy indices",
  async () => {
  const page = fixture({});
  const original = page.chrome.scripting.executeScript;
  let indexedReads = 0;
  page.chrome.scripting.executeScript = async request => new Proxy(
    await original(request), {
      get(target, key, receiver) {
        if (key === "0" || key === "length") {
          indexedReads++;
          throw new Error("Untrusted script frame array getter");
        }
        return Reflect.get(target, key, receiver);
      },
    });
  assert.deepEqual(await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => undefined,
  ).authenticate(credentials), { ok: true, value: null });
  assert.equal(indexedReads, 0);
  assert.equal(page.calls.filter(name => name === "submit").length, 1);
  },
);

test("login host fails closed on revoked Chrome frame collections",
  async () => {
  const page = fixture({});
  const original = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async request => {
    const frames = Proxy.revocable(await original(request), {});
    frames.revoke();
    return frames.proxy;
  };
  assert.deepEqual(await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => undefined,
  ).authenticate(credentials), {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(page.calls.includes("submit"), false);
  },
);


test("login rejects non-main-frame and accessor-supplied script evidence",
  async () => {
  for (const options of [
    { scriptFrameId: 1 }, { scriptFrameId: -1 },
    { scriptFrameGetter: true },
  ]) {
    const page = fixture(options);
    assert.deepEqual(await createExtensionSessionAuthenticationHost(
      page.chrome, 7, async () => undefined,
    ).authenticate(credentials), {
      ok: false, code: "blooket-browser-failed",
    });
    assert.deepEqual(page.calls, []);
    assert.deepEqual(page.argumentsSeen, []);
  }
  const page = fixture({ scriptFrameId: 0 });
  assert.deepEqual(await createExtensionSessionAuthenticationHost(
    page.chrome, 7, async () => undefined,
  ).authenticate(credentials), { ok: true, value: null });
  assert.equal(page.calls.filter(action => action === "submit").length, 1);
  },
);
