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
//   - Synthetic temporary-tab question reads and owner-preserving cleanup.
// - Must-Not:
//   - Connect to Blooket, use a teacher profile or submit any question.
// - Allows:
//   - Inputs: Fake Chrome tabs and script responses.
//   - Outputs: Fresh complete scans or conservative unavailable responses.
//   - Side effects: In-memory temporary tab creation/removal only.
// - Split-When:
//   - Other Blooket read surfaces use an independent detached host.
// - Merge-When:
//   - The worker ceases to read submitted forms in temporary tabs.
// - Summary:
//   - Proves detached reads cannot replace an unconfirmed teacher editor.
// - Description:
//   - Failure, page drift and cleanup refusal never produce read receipts.
// - Usage:
//   - Run through the repository Node test suite.
// - Defaults:
//   - Only a complete, stable read of an exact fresh edit page can succeed.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectDetachedBlooketQuestions,
  type DetachedQuestionReadChromePort,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/service/browser-extension/adapter-inbound/detached-question-read-host.ts";

const TARGET = "https://dashboard.blooket.com/edit?id=synthetic-set";

type Behavior = "normal" | "redirect" | "challenge" | "drift" |
  "nested-frame" | "no-cleanup" | "not-ready" | "no-hydration" |
  "late-edit" | "never-edit" | "switch-origin" |
  "challenge-after-shell" | "accessor-state" | "challenge-after-scan" |
  "hidden-ok-after-scan" | "uncommitted";

function fixture(behavior: Behavior = "normal") {
  const events: string[] = [];
  let closed = false;
  let calls = 0;
  let stageReads = 0, originReads = 0;
  let tabReads = 0;
  const temporaryTabId = 83;
  const chrome: DetachedQuestionReadChromePort = {
    tabs: {
      create: async options => {
        events.push("create");
        assert.deepEqual(options, { url: TARGET, active: false });
        return { id: temporaryTabId, url: TARGET, status: "loading" };
      },
      get: async id => {
        assert.equal(id, temporaryTabId);
        events.push("get");
        if (closed) throw Error("already-closed");
        if (behavior === "uncommitted" && ++tabReads <= 2)
          return { id, status: "loading", pendingUrl: TARGET };
        return {
          id, url: behavior === "redirect" ? "https://id.blooket.com/"
            : TARGET,
          status: behavior === "not-ready" ? "loading" : "complete",
        };
      },
      remove: async id => {
        assert.equal(id, temporaryTabId);
        events.push("remove");
        if (behavior === "no-cleanup") throw Error("not-removed");
        closed = true;
      },
    },
    scripting: {
      executeScript: async request => {
        assert.equal(request.target.tabId, temporaryTabId);
        events.push(request.func.name);
        if (request.func.name === "inspectBlooketDocumentOrigin") {
          originReads++;
          return [{ result: behavior === "switch-origin" &&
            originReads >= 3 ? 2_000 : 1_000 }];
        }
        if (request.func.name === "inspectBlooketPage") {
          stageReads++;
          if (behavior === "hidden-ok-after-scan" && calls >= 3) {
            const hidden = { value: "edit" } as Record<string, unknown>;
            Object.defineProperty(hidden, "ok", {
              value: true, enumerable: false,
            });
            return [{ result: hidden }];
          }
          if (behavior === "accessor-state") {
            const hostile = { ok: true } as Record<string, unknown>;
            Object.defineProperty(hostile, "value", {
              enumerable: true,
              get() { throw Error("untrusted-page-status-accessor"); },
            });
            return [{ result: hostile }];
          }
          return [{ result: { ok: true,
            value: behavior === "challenge" ||
              (behavior === "challenge-after-scan" && calls >= 3) ||
              (behavior === "challenge-after-shell" && stageReads === 2)
                ? "security-challenge" :
              behavior === "never-edit" ||
              (behavior === "challenge-after-shell" && stageReads === 1) ||
              (behavior === "late-edit" && stageReads < 3)
                ? "unexpected-page" : "edit" } }];
        }
        if (request.func.name === "listBlooketQuestionNumbers") {
          calls++;
          return behavior === "no-hydration"
            ? [{ result: { ok: false, code: "blooket-browser-failed" } }]
            : [{ result: { ok: true, value: behavior === "drift" &&
              calls >= 2 ? [1] : [] },
              ...(behavior === "nested-frame" ? { frameId: 5 } : {}) }];
        }
        throw Error("Unexpected script: " + request.func.name);
      },
    },
  };
  let ms = 1_000;
  const pause = async (duration: number) => { ms += duration || 1; };
  const inspect = async () => await inspectDetachedBlooketQuestions(
    chrome, "synthetic-set", 7_000, pause, () => ms,
  );
  return { events, inspect, closed: () => closed };
}

test("fresh detached empty read is complete and closes only its own tab",
  async () => {
  const page = fixture();
  assert.deepEqual(await page.inspect(), { ok: true, value: [] });
  assert.equal(page.closed(), true);
  assert.equal(page.events.filter(x => x === "create").length, 1);
  assert.equal(page.events.filter(x => x === "remove").length, 1);
  assert.equal(page.events.filter(x =>
    x === "listBlooketQuestionNumbers").length, 3);
  assert.ok(!page.events.some(x => /submit|save|update|reload/iu.test(x)));
});

test("late provider Edit hydration can settle without a new tab or write",
  async () => {
  const page = fixture("late-edit");
  assert.deepEqual(await page.inspect(), { ok: true, value: [] });
  assert.equal(page.closed(), true);
  assert.equal(page.events.filter(name =>
    name === "inspectBlooketPage").length, 4);
  assert.equal(page.events.filter(name => name === "create").length, 1);
  assert.equal(page.events.filter(name => name === "remove").length, 1);
});

test("an initial pendingUrl can commit before a detached question scan",
  async () => {
    const page = fixture("uncommitted");
    assert.deepEqual(await page.inspect(), { ok: true, value: [] });
    assert.equal(page.closed(), true);
    assert.equal(page.events.filter(event => event === "create").length, 1);
  });

test("never-hydrated and replaced detached documents do not become receipts",
  async () => {
  for (const behavior of ["never-edit", "switch-origin"] as const) {
    const page = fixture(behavior);
    assert.deepEqual(await page.inspect(),
      { ok: false, code: "blooket-browser-failed" }, behavior);
    assert.equal(page.closed(), true);
    assert.equal(page.events.filter(x => x === "remove").length, 1);
  }
});

test("a late security challenge cannot certify detached saved-card data",
  async () => {
  const page = fixture("challenge-after-scan");
  assert.deepEqual(await page.inspect(),
    { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.closed(), true);
  assert.ok(page.events.includes("listBlooketQuestionNumbers"));
});

test("a nonenumerable final session success cannot certify a read",
  async () => {
  const page = fixture("hidden-ok-after-scan");
  assert.deepEqual(await page.inspect(),
    { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.closed(), true);
});

test("source-safe read refuses challenge, redirect, card drift and bad frames",
  async () => {
  for (const behavior of ["challenge", "challenge-after-shell",
    "redirect", "drift", "accessor-state",
    "nested-frame"] as const) {
    const page = fixture(behavior);
    assert.deepEqual(await page.inspect(),
      { ok: false, code: "blooket-browser-failed" }, behavior);
    assert.equal(page.closed(), true, behavior);
    assert.equal(page.events.filter(x => x === "remove").length, 1);
  }
});

test("incomplete hydration and failed cleanup never confirm a question list",
  async () => {
  for (const behavior of ["not-ready", "no-hydration",
    "no-cleanup"] as const) {
    const page = fixture(behavior);
    assert.deepEqual(await page.inspect(),
      { ok: false, code: "blooket-browser-failed" }, behavior);
    assert.equal(page.events.filter(x => x === "remove").length, 1);
  }
});

test("invalid detached target does not even create a background tab",
  async () => {
  const page = fixture();
  const untouched: DetachedQuestionReadChromePort = {
    tabs: {
      create: async () => { throw Error("unexpected-create"); },
      get: async () => { throw Error("unexpected-get"); },
      remove: async () => { throw Error("unexpected-remove"); },
    },
    scripting: {
      executeScript: async () => { throw Error("unexpected-script"); },
    },
  };
  assert.deepEqual(await inspectDetachedBlooketQuestions(
    untouched, "bad\0set", Date.now() + 1_000, async () => {},
  ), { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.events.length, 0);
});
