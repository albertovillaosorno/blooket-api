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
