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
//   - Synthetic Chrome-host tests for the observed Create Set browser flow.
// - Must-Not:
//   - Start Chrome, submit to Blooket, or expose a bridge write command.
// - Allows:
//   - Inputs: Deterministic tab transitions and script results.
//   - Outputs: Exact ordering, stop propagation, and confirmation assertions.
//   - Side effects: In-memory fake tab and script state only.
// - Split-When:
//   - Safari gains a distinct host runtime.
// - Merge-When:
//   - Browser write hosting no longer needs Chrome-specific mechanics.
// - Summary:
//   - Proves navigation, submit, and redirect confirmation stay separated.
// - Description:
//   - A submit that never reaches the edit redirect remains a browser failure.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Foreign tabs, malformed replies, and timeouts fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  createExtensionCreateSetHost,
  type CreateSetChromePort,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/service/browser-extension/adapter-inbound/create-set-host.ts";

type ScriptStep = unknown | ((args: readonly unknown[]) => unknown);

function fakeChrome(options: {
  readonly initialUrl?: string;
  readonly afterUpdate?: readonly {
    readonly url: string;
    readonly status: string;
  }[];
  readonly scripts?: ScriptStep[];
  readonly canLeave?: unknown;
  readonly claimed?: unknown;
  readonly owned?: unknown;
}) {
  const calls: string[] = [];
  let tab = {
    url: options.initialUrl ??
      "https://dashboard.blooket.com/my-sets",
    status: "complete",
  };
  const transitions = [...(options.afterUpdate ?? [])];
  const scripts = [...(options.scripts ?? [])];
  let navigated = false;
  const chrome: CreateSetChromePort = {
    tabs: {
      get: async () => {
        calls.push("get");
        if (navigated && transitions.length > 0)
          tab = transitions.shift()!;
        return tab;
      },
      update: async (_tabId, update) => {
        calls.push("update:" + update.url);
        tab = { url: update.url, status: "loading" };
        navigated = true;
        return tab;
      },
    },
    scripting: {
      executeScript: async (request) => {
        if (request.func.name === "canLeaveBlooketPageForRead") {
          calls.push("can-leave-check");
          return [{ result: options.canLeave === undefined
              ? true : options.canLeave }];
        }
        if (request.func.name === "runBlooketCreateSetOwnership") {
          const action = request.args?.[0];
          calls.push("create-ownership:" + action);
          return [{ result: action === "claim"
            ? options.claimed === undefined ? true : options.claimed
            : options.owned === undefined ? true : options.owned }];
        }
        calls.push("script");
        const next = scripts.shift();
        const result = typeof next === "function"
          ? next(request.args ?? [])
          : next;
        return [{ result }];
      },
    },
  };
  return {
    chrome,
    calls,
    setTab(next: { readonly url: string; readonly status: string }) {
      tab = next;
      navigated = false;
    },
  };
}

const createState = {
  ok: true,
  value: "create",
};
const prepared = { ok: true };
const observed = {
  ok: true,
  remoteSetId: "remote-set-1",
};

test(
  "host navigates prepares submits and separately observes redirect",
  async () => {
  const fake = fakeChrome({
    afterUpdate: [{
      url: "https://dashboard.blooket.com/create",
      status: "complete",
    }],
    scripts: [
      createState,
      prepared,
      prepared,
      observed,
      observed,
    ],
  });
  const host = createExtensionCreateSetHost(
    fake.chrome,
    7,
    async () => undefined,
  );
  assert.deepEqual(await host.openCreateSet(), { ok: true });
  const input = {
    title: "Synthetic set",
    description: "Description",
    private: true,
  };
  assert.deepEqual(await host.prepareCreateSet(input), { ok: true });
  assert.deepEqual(await host.submitCreateSet(input), { ok: true });

  fake.setTab({
    url: "https://dashboard.blooket.com/edit?id=remote-set-1",
    status: "complete",
  });
  assert.deepEqual(await host.observeCreateSet(), observed);
  assert.equal(fake.calls.filter((call) => call === "script").length, 5);
  },
);

test("human and wait states propagate during create navigation", async () => {
  for (const state of [
    "security-challenge",
    "organization-prompt",
    "rate-limited",
    "signed-out",
    "expired-session",
  ] as const) {
    const fake = fakeChrome({
      afterUpdate: [{
        url: "https://dashboard.blooket.com/create",
        status: "complete",
      }],
      scripts: [{ ok: true, value: state }],
    });
    const host = createExtensionCreateSetHost(
      fake.chrome,
      7,
      async () => undefined,
    );
    assert.deepEqual(await host.openCreateSet(), {
      ok: false,
      kind: "navigation",
      state,
    });
  }
});

test(
  "foreign tab and malformed script replies fail before submit",
  async () => {
  const foreign = fakeChrome({
    initialUrl: "https://example.invalid/",
  });
  const host = createExtensionCreateSetHost(
    foreign.chrome,
    7,
    async () => undefined,
  );
  assert.deepEqual(await host.openCreateSet(), {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  });

  const malformed = fakeChrome({
    afterUpdate: [{
      url: "https://dashboard.blooket.com/create",
      status: "complete",
    }],
    scripts: [{ ok: true, value: "create" }, { ok: true, extra: true }],
  });
  const malformedHost = createExtensionCreateSetHost(
    malformed.chrome,
    7,
    async () => undefined,
  );
  assert.deepEqual(await malformedHost.openCreateSet(), { ok: true });
  assert.deepEqual(
    await malformedHost.prepareCreateSet({
      title: "Synthetic",
      description: "",
      private: true,
    }),
    {
      ok: false,
      kind: "browser",
      code: "blooket-browser-failed",
    },
  );
  },
);

test("post-submit create page timeout never becomes success", async () => {
  const scripts = Array.from(
    { length: 51 },
    () => ({ ok: true, value: "create" }),
  );
  const fake = fakeChrome({
    afterUpdate: [{
      url: "https://dashboard.blooket.com/create",
      status: "complete",
    }],
    scripts,
  });
  const host = createExtensionCreateSetHost(
    fake.chrome,
    7,
    async () => undefined,
  );
  assert.deepEqual(await host.openCreateSet(), { ok: true });
  assert.deepEqual(await host.observeCreateSet(), {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  });
});

test(
  "a page switch during prepare cannot authorize Create Set submission",
  async () => {
  const fake = fakeChrome({ afterUpdate: [{
    url: "https://dashboard.blooket.com/create", status: "complete",
  }], scripts: [createState, prepared] });
  const host = createExtensionCreateSetHost(fake.chrome, 7, async () => {});
  assert.deepEqual(await host.openCreateSet(), { ok: true });
  const original = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async (request) => {
    const result = await original(request);
    if (request.func.name === "prepareBlooketCreateSetForm")
      fake.setTab({
        url: "https://dashboard.blooket.com/my-sets", status: "complete",
      });
    return result;
  };
  const input = { title: "Synthetic", description: "", private: true };
  assert.equal((await host.prepareCreateSet(input)).ok, false);
  assert.equal((await host.submitCreateSet(input)).ok, false);
  assert.equal(fake.calls.filter((call) => call === "script").length, 2);
  },
);

test(
  "an independently selected route is not overwritten by Create Set",
  async () => {
  const fake = fakeChrome({});
  const get = fake.chrome.tabs.get;
  let checks = 0;
  fake.chrome.tabs.get = async (id) => {
    if (++checks === 2) fake.setTab({
      url: "https://dashboard.blooket.com/edit?id=user-selected",
      status: "complete",
    });
    return await get(id);
  };
  const host = createExtensionCreateSetHost(fake.chrome, 7, async () => {});
  assert.equal((await host.openCreateSet()).ok, false);
  assert.equal(fake.calls.some((call) => call.startsWith("update:")), false);
  },
);

test(
  "a changed success tab cannot confirm Create Set publication",
  async () => {
  const fake = fakeChrome({ scripts: [observed] });
  const host = createExtensionCreateSetHost(fake.chrome, 7, async () => {});
  fake.setTab({
    url: "https://dashboard.blooket.com/edit?id=remote-set-1",
    status: "complete",
  });
  const original = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async (request) => {
    const result = await original(request);
    fake.setTab({
      url: "https://dashboard.blooket.com/edit?id=user-selected",
      status: "complete",
    });
    return result;
  };
  assert.equal((await host.observeCreateSet()).ok, false);
  },
);

test(
  "Create Set read-back must match the unique selected edit ID",
  async () => {
  for (const [url, response] of [
    ["https://dashboard.blooket.com/edit?id=remote-set-1",
      { ok: true, remoteSetId: "another-set" }],
    ["https://dashboard.blooket.com/edit?id=remote-set-1",
      { ok: true, remoteSetId: "remote-set-1", secret: "private" }],
    ["https://dashboard.blooket.com/edit?id=remote-set-1&id=another-set",
      { ok: true, remoteSetId: "remote-set-1" }],
    ["https://dashboard.blooket.com/edit?id=remote-set-1",
      { ok: true, remoteSetId: 7 }],
  ] as const) {
    const fake = fakeChrome({ scripts: [response] });
    fake.setTab({ url, status: "complete" });
    const host = createExtensionCreateSetHost(fake.chrome, 7, async () => {});
    assert.deepEqual(await host.observeCreateSet(), {
      ok: false, kind: "browser", code: "blooket-browser-failed",
    });
  }
  },
);

test("Create Set receipts retain opaque encoded edit IDs", async () => {
  const id = "opaque id/with spaces";
  const fake = fakeChrome({ scripts: [
    { ok: true, remoteSetId: id },
    { ok: true, remoteSetId: id },
  ] });
  fake.setTab({
    url: "https://dashboard.blooket.com/edit?id=" + encodeURIComponent(id),
    status: "complete",
  });
  assert.deepEqual(await createExtensionCreateSetHost(
    fake.chrome, 7, async () => {},
  ).observeCreateSet(), { ok: true, remoteSetId: id });
});


test(
  "a single redirect observation never proves persisted creation",
  async () => {
  const fake = fakeChrome({ scripts: [observed] });
  fake.setTab({
    url: "https://dashboard.blooket.com/edit?id=remote-set-1",
    status: "complete",
  });
  const result = await createExtensionCreateSetHost(
    fake.chrome, 7, async () => {},
  ).observeCreateSet();
  assert.deepEqual(result, {
    ok: false, kind: "browser", code: "blooket-browser-failed",
  });
  assert.equal(fake.calls.filter((call) => call === "script").length, 2);
  },
);

test("redirect evidence changing after a yield is rejected", async () => {
  for (const replies of [
    [observed, { ok: true, remoteSetId: "different-set" }],
    [observed, { ok: true, remoteSetId: "remote-set-1", extra: "unknown" }],
    [observed, { ok: false, code: "blooket-browser-failed" }],
  ]) {
    const fake = fakeChrome({ scripts: replies });
    fake.setTab({
      url: "https://dashboard.blooket.com/edit?id=remote-set-1",
      status: "complete",
    });
    assert.equal((await createExtensionCreateSetHost(
      fake.chrome, 7, async () => {},
    ).observeCreateSet()).ok, false);
  }
});

test(
  "a route changed during redirect confirmation is not accepted",
  async () => {
  const fake = fakeChrome({ scripts: [observed, observed] });
  fake.setTab({
    url: "https://dashboard.blooket.com/edit?id=remote-set-1",
    status: "complete",
  });
  const host = createExtensionCreateSetHost(
    fake.chrome, 7,
    async () => fake.setTab({
      url: "https://dashboard.blooket.com/my-sets",
      status: "complete",
    }),
  );
  assert.equal((await host.observeCreateSet()).ok, false);
  assert.equal(fake.calls.filter((call) => call === "script").length, 1);
  },
);

test(
  "Create Set submit acknowledgement refuses unrelated browser routes",
  async () => {
  const expected = { title: "Test", description: "", private: true };
  for (const url of [
    "https://dashboard.blooket.com/my-sets",
    "https://id.blooket.com/login",
    "https://dashboard.blooket.com/edit?id=one&id=two",
    "https://example.invalid/",
  ]) {
    const fake = fakeChrome({
      afterUpdate: [{ url: "https://dashboard.blooket.com/create",
        status: "complete" }],
      scripts: [createState, prepared],
    });
    const host = createExtensionCreateSetHost(
      fake.chrome, 7, async () => {},
    );
    assert.deepEqual(await host.openCreateSet(), { ok: true });
    const submit = fake.chrome.scripting.executeScript;
    fake.chrome.scripting.executeScript = async (request) => {
      const response = await submit(request);
      if (request.func.name === "submitBlooketCreateSetForm")
        fake.setTab({ url, status: "complete" });
      return response;
    };
    assert.deepEqual(await host.submitCreateSet(expected), {
      ok: false, kind: "browser", code: "blooket-browser-failed",
    });
  }
  },
);

test(
  "Create Set submit permits the expected loading edit redirect",
  async () => {
  const fake = fakeChrome({
    afterUpdate: [{ url: "https://dashboard.blooket.com/create",
      status: "complete" }],
    scripts: [createState, prepared],
  });
  const host = createExtensionCreateSetHost(
    fake.chrome, 7, async () => {},
  );
  assert.deepEqual(await host.openCreateSet(), { ok: true });
  const execute = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async (request) => {
    const reply = await execute(request);
    if (request.func.name === "submitBlooketCreateSetForm")
      fake.setTab({
        url: "https://dashboard.blooket.com/edit?id=opaque%20set",
        status: "loading",
      });
    return reply;
  };
  assert.deepEqual(await host.submitCreateSet({
    title: "Test", description: "", private: true,
  }), {
    ok: true,
  });
});

test("Create Set never navigates away from existing teacher edit work",
  async () => {
  for (const denied of [false, null, { ok: true }, "true"]) {
    const fake = fakeChrome({
      initialUrl: "https://dashboard.blooket.com/edit?id=teacher-draft",
      canLeave: denied,
    });
    const result = await createExtensionCreateSetHost(
      fake.chrome, 7, async () => undefined,
    ).openCreateSet();
    assert.equal(result.ok, false);
    assert.equal(fake.calls.includes("can-leave-check"), true);
    assert.equal(fake.calls.some(call => call.startsWith("update:")), false);
  }
  },
);

test("Create Set refuses navigation drift during leave inspection",
  async () => {
  const fake = fakeChrome({});
  const execute = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async request => {
    const result = await execute(request);
    if (request.func.name === "canLeaveBlooketPageForRead")
      fake.setTab({
        url: "https://dashboard.blooket.com/edit?id=teacher-draft",
        status: "complete",
      });
    return result;
  };
  const result = await createExtensionCreateSetHost(
    fake.chrome, 7, async () => undefined,
  ).openCreateSet();
  assert.equal(result.ok, false);
  assert.equal(fake.calls.some(call => call.startsWith("update:")), false);
  },
);

test("Create Set does not overwrite an existing create-page draft",
  async () => {
  const fake = fakeChrome({
    initialUrl: "https://dashboard.blooket.com/create",
  });
  const result = await createExtensionCreateSetHost(
    fake.chrome, 7, async () => undefined,
  ).openCreateSet();
  assert.equal(result.ok, false);
  assert.equal(fake.calls.includes("script"), false);
  assert.equal(fake.calls.some(call => call.startsWith("update:")), false);
  },
);

test("Create Set refuses ownership after a page or teacher state change",
  async () => {
  const entry = { url: "https://dashboard.blooket.com/create",
    status: "complete" };
  const unclaimable = fakeChrome({
    afterUpdate: [entry], scripts: [createState], claimed: false,
  });
  const host = createExtensionCreateSetHost(
    unclaimable.chrome, 7, async () => undefined,
  );
  assert.equal((await host.openCreateSet()).ok, false);
  assert.equal(unclaimable.calls.includes("create-ownership:claim"), true);
  assert.equal(unclaimable.calls.includes("create-ownership:check"), false);
  const changed = fakeChrome({
    afterUpdate: [entry], scripts: [createState], owned: false,
  });
  const other = createExtensionCreateSetHost(
    changed.chrome, 7, async () => undefined,
  );
  assert.equal((await other.openCreateSet()).ok, true);
  assert.equal((await other.prepareCreateSet({
    title: "Synthetic", description: "", private: true,
  })).ok, false);
  assert.equal((await other.submitCreateSet({
    title: "Synthetic", description: "", private: true,
  })).ok, false);
  assert.equal(changed.calls.filter(x => x === "script").length, 1);
  },
);
