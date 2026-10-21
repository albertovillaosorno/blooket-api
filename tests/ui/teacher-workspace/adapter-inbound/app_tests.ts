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
import { publicationStopReason, recoveredPublicationAction,
  verifiedPublicationResult, publicationStatusForView,
  waitForPublicationReadCooldown } from
  "../../../../src/ui/teacher-workspace/adapter-inbound/publication.js";

test("an uncertain throttled Save has a distinct waiting label", async () => {
  const source = await readFile(new URL(
    "../../../../src/ui/teacher-workspace/adapter-inbound/app.js",
    import.meta.url,
  ), "utf8");
  const start = source.indexOf("function publicationLabel(");
  const end = source.indexOf("\nfunction ", start + 1);
  assert.ok(start > 0 && end > start);
  const label = runInNewContext("(" + source.slice(start, end) + ")", {
    t: (key: string) => key,
  });
  assert.equal(label({ phase: "reconciliation-required",
    state: "rate-limited" }), "publicationRateLimitedUncertain");
  assert.equal(label({ phase: "reconciliation-required" }),
    "publicationUncertain");
  assert.equal(label({ phase: "wait", state: "rate-limited" }),
    "publicationRateLimited");
  assert.equal(label({ phase: "session-required", state: "signed-out" }),
    "readSignedOut");
  assert.equal(label({ phase: "session-required",
    state: "expired-session" }), "readSignedOut");
});

test("localized publication errors identify repairable single-row edits",
  async () => {
  const source = await readFile(new URL(
    "../../../../src/ui/teacher-workspace/adapter-inbound/app.js",
    import.meta.url,
  ), "utf8");
  const start = source.indexOf("function publicationFailureText(");
  const end = source.indexOf("\nasync function ", start + 1);
  assert.ok(start > 0 && end > start);
  const label = runInNewContext("(" + source.slice(start, end) + ")", {
    t: (key: string) => key, publicationStopReason,
  });
  assert.equal(label(Error("blooket-publication-single-edit-required")),
    "publicationStopSingleEdit");
  assert.equal(label(Error("blooket-publication-edit-unsupported")),
    "publicationStopEditUnsupported");
  assert.equal(label(Error("blooket-write-baseline-not-captured")),
    "publicationStopVerification");
  assert.equal(label(Error("blooket-browser-failed")),
    "publicationStopVerification");
  assert.equal(label(Error("blooket-browser-unavailable")),
    "publicationStopConnection");
  for (const key of ["publicationStopSingleEdit",
    "publicationStopEditUnsupported", "publicationStopVerification",
    "publicationStopConnection"]) {
    assert.equal(source.split(key + ":").length - 1, 2,
      "both Spanish and English must explain the stop");
  }
});

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
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function quizFixture(options: {
  readonly holdSecondList?: boolean;
  readonly holdThirdList?: boolean;
  readonly holdSecondStatus?: boolean;
  readonly failFirstStatus?: boolean;
  readonly failSecondStatus?: boolean;
  readonly holdThirdStatus?: boolean;
  readonly uncertainAtStart?: boolean;
  readonly reconcileOutcome?: "recovered" | "reconciliation-required";
  readonly holdReconcile?: boolean;
  readonly holdVerify?: boolean;
  readonly writesCompleteAtStart?: boolean;
  readonly forgedVerifiedStatus?: boolean;
  readonly pauseDuringPublish?: boolean;
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
  const thirdStatus = deferred<unknown>();
  const finished = deferred<unknown>();
  const reconcileResponse = deferred<unknown>();
  const verifyResponse = deferred<unknown>();
  const secondList = deferred<string[]>();
  const thirdList = deferred<string[]>();
  let listReads = 0, statusReads = 0;
  let cancelled: (() => boolean) | undefined;
  let cooldownObserved = 0;
  let cooldownResult: boolean | undefined;
  const calls: string[] = [];
  const reported: unknown[] = [];
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
    report: (error: unknown) => { reported.push(error); },
    publicationStopReason: () => "unknown",
    recoveredPublicationAction,
    verifiedPublicationResult,
    publicationStatusForView,
    waitForPublicationReadCooldown,
    publishTextDraft: async (_id: unknown, _rev: unknown,
      _send: unknown, _progress: unknown, isCancelled: () => boolean,
      waitForRetry: () => Promise<boolean>) => {
      calls.push("publishTextDraft");
      cancelled = isCancelled;
      if (options.pauseDuringPublish) {
        cooldownObserved++;
        cooldownResult = await waitForRetry();
        return { phase: "paused", published: false };
      }
      return await finished.promise;
    },
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
      if (name === "blooket.publication.reconcile" &&
          options.holdReconcile) return await reconcileResponse.promise;
      if (name === "blooket.publication.verify" && options.holdVerify)
        return await verifyResponse.promise;
      if (name === "blooket.publication.reconcile" &&
          options.reconcileOutcome)
        return { draftId: "synthetic", revision: "a".repeat(64),
          phase: options.reconcileOutcome, published: false,
          completedOperations: options.reconcileOutcome === "recovered" ?
            2 : 1, totalOperations: options.reconcileOutcome === "recovered"
              ? 3 : 2, remoteSetId: "synthetic-set" };
      if (name === "blooket.publication.status") {
        statusReads++;
        if (statusReads === 1 && options.failFirstStatus)
          throw Error("blooket-browser-failed");
        if (statusReads === 2 && options.failSecondStatus)
          throw Error("blooket-browser-failed");
        if (statusReads === 2 && options.holdSecondStatus !== false)
          return await statusRefresh.promise;
        if (statusReads === 3 && options.holdThirdStatus)
          return await thirdStatus.promise;
        return options.forgedVerifiedStatus
          ? { draftId: "synthetic", revision: "a".repeat(64),
            phase: "verified", published: true,
            completedOperations: 2, totalOperations: 2,
            remoteSetId: "synthetic-set", verifiedAt: "stale" }
          : options.writesCompleteAtStart
          ? { draftId: "synthetic", revision: "a".repeat(64),
            phase: "writes-complete", completedOperations: 2,
            totalOperations: 2, remoteSetId: "synthetic-set",
            published: false }
          : options.uncertainAtStart
          ? { draftId: "synthetic", revision: "a".repeat(64),
            phase: "reconciliation-required", completedOperations: 1,
            totalOperations: options.reconcileOutcome === "recovered" ?
              3 : 2, remoteSetId: "synthetic-set",
            published: false }
          : { draftId: "synthetic", revision: "a".repeat(64),
            phase: "ready", completedOperations: 0,
            totalOperations: 2, remoteSetId: null, published: false };
      }
      throw Error("unexpected fixture command");
    },
  };
  const api = runInNewContext(source.slice(begin, end) +
    "\n({ loadQuizzes });", sandbox) as {
      loadQuizzes: () => Promise<void>;
    };
  await api.loadQuizzes();
  return { root, calls, reported, statusRefresh, thirdStatus, finished,
    reconcileResponse, verifyResponse,
    secondList, thirdList, loadQuizzes: api.loadQuizzes,
    isCancelled: () => cancelled?.(),
    cooldownObserved: () => cooldownObserved,
    cooldownResult: () => cooldownResult };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

test("failed initial status always offers a read-only Refresh control",
  async () => {
  const ui = await quizFixture({ failFirstStatus: true });
  assert.ok(ui.root.findAction("refresh"));
  assert.equal(ui.root.findAction("publish"), undefined);
  assert.equal(ui.root.findAction("verify"), undefined);
});

test("transient status failure removes stale write controls",
  async () => {
  const ui = await quizFixture({ failSecondStatus: true });
  assert.ok(ui.root.findAction("publish"));
  ui.root.findAction("refresh")?.handlers.get("click")?.();
  await flush();
  assert.equal(ui.root.findAction("publish"), undefined);
  assert.equal(ui.root.findAction("verify"), undefined);
  assert.ok(ui.root.findAction("refresh"));
  assert.equal(ui.calls.includes("publishTextDraft"), false);
  ui.root.findAction("refresh")?.handlers.get("click")?.();
  await flush();
  assert.ok(ui.root.findAction("publish"),
    "a fresh valid status should restore the action");
});

test("status alone never advertises verified publication",
  async () => {
  const ui = await quizFixture({ forgedVerifiedStatus: true });
  assert.notEqual(ui.root.children[0]?.children[2]?.textContent,
    "publicationVerified");
  assert.equal(ui.root.findAction("publish"), undefined);
  assert.equal(ui.root.findAction("verify"), undefined);
});

test("uncertain journals offer read-only reconcile and explicit resume",
  async () => {
  const ui = await quizFixture({ uncertainAtStart: true });
  const reconcile = ui.root.findAction("reconcile");
  const resume = ui.root.findAction("publish");
  assert.ok(reconcile && resume,
    "resume requires an explicit teacher click");
  assert.equal(ui.calls.includes("publishTextDraft"), false);
  resume.handlers.get("click")?.();
  assert.ok(ui.root.findAction("stop"));
  assert.equal(ui.calls.filter(x => x === "publishTextDraft").length, 1);
  ui.finished.resolve({ phase: "reconciliation-required", published: false });
  await flush();
  assert.equal(ui.root.findAction("stop"), undefined);
});

test("the standalone Reconcile button does not start publication",
  async () => {
  const ui = await quizFixture({ uncertainAtStart: true });
  const reconcile = ui.root.findAction("reconcile");
  assert.ok(reconcile);
  reconcile.handlers.get("click")?.();
  await flush();
  assert.ok(ui.calls.includes("blooket.publication.reconcile"));
  assert.equal(ui.calls.includes("publishTextDraft"), false);
  assert.equal(ui.root.findAction("stop"), undefined);
});

test("successful read-only recovery offers explicit one-click resume",
  async () => {
  const ui = await quizFixture({ uncertainAtStart: true,
    reconcileOutcome: "recovered" });
  ui.root.findAction("reconcile")?.handlers.get("click")?.();
  await flush();
  assert.ok(ui.root.findAction("publish"),
    "recovered progress should offer resume without an extra Refresh");
  assert.equal(ui.calls.includes("publishTextDraft"), false);
  ui.root.findAction("publish")?.handlers.get("click")?.();
  assert.equal(ui.calls.filter(name => name === "publishTextDraft").length, 1);
  ui.finished.resolve({ phase: "paused", published: false });
  await flush();
});

test("inconclusive read-only recovery never exposes a write action",
  async () => {
  const ui = await quizFixture({ uncertainAtStart: true,
    reconcileOutcome: "reconciliation-required" });
  ui.root.findAction("reconcile")?.handlers.get("click")?.();
  await flush();
  assert.equal(ui.root.findAction("publish"), undefined);
  assert.equal(ui.calls.includes("publishTextDraft"), false);
  assert.ok(ui.root.findAction("refresh"));
});

test("direct Verify refuses stale or cross-set claims of success",
  async () => {
  const canonical = {
    draftId: "synthetic", revision: "a".repeat(64),
    phase: "verified", completedOperations: 2, totalOperations: 2,
    remoteSetId: "synthetic-set", published: true,
    verifiedAt: "2026-10-21T12:00:00.000Z",
  };
  for (const invalid of [
    { ...canonical, draftId: "another-draft" },
    { ...canonical, remoteSetId: "foreign-set" },
    { ...canonical, revision: "b".repeat(64) },
    { ...canonical, completedOperations: 1 },
    { ...canonical, verifiedAt: "" },
    { ...canonical, verifiedAt: undefined },
    { phase: "verified", published: true },
  ]) {
    const ui = await quizFixture({ writesCompleteAtStart: true,
      holdVerify: true });
    ui.root.findAction("verify")?.handlers.get("click")?.();
    ui.verifyResponse.resolve(invalid);
    await flush();
    assert.notEqual(ui.root.children[0]?.children[2]?.textContent,
      "publicationVerified");
    assert.ok(ui.root.findAction("refresh"));
  }
  const ui = await quizFixture({ writesCompleteAtStart: true,
    holdVerify: true });
  ui.root.findAction("verify")?.handlers.get("click")?.();
  ui.verifyResponse.resolve(canonical);
  await flush();
  assert.equal(ui.root.children[0]?.children[2]?.textContent,
    "publicationVerified");
  const waiting = await quizFixture({ writesCompleteAtStart: true,
    holdVerify: true });
  waiting.root.findAction("verify")?.handlers.get("click")?.();
  waiting.verifyResponse.resolve({ ...canonical, phase: "wait",
    published: false, state: "rate-limited", verifiedAt: undefined });
  await flush();
  assert.equal(waiting.root.children[0]?.children[2]?.textContent,
    "publicationRateLimited");
  assert.equal(waiting.root.findAction("publish"), undefined);
});

test("malformed recovered response never enables Verify or Resume",
  async () => {
  for (const forged of [
    { phase: "recovered", published: false },
    { phase: "recovered", published: false,
      completedOperations: 2, totalOperations: 2 },
    { phase: "recovered", published: false,
      completedOperations: 2, totalOperations: 3,
      remoteSetId: "foreign-set" },
  ]) {
    const ui = await quizFixture({ uncertainAtStart: true,
      holdReconcile: true });
    ui.root.findAction("reconcile")?.handlers.get("click")?.();
    ui.reconcileResponse.resolve(forged);
    await flush();
    assert.equal(ui.root.findAction("publish"), undefined);
    assert.equal(ui.root.findAction("verify"), undefined);
    assert.equal(ui.calls.includes("publishTextDraft"), false);
  }
});

test("Stop during a pending read-only recovery never enables Resume",
  async () => {
  const ui = await quizFixture({ uncertainAtStart: true,
    holdReconcile: true });
  ui.root.findAction("reconcile")?.handlers.get("click")?.();
  assert.ok(ui.root.findAction("stop"));
  ui.root.findAction("stop")?.handlers.get("click")?.();
  ui.reconcileResponse.resolve({ phase: "recovered", published: false,
    completedOperations: 2, totalOperations: 3,
    remoteSetId: "synthetic-set" });
  await flush();
  assert.equal(ui.root.findAction("publish"), undefined);
  assert.equal(ui.root.findAction("verify"), undefined);
  assert.equal(ui.calls.includes("publishTextDraft"), false);
  assert.ok(ui.root.findAction("refresh"));
});

test("a late successful Publish reply after Stop cannot claim verification",
  async () => {
  const ui = await quizFixture();
  ui.root.findAction("publish")?.handlers.get("click")?.();
  ui.root.findAction("stop")?.handlers.get("click")?.();
  ui.finished.resolve({ phase: "verified", published: true });
  await flush();
  assert.equal(ui.root.children[0]?.children[2]?.textContent,
    "publicationPaused");
  assert.equal(ui.root.findAction("verify"), undefined);
  assert.equal(ui.root.findAction("publish"), undefined);
});

test("late recovered Reconcile after Stop cannot claim progress in Studio",
  async () => {
  const ui = await quizFixture({ uncertainAtStart: true,
    holdReconcile: true });
  ui.root.findAction("reconcile")?.handlers.get("click")?.();
  ui.root.findAction("stop")?.handlers.get("click")?.();
  ui.reconcileResponse.resolve({ phase: "recovered", published: false,
    completedOperations: 2, totalOperations: 3,
    remoteSetId: "synthetic-set" });
  await flush();
  assert.equal(ui.root.children[0]?.children[2]?.textContent,
    "publicationPaused");
  assert.equal(ui.root.findAction("publish"), undefined);
});

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


test("older status requests cannot re-enable Publish after Verify",
  async () => {
  const ui = await quizFixture({ holdThirdStatus: true });
  const initialRefresh = ui.root.findAction("refresh");
  initialRefresh?.handlers.get("click")?.();
  initialRefresh?.handlers.get("click")?.();
  ui.thirdStatus.resolve({ draftId: "synthetic",
    revision: "a".repeat(64), phase: "writes-complete", published: false,
    completedOperations: 2, totalOperations: 2,
    remoteSetId: "synthetic-set" });
  await flush();
  assert.ok(ui.root.findAction("verify"));
  ui.statusRefresh.resolve({ phase: "ready", published: false,
    completedOperations: 0, totalOperations: 2 });
  await flush();
  assert.ok(ui.root.findAction("verify"),
    "an old status reply restored an obsolete Publish action");
  assert.equal(ui.root.findAction("publish"), undefined);
});


test("Stop cancels a rate-limit cooldown without delaying the UI",
  async () => {
  const ui = await quizFixture({ pauseDuringPublish: true });
  ui.root.findAction("publish")?.handlers.get("click")?.();
  assert.equal(ui.cooldownObserved(), 1);
  const stop = ui.root.findAction("stop");
  assert.ok(stop);
  stop.handlers.get("click")?.();
  await flush();
  assert.equal(ui.cooldownResult(), false);
  assert.equal(ui.root.findAction("stop"), undefined);
  assert.ok(ui.root.findAction("refresh"));
  assert.deepEqual(ui.calls.filter(name => name === "publishTextDraft"),
    ["publishTextDraft"]);
});

test("Stop signals cancellation and is disabled until task settles",
  async () => {
  const ui = await quizFixture();
  ui.root.findAction("publish")?.handlers.get("click")?.();
  const stop = ui.root.findAction("stop");
  assert.ok(stop);
  assert.equal(ui.isCancelled(), false);
  stop.handlers.get("click")?.();
  assert.equal(stop.disabled, true);
  assert.equal(ui.isCancelled(), true);
  ui.finished.resolve({ phase: "paused", published: false });
  await flush();
  assert.equal(ui.root.findAction("stop"), undefined);
  assert.ok(ui.root.findAction("refresh"));
});


test("stale failing Refresh does not interrupt an active publication",
  async () => {
  const ui = await quizFixture();
  ui.root.findAction("refresh")?.handlers.get("click")?.();
  ui.root.findAction("publish")?.handlers.get("click")?.();
  assert.ok(ui.root.findAction("stop"));
  ui.statusRefresh.reject(Error("simulated-stale-status-failure"));
  await flush();
  assert.deepEqual(ui.reported, []);
  assert.ok(ui.root.findAction("stop"));
  ui.finished.resolve({ phase: "paused", published: false });
  await flush();
});
