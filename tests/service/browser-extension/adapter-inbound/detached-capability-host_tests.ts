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
//   - Synthetic detached read verification for native capability probing.
// - Must-Not:
//   - Connect to Blooket or open any actual browser or teacher profile.
// - Allows:
//   - Inputs: Fake background Chrome tabs with stable/unstable observations.
//   - Outputs: Admission, failure, and cleanup assertions.
//   - Side effects: Only in-memory synthetic tab state changes.
// - Split-When:
//   - Detached capability families require separate browser lifecycles.
// - Merge-When:
//   - This host is merged into a shared temporary-tab abstraction.
// - Summary:
//   - An unsaved teacher editor is never used as a capability probe.
// - Description:
//   - Only a fresh authenticated tab can produce capability evidence.
// - Usage:
//   - Run with the standard repository Node test command.
// - Defaults:
//   - Failure or leaked temporary tabs invalidate otherwise good evidence.
//
import assert from "node:assert/strict";
import test from "node:test";
import { decodeBlooketCapabilitySnapshot } from
  "../../../../src/ir/capability-snapshots/contract/blooket-capabilities.ts";
import {
  inspectDetachedBlooketCapabilities,
  type DetachedCapabilityChromePort,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/service/browser-extension/adapter-inbound/detached-capability-host.ts";

const MY_SETS = "https://dashboard.blooket.com/my-sets";

function fixture(options: {
  readonly createAccessor?: boolean;
  readonly getAccessor?: boolean;
  readonly sourceRedirect?: boolean;
  readonly unstableLists?: boolean;
  readonly failedCleanup?: boolean;
  readonly pending?: boolean;
  readonly interruptedDrawer?: boolean;
  readonly lateMySets?: boolean;
  readonly lateEdit?: boolean;
  readonly failedMySetsHydration?: boolean;
  readonly challengeAfterShell?: boolean;
  readonly neverHydrates?: boolean;
  readonly changeOriginAfterShell?: boolean;
  readonly delayedFirstList?: boolean;
  readonly neverLists?: boolean;
  readonly malformedFirstList?: boolean;
  readonly accessorPageState?: boolean;
  readonly loadAfterMs?: number;
  readonly hydrateAfterMs?: number;
  readonly scriptLatencyMs?: number;
  readonly uncommittedForMs?: number;
  readonly initialBlankForMs?: number;
  readonly pendingDestination?: string;
  readonly invalidClockAt?: number;
  readonly invalidClockValue?: number;
} = {}) {
  const events: string[] = [];
  let url = MY_SETS, removed = false, now = 1_000, scans = 0;
  let docOrigin = 9_000, panelOpen = false, drawerOpen = false;
  let mySetsStages = 0, editStages = 0;
  const chrome: DetachedCapabilityChromePort = {
    tabs: {
      create: async ({ url: newUrl, active }) => {
        events.push("create");
        assert.deepEqual({ url: newUrl, active },
          { url: MY_SETS, active: false });
        if (options.createAccessor) {
          const response = { url: newUrl, status: "loading" } as {
            id?: number; url: string; status: string;
          };
          Object.defineProperty(response, "id", { enumerable: true,
            get() { events.push("read-create-id-getter"); return 84; },
          });
          return response;
        }
        return { id: 84, url: newUrl, status: "loading" };
      },
      get: async id => {
        assert.equal(id, 84);
        events.push("get");
        if (options.initialBlankForMs !== undefined &&
            now - 1_000 < options.initialBlankForMs)
          return { id, url: "about:blank", status: "complete" };
        if (options.uncommittedForMs !== undefined &&
            now - 1_000 < options.uncommittedForMs)
          return { id, pendingUrl: options.pendingDestination ?? MY_SETS,
            status: "loading" };
        const tab = { id,
          url: options.sourceRedirect ? "https://id.blooket.com/" : url,
          status: options.pending ||
          (options.loadAfterMs !== undefined &&
            now - 1_000 < options.loadAfterMs)
            ? "loading" : "complete" };
        if (options.getAccessor) Object.defineProperty(tab, "url", {
          enumerable: true, get() { events.push("read-getter-url");
            return MY_SETS; },
        });
        return tab;
      },
      update: async (id, input) => {
        assert.equal(id, 84);
        assert.ok(input.url === MY_SETS ||
          input.url === "https://dashboard.blooket.com/edit?id=synthetic-set");
        events.push("update");
        url = input.url;
        docOrigin += 1_000;
        return { id, url, status: "complete" };
      },
      remove: async id => {
        assert.equal(id, 84);
        events.push("remove");
        if (options.failedCleanup) throw Error("not-removed");
        removed = true;
      },
    },
    scripting: {
      executeScript: async ({ target, func, args }) => {
        assert.equal(target.tabId, 84);
        events.push(func.name);
        if (func.name === "inspectBlooketDocumentOrigin") {
          if (options.changeOriginAfterShell && mySetsStages > 0)
            return [{ result: docOrigin + 100 }];
          return [{ result: docOrigin }];
        }
        if (func.name === "canLeaveBlooketPageForRead")
          return [{ result: true }];
        if (func.name === "inspectBlooketPage") {
          now += options.scriptLatencyMs ?? 0;
          const operation = (args?.[0] ?? {}) as { kind?: string };
          if (operation.kind === "session.observe") {
            if (options.accessorPageState) {
              const hostile = { ok: true } as Record<string, unknown>;
              Object.defineProperty(hostile, "value", {
                enumerable: true,
                get() { throw Error("untrusted-provider-status-getter"); },
              });
              return [{ result: hostile }];
            }
            if (url === MY_SETS) mySetsStages++;
            else editStages++;
            if (options.failedMySetsHydration && mySetsStages < 3)
              return [{ result: { ok: false,
                code: "blooket-browser-failed" } }];
            return [{ result: { ok: true,
              value: url === MY_SETS
                ? options.challengeAfterShell && mySetsStages === 2
                  ? "security-challenge"
                  : options.neverHydrates ||
                    (options.challengeAfterShell && mySetsStages === 1) ||
                    (options.hydrateAfterMs !== undefined &&
                      now - 1_000 < options.hydrateAfterMs) ||
                    (options.lateMySets && mySetsStages < 3)
                      ? "unexpected-page" : "my-sets"
                : options.lateEdit && editStages < 3
                  ? "unexpected-page" : "edit" } }];
          }
          if (operation.kind === "sets.list") {
            scans++;
            if (options.neverLists ||
                (options.delayedFirstList && scans < 3))
              return [{ result: { ok: false,
                code: "blooket-browser-failed" } }];
            if (options.malformedFirstList && scans === 1)
              return [{ result: { ok: true,
                value: { items: [], completeness: "unknown" } } }];
            const id = options.unstableLists && scans > 1
              ? "changed-set" : "synthetic-set";
            return [{ result: { ok: true, value: {
              items: [{ schemaVersion: 1, id,
                title: "Synthetic capability probe" }],
              completeness: "unknown",
            } } }];
          }
        }
        if (func.name === "openBlooketCapabilityQuestionPanel") {
          panelOpen = true;
          return [{ result: true }];
        }
        if (func.name === "isBlooketCapabilityQuestionPanelReady")
          return [{ result: panelOpen }];
        if (func.name === "openBlooketAudioCapabilityDrawer") {
          drawerOpen = true;
          if (options.interruptedDrawer)
            throw Error("unacknowledged-drawer-open");
          return [{ result: true }];
        }
        if (func.name === "inspectBlooketAudioCapabilityDrawer")
          return [{ result: { ok: true, value: "unsupported" } }];
        if (func.name === "closeBlooketAudioCapabilityDrawer") {
          drawerOpen = false;
          return [{ result: true }];
        }
        if (func.name === "isBlooketAudioCapabilityDrawerClosed")
          return [{ result: !drawerOpen }];
        if (func.name === "closeBlooketCapabilityQuestionPanel") {
          if (drawerOpen) return [{ result: false }];
          panelOpen = false;
          return [{ result: true }];
        }
        if (func.name === "isBlooketCapabilityQuestionPanelClosed")
          return [{ result: !panelOpen && !drawerOpen }];
        throw Error("unexpected-script:" + func.name);
      },
    },
  };
  const pause = async (ms: number) => { now += Math.max(ms, 1); };
  let clockCalls = 0;
  const readClock = () => ++clockCalls === options.invalidClockAt
    ? (options.invalidClockValue ?? Number.NaN) : now;
  const inspect = async (textOnly = true) =>
    await inspectDetachedBlooketCapabilities(
      chrome, textOnly, pause, readClock,
    );
  return { events, inspect, removed: () => removed,
    elapsed: () => now - 1_000 };
}

test("untrusted capability read clocks cannot grant a provider receipt",
  async () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, -1]) {
    const beforeTab = fixture({ invalidClockAt: 1,
      invalidClockValue: value });
    assert.deepEqual(await beforeTab.inspect(),
      { ok: false, code: "blooket-browser-failed" });
    assert.equal(beforeTab.events.includes("create"), false);
    const afterTab = fixture({ invalidClockAt: 2,
      invalidClockValue: value });
    assert.deepEqual(await afterTab.inspect(),
      { ok: false, code: "blooket-browser-failed" });
    assert.deepEqual(afterTab.events, ["create", "remove"]);
    assert.equal(afterTab.removed(), true);
  }
});

test("getter-supplied detached capability route cannot authorize scripts",
  async () => {
  const page = fixture({ getAccessor: true });
  assert.deepEqual(await page.inspect(), {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(page.events.includes("read-getter-url"), false);
  assert.equal(page.events.includes("inspectBlooketDocumentOrigin"), false);
  assert.equal(page.removed(), true);
});

test("accessor-supplied capability tab IDs never authorize reads or cleanup",
  async () => {
  const page = fixture({ createAccessor: true });
  assert.deepEqual(await page.inspect(), {
    ok: false, code: "blooket-browser-failed",
  });
  assert.deepEqual(page.events, ["create"]);
  assert.equal(page.removed(), false);
});

test("detached text capabilities admit stable read and close only own tab",
  async () => {
  const page = fixture();
  const result = await page.inspect();
  assert.equal(result.ok, true);
  if (result.ok) {
    const accepted = decodeBlooketCapabilitySnapshot(result.value);
    assert.equal(accepted.ok, true);
    if (accepted.ok) {
      assert.equal(accepted.value.features.answerImages,
        "account-dependent");
      assert.equal(accepted.value.features.audio, "account-dependent");
    }
  }
  assert.equal(page.removed(), true);
  assert.equal(page.events.filter(x => x === "create").length, 1);
  assert.equal(page.events.filter(x => x === "remove").length, 1);
  assert.ok(!page.events.includes("update"));
  assert.ok(!page.events.some(x => /submit|save|upload/iu.test(x)));
});

test("detached text capability waits for its fresh My Sets hydration",
  async () => {
  const page = fixture({ lateMySets: true });
  assert.equal((await page.inspect()).ok, true);
  assert.equal(page.removed(), true);
  assert.equal(page.events.filter(name =>
    name === "inspectBlooketPage").length >= 5, true);
});

test("new capability tabs can have only pendingUrl before navigation commits",
  async () => {
    const page = fixture({ uncommittedForMs: 150 });
    assert.equal((await page.inspect()).ok, true);
    assert.equal(page.removed(), true);
    assert.ok(page.elapsed() >= 150);
  });

test("a new Chrome blank capability tab can commit without a new profile",
  async () => {
  const page = fixture({ initialBlankForMs: 150 });
  assert.equal((await page.inspect()).ok, true);
  assert.equal(page.removed(), true);
  assert.ok(page.elapsed() >= 150);
  assert.equal(page.events.filter(name => name === "create").length, 1);
});

test("a stuck blank capability tab never accesses a provider page",
  async () => {
  const page = fixture({ initialBlankForMs: 4_000 });
  assert.deepEqual(await page.inspect(),
    { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.removed(), true);
  assert.ok(!page.events.includes("inspectBlooketPage"));
});

test("a foreign pending capability navigation is never inspected", async () => {
  const page = fixture({ uncommittedForMs: 150,
    pendingDestination: "https://foreign.invalid/" });
  assert.equal((await page.inspect()).ok, false);
  assert.ok(!page.events.includes("inspectBlooketPage"));
});

test("detached media capability waits for a fresh Edit hydration",
  async () => {
  const page = fixture({ lateEdit: true });
  assert.equal((await page.inspect(false)).ok, true);
  assert.equal(page.removed(), true);
  assert.ok(page.events.includes("closeBlooketCapabilityQuestionPanel"));
});

test("detached capability can wait for narrowly unavailable initial shell",
  async () => {
  const page = fixture({ failedMySetsHydration: true });
  assert.equal((await page.inspect()).ok, true);
  assert.equal(page.removed(), true);
});

test("challenge and document replacement stop a detached capability read",
  async () => {
  for (const option of ["challengeAfterShell", "neverHydrates",
    "changeOriginAfterShell", "accessorPageState"] as const) {
    const page = fixture({ [option]: true });
    assert.deepEqual(await page.inspect(),
      { ok: false, code: "blooket-browser-failed" }, option);
    assert.equal(page.removed(), true, option);
    assert.ok(!page.events.includes("openBlooketCapabilityQuestionPanel"));
  }
});

test("late first saved-list hydration is retried without opening controls",
  async () => {
  const page = fixture({ delayedFirstList: true });
  assert.equal((await page.inspect()).ok, true);
  assert.equal(page.removed(), true);
  assert.equal(page.events.filter(x =>
    x === "inspectBlooketPage").length >= 5, true);
  assert.equal(page.events.filter(x => x === "update").length, 0);
});

test("an unavailable or malformed saved list cannot be repaired by guessing",
  async () => {
  for (const option of ["neverLists", "malformedFirstList"] as const) {
    const page = fixture({ [option]: true });
    assert.deepEqual(await page.inspect(),
      { ok: false, code: "blooket-browser-failed" }, option);
    assert.equal(page.removed(), true);
    assert.ok(!page.events.includes("openBlooketCapabilityQuestionPanel"));
  }
});

test("slow detached hydration never exceeds the whole read lease",
  async () => {
  const page = fixture({ loadAfterMs: 2_400, hydrateAfterMs: 9_000,
    scriptLatencyMs: 420 });
  assert.deepEqual(await page.inspect(),
    { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.removed(), true);
  assert.ok(page.elapsed() <= 8_000,
    "inner probe exceeded its outer publication read budget");
});

test("detached capabilities reject redirect, drift, and pending hydration",
  async () => {
  for (const option of ["sourceRedirect", "unstableLists",
    "pending"] as const) {
    const page = fixture({ [option]: true });
    assert.deepEqual(await page.inspect(),
      { ok: false, code: "blooket-browser-failed" }, option);
    assert.equal(page.removed(), true, option);
  }
});

test("detached capabilities never accept a result after cleanup failure",
  async () => {
  const page = fixture({ failedCleanup: true });
  assert.deepEqual(await page.inspect(),
    { ok: false, code: "blooket-browser-failed" });
  assert.deepEqual(page.events.filter(x => x === "remove"), ["remove"]);
  assert.equal(page.removed(), false);
});


test("detached full capabilities close question and audio controls in own tab",
  async () => {
  const page = fixture();
  const result = await page.inspect(false);
  assert.equal(result.ok, true);
  if (result.ok) {
    const snapshot = decodeBlooketCapabilitySnapshot(result.value);
    assert.equal(snapshot.ok, true);
    if (snapshot.ok) {
      assert.equal(snapshot.value.features.answerImages, "unsupported");
      assert.equal(snapshot.value.features.audio, "unsupported");
    }
  }
  assert.equal(page.removed(), true);
  assert.deepEqual(page.events.filter(x => x === "update"),
    ["update", "update"]);
  assert.ok(page.events.includes("closeBlooketAudioCapabilityDrawer"));
  assert.ok(page.events.includes("closeBlooketCapabilityQuestionPanel"));
});

test("ambiguous temporary audio drawer never confirms media capabilities",
  async () => {
  const page = fixture({ interruptedDrawer: true });
  assert.deepEqual(await page.inspect(false),
    { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.removed(), true);
  assert.equal(page.events.filter(x => x === "remove").length, 1);
});
