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

import { confirmBlooketReadNavigation, classifyBlooketReadTabLoad } from
  // jig-ignore-next-line: Keep the mirrored source import unaliased.
  "../../../../src/service/browser-extension/adapter-inbound/read-navigation.ts";

const SETS = "https://dashboard.blooket.com/my-sets";
const EDIT = "https://dashboard.blooket.com/edit?id=fixture";

test("Chrome pendingUrl is load evidence, not a committed document", () => {
  for (const url of [undefined, "", "about:blank"])
    assert.equal(classifyBlooketReadTabLoad({ url, pendingUrl: SETS,
      status: "loading" }, SETS), "loading");
  assert.equal(classifyBlooketReadTabLoad({ url: SETS, status: "complete" },
    SETS), "ready");
  assert.equal(classifyBlooketReadTabLoad({ pendingUrl: SETS,
    status: "complete" }, SETS), "changed");
});

test("a complete tab with a pending navigation is not a stable read", () => {
  assert.equal(classifyBlooketReadTabLoad({ url: SETS,
    pendingUrl: SETS, status: "complete" }, SETS), "changed");
  assert.equal(classifyBlooketReadTabLoad({ url: SETS,
    pendingUrl: SETS, status: "loading" }, SETS), "loading");
});

test("pending foreign navigation invalidates the old expected URL", () => {
  for (const url of [SETS, "about:blank", undefined])
    assert.equal(classifyBlooketReadTabLoad({ url, status: "loading",
      pendingUrl: "https://foreign.invalid/" }, SETS), "changed");
  assert.equal(classifyBlooketReadTabLoad({ url: EDIT, pendingUrl: SETS,
    status: "loading" }, SETS), "changed");
});

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
  assert.equal(page.gets(), 5);
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
  assert.equal(page.gets(), 6);
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

test("pending foreign navigation blocks a source tab before reload",
  async () => {
  const page = fixture();
  const tabs = { ...page.tabs, get: async (id: number) => ({
    ...await page.tabs.get(id),
    pendingUrl: "https://foreign.invalid/",
  }) };
  const result = await confirmBlooketReadNavigation(
    tabs, 7, page.previous, SETS, 500, page.pause,
    page.documentOrigin, page.now,
  );
  assert.equal(result, undefined);
  assert.equal(page.reloads(), 0);
  assert.equal(page.updates(), 0);
});

test("foreign pending route after update never transfers read authority",
  async () => {
  const page = fixture();
  const proofs: number[] = [];
  const tabs = { ...page.tabs, get: async (id: number) => {
    const tab = await page.tabs.get(id);
    return page.updates() ? { ...tab,
      pendingUrl: "https://foreign.invalid/" } : tab;
  } };
  const result = await confirmBlooketReadNavigation(
    tabs, 7, page.previous, EDIT, 500, page.pause,
    page.documentOrigin, page.now, undefined, origin => proofs.push(origin),
  );
  assert.equal(result, undefined);
  assert.deepEqual(proofs, []);
  assert.equal(page.updates(), 1);
});

test("a foreign pending route during the source recheck blocks updates",
  async () => {
  const page = fixture();
  let checks = 0;
  const tabs = { ...page.tabs, get: async (id: number) => {
    const tab = await page.tabs.get(id);
    return ++checks === 2 ? { ...tab,
      pendingUrl: "https://foreign.invalid/" } : tab;
  } };
  assert.equal(await confirmBlooketReadNavigation(
    tabs, 7, page.previous, EDIT, 500, page.pause,
    page.documentOrigin, page.now,
  ), undefined);
  assert.equal(page.updates(), 0);
  assert.equal(page.reloads(), 0);
});

test("a foreign pending URL in the final tab check vetoes a read",
  async () => {
  const page = fixture();
  let checks = 0;
  const tabs = { ...page.tabs, get: async (id: number) => {
    const tab = await page.tabs.get(id);
    return ++checks === 5 ? { ...tab,
      pendingUrl: "https://foreign.invalid/" } : tab;
  } };
  const proofs: number[] = [];
  const result = await confirmBlooketReadNavigation(
    tabs, 7, page.previous, EDIT, 500, page.pause,
    page.documentOrigin, page.now, undefined, origin => proofs.push(origin),
  );
  assert.equal(checks, 5);
  assert.equal(result, undefined);
  assert.deepEqual(proofs, []);
});

test("a read-only session observation cannot adopt a pending redirect",
  async () => {
  const page = fixture();
  const tabs = { ...page.tabs, get: async (id: number) => ({
    ...await page.tabs.get(id),
    pendingUrl: "https://foreign.invalid/",
  }) };
  assert.equal(await confirmBlooketReadNavigation(
    tabs, 7, page.previous, null, 500, page.pause,
    page.documentOrigin, page.now,
  ), undefined);
  assert.equal(page.reloads(), 0);
  assert.equal(page.updates(), 0);
});

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

test("source authorization cannot be transferred to a replacement document",
  async () => {
  const page = fixture();
  const changed = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 8_000, page.pause,
    page.documentOrigin, page.now, 2_000,
  );
  assert.equal(changed, undefined);
  assert.equal(page.updates(), 0);
  assert.equal(page.reloads(), 0);
  const unchanged = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 8_000, page.pause,
    page.documentOrigin, page.now, 1_000,
  );
  assert.deepEqual(unchanged, { url: EDIT, status: "complete" });
  assert.equal(page.updates(), 1);
  },
);

test("fresh read navigation transfers only its proven target document epoch",
  async () => {
  const page = fixture();
  const origins: number[] = [];
  assert.deepEqual(await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 8_000, page.pause,
    page.documentOrigin, page.now, undefined,
    origin => origins.push(origin),
  ), { url: EDIT, status: "complete" });
  assert.deepEqual(origins, [2_000]);
  },
);

test("a fresh tab check cannot bind a subsequently replaced Edit lifetime",
  async () => {
  const page = fixture();
  let finalCheckReached = false;
  let targetObserved = false;
  let replaced = false;
  const tabs = {
    ...page.tabs,
    get: async (id: number) => {
      const tab = await page.tabs.get(id);
      if (targetObserved) {
        finalCheckReached = true;
        replaced = true;
      }
      return tab;
    },
  };
  const proofs: number[] = [];
  const result = await confirmBlooketReadNavigation(
    tabs, 7, page.previous, EDIT, 8_000, page.pause,
    async url => {
      const original = await page.documentOrigin(url);
      if (url === EDIT && page.updates() === 1) {
        targetObserved = true;
        return replaced ? 3_000 : original;
      }
      return original;
    }, page.now, undefined, origin => proofs.push(origin),
  );
  assert.equal(finalCheckReached, true);
  assert.equal(result, undefined);
  assert.deepEqual(proofs, []);
  assert.equal(page.updates(), 1);
  },
);

test("failed or stale navigation cannot export a target document epoch",
  async () => {
  const page = fixture({ keepOldOrigin: true });
  const origins: number[] = [];
  assert.equal(await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 250, page.pause,
    page.documentOrigin, page.now, undefined,
    origin => origins.push(origin),
  ), undefined);
  assert.deepEqual(origins, []);
  },
);

test("a teacher edit admitted after first read checks blocks navigation",
  async () => {
  for (const target of [SETS, EDIT]) {
    const page = fixture();
    let lateChecks = 0;
    const result = await confirmBlooketReadNavigation(
      page.tabs, 7, page.previous, target, 8_000, page.pause,
      page.documentOrigin, page.now, undefined, undefined,
      async () => { lateChecks++; return false; },
    );
    assert.equal(result, undefined);
    assert.equal(lateChecks, 1);
    assert.equal(page.updates(), 0);
    assert.equal(page.reloads(), 0);
  }
  },
);

test("a late read-leave guard never extends the shared deadline",
  async () => {
  const page = fixture();
  let called = 0;
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 200, page.pause,
    page.documentOrigin, page.now, undefined, undefined,
    async () => { called++; await page.pause(200); return true; },
  );
  assert.equal(result, undefined);
  assert.equal(called, 1);
  assert.equal(page.updates(), 0);
  },
);

test("a final safe editor check still admits one fresh read navigation",
  async () => {
  const page = fixture();
  let checks = 0;
  const result = await confirmBlooketReadNavigation(
    page.tabs, 7, page.previous, EDIT, 8_000, page.pause,
    page.documentOrigin, page.now, undefined, undefined,
    async () => { checks++; return true; },
  );
  assert.deepEqual(result, { url: EDIT, status: "complete" });
  assert.equal(checks, 1);
  assert.equal(page.updates(), 1);
  },
);
