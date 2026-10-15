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
  "nested-frame" | "no-cleanup" | "not-ready" | "no-hydration";

function fixture(behavior: Behavior = "normal") {
  const events: string[] = [];
  let closed = false;
  let calls = 0;
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
        if (request.func.name === "inspectBlooketDocumentOrigin")
          return [{ result: 1_000 }];
        if (request.func.name === "inspectBlooketPage")
          return [{ result: { ok: true,
            value: behavior === "challenge" ? "security-challenge" :
              "edit" } }];
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

test("source-safe read refuses challenge, redirect, card drift and bad frames",
  async () => {
  for (const behavior of ["challenge", "redirect", "drift",
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
