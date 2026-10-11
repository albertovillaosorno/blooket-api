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
//   - Deterministic deadline regressions for extension read navigation.
// - Must-Not:
//   - Launch a browser, contact Blooket, or alter persistent Chrome state.
// - Allows:
//   - Inputs: Synthetic browser tab transitions and a monotonic test clock.
//   - Outputs: Assertions on confirmed routes and time-budget failures.
//   - Side effects: Test-local navigation and pause counters.
// - Split-When:
//   - Another browser requires a different test fixture.
// - Merge-When:
//   - Read navigation becomes independently verified by another owner.
// - Summary:
//   - Prevents slow Chrome calls from extending the read budget.
// - Description:
//   - Exercises delayed updates, stale completions, and exact route checks.
// - Usage:
//   - Run through the repository Node test suite.
// - Defaults:
//   - Unverified navigation and expired deadlines fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";

import { confirmBlooketReadNavigation } from
  // jig-ignore-next-line: Keep the mirrored source import unaliased.
  "../../../../src/service/browser-extension/adapter-inbound/read-navigation.ts";

const SETS = "https://dashboard.blooket.com/my-sets";
const EDIT = "https://dashboard.blooket.com/edit?id=fixture";

function fixture(options: {
  readonly initialUrl?: string;
  readonly statuses?: readonly string[];
  readonly updateLatency?: number;
  readonly readLatency?: number;
  readonly keepOldUrl?: boolean;
  readonly keepOldOrigin?: boolean;
  readonly invalidOrigin?: boolean;
  readonly originLatency?: number;
} = {}) {
  let tick = 0;
  let url = options.initialUrl ?? SETS;
  let gets = 0;
  let updates = 0;
  let reloads = 0;
  let origin = 1_000;
  const statuses = options.statuses ?? ["complete"];
  const tabs = {
    get: async (id: number) => {
      assert.equal(id, 7);
      tick += options.readLatency ?? 0;
      const status = statuses[Math.min(gets++, statuses.length - 1)];
      return { url, status };
    },
    update: async (id: number, input: { url: string }) => {
      assert.equal(id, 7);
      updates++;
      tick += options.updateLatency ?? 0;
      if (!options.keepOldUrl) url = input.url;
      if (!options.keepOldOrigin) origin += 1_000;
      return { url, status: "loading" };
    },
    reload: async (id: number, input: { bypassCache: true }) => {
      assert.equal(id, 7);
      assert.deepEqual(input, { bypassCache: true });
      reloads++;
      tick += options.updateLatency ?? 0;
      if (!options.keepOldOrigin) origin += 1_000;
    },
  };
  return {
    tabs,
    previous: { url, status: "complete" },
    pause: async (ms: number) => { tick += ms; },
    documentOrigin: async (expectedUrl: string) => {
      tick += options.originLatency ?? 0;
      return expectedUrl === url && !options.invalidOrigin ? origin : null;
    },
    now: () => tick,
    elapsed: () => tick,
    gets: () => gets,
    updates: () => updates,
    reloads: () => reloads,
  };
}

test("an already loaded route reloads before a fresh read", async () => {
  const page = fixture();
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, SETS, 8_000,
    page.pause, page.documentOrigin, page.now,
  );
  assert.deepEqual(result, { url: SETS, status: "complete" });
  assert.equal(page.updates(), 0);
  assert.equal(page.reloads(), 1);
  assert.equal(page.gets(), 4);
});

test("an exact route is confirmed only after loading completes", async () => {
  const page = fixture({
    statuses: ["complete", "complete", "loading", "complete"],
  });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 8_000,
    page.pause, page.documentOrigin, page.now,
  );
  assert.deepEqual(result, { url: EDIT, status: "complete" });
  assert.equal(page.updates(), 1);
  assert.equal(page.gets(), 5);
  assert.equal(page.elapsed(), 100);
});

test("a late Chrome update never gains a new five-second window", async () => {
  const page = fixture({ updateLatency: 7_900 });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 8_000,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.elapsed(), 7_900);
  assert.equal(page.updates(), 1);
  assert.equal(page.gets(), 2);
});

test("the shared deadline wins over the local navigation window", async () => {
  const page = fixture({ statuses: ["complete", "complete", "loading"] });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 250,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.elapsed(), 250);
  assert.equal(page.updates(), 1);
  assert.equal(page.gets(), 5);
});

test("a late completed tabs.get reply does not prove navigation", async () => {
  const page = fixture({ readLatency: 800 });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, SETS, 700,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.updates(), 0);
  assert.equal(page.gets(), 1);
});

test("a completed but wrong route is never accepted", async () => {
  const page = fixture({ keepOldUrl: true });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 300,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.elapsed(), 300);
  assert.equal(page.updates(), 1);
});

test("session observation does not navigate when no route is required",
  async () => {
  const page = fixture();
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, null, 8_000,
    page.pause, page.documentOrigin, page.now,
  );
  assert.deepEqual(result, { url: SETS, status: "complete" });
  assert.equal(page.updates(), 0);
  },
);

test("a stale tab snapshot must not overwrite manual navigation", async () => {
  const manuallySelected = "https://dashboard.blooket.com/create";
  const page = fixture({ initialUrl: manuallySelected });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, { url: SETS, status: "complete" }, EDIT, 8_000,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.updates(), 0);
  assert.equal(page.gets(), 1);
});

test("manual navigation invalidates the admitted source", async () => {
  const page = fixture({ initialUrl: EDIT });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, { url: SETS, status: "complete" }, EDIT, 8_000,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.updates(), 0);
  assert.equal(page.reloads(), 0);
});

test(
  "an overdue pre-navigation tab check cannot start navigation",
  async () => {
  const page = fixture({ readLatency: 500 });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 250,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.elapsed(), 500);
  assert.equal(page.updates(), 0);
  },
);
test("a stale complete document after reload never admits a read", async () => {
  const page = fixture({ keepOldOrigin: true });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, SETS, 250,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.reloads(), 1);
  assert.equal(page.elapsed(), 250);
});

test("missing document identity stops before any navigation", async () => {
  const page = fixture({ invalidOrigin: true });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 250,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.updates(), 0);
  assert.equal(page.reloads(), 0);
});

test("late document inspection cannot extend the read deadline", async () => {
  const page = fixture({ originLatency: 500 });
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, SETS, 250,
    page.pause, page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.reloads(), 0);
  assert.equal(page.elapsed(), 500);
});

test("a late fresh origin still cannot admit a saved-state read", async () => {
  const page = fixture();
  let observations = 0;
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, SETS, 250, page.pause,
    async url => {
      const origin = await page.documentOrigin(url);
      if (++observations === 3) await page.pause(250);
      return origin;
    }, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.reloads(), 1);
  assert.equal(page.elapsed(), 250);
});

test("same-route replacement before navigation never reloads an editor",
  async () => {
  for (const target of [SETS, EDIT]) {
    const page = fixture();
    let checked = 0;
    const result = await confirmBlooketReadNavigation(
      page.tabs, 7, page.previous, target, 500, page.pause,
      async url => {
        const origin = await page.documentOrigin(url);
        return ++checked === 2 ? (origin as number) + 1_000 : origin;
      }, page.now,
    );
    assert.equal(result, undefined);
    assert.equal(page.reloads(), 0);
    assert.equal(page.updates(), 0);
    assert.equal(checked, 2);
  }
  },
);

test("manual navigation after a fresh origin invalidates a read", async () => {
  const page = fixture();
  let observations = 0;
  let moved = false;
  const tabs = {
    ...page.tabs,
    get: async (id: number) => moved
      ? { url: EDIT, status: "complete" }
      : await page.tabs.get(id),
  };
  const result = await confirmBlooketReadNavigation(
    tabs, 7, page.previous, SETS, 250, page.pause,
    async url => {
      const origin = await page.documentOrigin(url);
      if (++observations === 2) moved = true;
      return origin;
    }, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.reloads(), 1);
});
