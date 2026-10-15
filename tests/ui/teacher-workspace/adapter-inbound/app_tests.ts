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
//   - Synthetic Quizzes button lifetime and stop-control regressions.
// - Must-Not:
//   - Use a real browser, publish Blooket quizzes, or access user state.
// - Allows:
//   - Inputs: The UI control closure and deferred command replies.
//   - Outputs: Assertions about rendered stop controls and stale refreshes.
//   - Side effects: Fake in-memory DOM elements only.
// - Split-When:
//   - Quizzes controls move to an independent application module.
// - Merge-When:
//   - The Quizzes tab no longer uses asynchronous publication actions.
// - Summary:
//   - A late status response must never erase an active Stop control.
// - Description:
//   - Tests the actual Quizzes closure in a narrow synthetic DOM VM.
// - Usage:
//   - Run in the standard repository Node suite.
// - Defaults:
//   - No remote network, credentials, or provider writes.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

class Element {
  readonly children: Element[] = [];
  readonly dataset: Record<string, string> = {};
  readonly handlers = new Map<string, () => void>();
  textContent = "";
  type = "";
  disabled = false;
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; }
  setAttribute() {}
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) {
    this.children.splice(0, this.children.length, ...children);
  }
  addEventListener(name: string, listener: () => void) {
    this.handlers.set(name, listener);
  }
  findAction(name: string): Element | undefined {
    if (this.dataset.publicationAction === name) return this;
    for (const child of this.children) {
      const found = child.findAction(name);
      if (found) return found;
    }
    return undefined;
  }
  findAllActions(): Element[] {
    return [...(this.dataset.publicationAction ? [this] : []),
      ...this.children.flatMap(child => child.findAllActions())];
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function quizFixture(options: {
  readonly holdSecondList?: boolean;
  readonly holdThirdList?: boolean;
  readonly holdSecondStatus?: boolean;
} = {}) {
  const source = await readFile(new URL(
    "../../../../src/ui/teacher-workspace/adapter-inbound/app.js",
    import.meta.url,
  ), "utf8");
  const begin = source.indexOf("let activePublication = null;");
  const end = source.indexOf('document.querySelectorAll("[data-tab]")',
    begin);
  assert.ok(begin > 0 && end > begin);
  const root = new Element("div");
  const statusRefresh = deferred<unknown>();
  const finished = deferred<unknown>();
  const secondList = deferred<string[]>();
  const thirdList = deferred<string[]>();
  let listReads = 0, statusReads = 0;
  const calls: string[] = [];
  const document = {
    createElement: (tag: string) => new Element(tag),
    querySelectorAll: () => root.findAllActions(),
  };
  const sandbox = {
    document,
    $: () => root,
    t: (value: string) => value,
    AbortController,
    JSON,
    report: (error: unknown) => { throw error; },
    publicationStopReason: () => "unknown",
    publishTextDraft: async () => await finished.promise,
    command: async (name: string) => {
      calls.push(name);
      if (name === "drafts.list") {
        listReads++;
        if (listReads === 2 && options.holdSecondList)
          return await secondList.promise;
        if (listReads === 3 && options.holdThirdList)
          return await thirdList.promise;
        return ["synthetic"];
      }
      if (name === "drafts.get") return {
        revision: "r", document: { title: "Synthetic quiz" },
      };
      if (name === "blooket.publication.status") {
        statusReads++;
        if (statusReads === 2 && options.holdSecondStatus !== false)
          return await statusRefresh.promise;
        return { phase: "ready", completedOperations: 0,
          totalOperations: 2, published: false };
      }
      throw Error("unexpected fixture command");
    },
  };
  const api = runInNewContext(source.slice(begin, end) +
    "\n({ loadQuizzes });", sandbox) as {
      loadQuizzes: () => Promise<void>;
    };
  await api.loadQuizzes();
  return { root, calls, statusRefresh, finished,
    secondList, thirdList, loadQuizzes: api.loadQuizzes };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

test("late Quizzes refresh never hides Stop during publication", async () => {
  const ui = await quizFixture();
  const refresh = ui.root.findAction("refresh");
  const publish = ui.root.findAction("publish");
  assert.ok(refresh && publish);
  refresh.handlers.get("click")?.();
  publish.handlers.get("click")?.();
  assert.ok(ui.root.findAction("stop"));
  ui.statusRefresh.resolve({ phase: "ready", completedOperations: 0,
    totalOperations: 2, published: false });
  await flush();
  assert.ok(ui.root.findAction("stop"), "a stale refresh removed Stop");
  ui.finished.resolve({ phase: "paused", published: false });
  await flush();
  assert.equal(ui.root.findAction("stop"), undefined);
  assert.ok(ui.root.findAction("refresh"));
});

test("after Stop completes, Refresh restores the current draft actions",
  async () => {
  const ui = await quizFixture();
  ui.root.findAction("refresh")?.handlers.get("click")?.();
  ui.root.findAction("publish")?.handlers.get("click")?.();
  assert.ok(ui.root.findAction("stop"));
  ui.finished.resolve({ phase: "paused", published: false });
  await flush();
  assert.ok(ui.root.findAction("refresh"));
  assert.equal(ui.root.findAction("publish"), undefined);
  ui.statusRefresh.resolve({ phase: "ready", completedOperations: 0,
    totalOperations: 2, published: false });
  await flush();
  assert.equal(ui.root.findAction("publish"), undefined);
  ui.root.findAction("refresh")?.handlers.get("click")?.();
  await flush();
  assert.ok(ui.root.findAction("publish"),
    "the committed operation left Refresh permanently inert");
});


test("a pending Quizzes rebuild cannot remove Stop after Publish begins",
  async () => {
  const ui = await quizFixture({ holdSecondList: true,
    holdSecondStatus: false });
  const rebuilding = ui.loadQuizzes();
  ui.root.findAction("publish")?.handlers.get("click")?.();
  assert.ok(ui.root.findAction("stop"));
  ui.secondList.resolve(["synthetic"]);
  await rebuilding;
  assert.ok(ui.root.findAction("stop"));
  assert.equal(ui.root.children.length, 1);
  ui.finished.resolve({ phase: "paused", published: false });
  await flush();
});

test("older Quizzes list responses never overwrite the newest view",
  async () => {
  const ui = await quizFixture({ holdSecondList: true,
    holdThirdList: true, holdSecondStatus: false });
  const older = ui.loadQuizzes();
  const latest = ui.loadQuizzes();
  ui.thirdList.resolve(["synthetic"]);
  await latest;
  const newestArticle = ui.root.children[0];
  ui.secondList.resolve([]);
  await older;
  assert.equal(ui.root.children.length, 1);
  assert.equal(ui.root.children[0], newestArticle);
});
