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
//   - One native existing-text edit and independent reloaded verification.
// - Must-Not:
//   - Replay Save, alter media, adopt foreign editors, or invent success.
// - Allows:
//   - Inputs: Dedicated exact tab, decoded request and finite deadline.
//   - Outputs: Verified, explicitly not submitted, or uncertain outcome.
//   - Side effects: Native owned editor, one Save and a fresh reload.
// - Split-When:
//   - Provider media editing requires independent host mechanics.
// - Merge-When:
//   - Existing text edits share one provider mutation host.
// - Summary:
//   - Preserves images during bounded title and question-text corrections.
// - Description:
//   - A lost response permits verification only, never another Save.
// - Usage:
//   - Execute only through an admitted text.revise bridge command.
// - Defaults:
//   - Pre-submit failures refuse; post-submit failures remain uncertain.
//
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionTextRevisionHost } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/service/browser-extension/adapter-inbound/text-revision-host.ts";
import type { AddQuestionChromePort } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/service/browser-extension/adapter-inbound/add-question-host.ts";
import type { BlooketTextRevision } from
  "../../../../src/ir/blooket-publication-commands/contract/text-revision.ts";

const request: BlooketTextRevision = { schemaVersion: 1,
  expectedSet: { schemaVersion: 1, id: "fixture", title: "Before",
    description: "Keep", visibility: "public" },
  change: { kind: "set-title", title: "B.1.01 - Vocabulary of Lesson 1" } };
function fixture(loseSaveReply = false,
  input: BlooketTextRevision = request, persist = true,
  cancel: "confirmed" | "lost-closed" | "thrown-closed" = "confirmed",
  releaseWatch = false, replaceDocumentOnRelease = false,
  loseClosureProbe = false, stuckClosure = false,
  closureDelay = 0) {
  let origin = 100, saves = 0, reloads = 0, closureProbes = 0;
  const calls: string[] = [];
  const browser: AddQuestionChromePort = {
    tabs: { get: async () => ({ status: "complete",
      url: "https://dashboard.blooket.com/edit?id=fixture" }),
      update: async () => { throw Error("unexpected navigation"); },
      reload: async () => { origin++; reloads++; },
    },
    scripting: { executeScript: async ({ func, args = [] }) => {
      assert.equal(args.some(value => value === undefined), false,
        "Chrome scripting arguments must be JSON serializable");
      const name = func.name;
      calls.push(name + (name === "runBlooketTextRevisionPageAction"
        ? ":" + args[0] : ""));
      let result: unknown;
      const title = saves && persist && input.change.kind === "set-title"
        ? input.change.title : "Before";
      const description = saves && persist &&
        input.change.kind === "set-description"
        ? input.change.description : "Keep";
      if (name === "inspectBlooketDocumentOrigin") result = origin;
      else if (name === "inspectBlooketDetailSidebar")
        result = { ok: true, value: { title, description } };
      else if (name === "inspectBlooketPage") result = { ok: true,
        value: { ...input.expectedSet, title, description } };
      else if (name === "runBlooketTextRevisionPageAction") {
        if (args[0] === "submit") {
          saves++;
          if (loseSaveReply) throw Error("lost submission reply");
          result = { ok: true };
        } else if (args[0] === "release") result = { ok: true };
        else if (args[0] === "verify" && saves && !persist)
          result = { ok: false };
        else result = { ok: true, mediaIdentity: "a".repeat(64) };
      } else if (name === "closeBlooketDetailPanel") {
        if (cancel === "thrown-closed") throw Error("lost Cancel reply");
        result = cancel === "confirmed";
      }
      else if (name === "releaseClosedBlooketDetailReadWatch") {
        if (replaceDocumentOnRelease) origin++;
        result = releaseWatch;
      }
      else if (name === "isBlooketDetailPanelClosed") {
        if (loseClosureProbe) throw Error("closure read unavailable");
        result = !stuckClosure && ++closureProbes > closureDelay;
      }
      else if (name === "openBlooketDetailPanel") result = true;
      else throw Error("unexpected script " + name);
      return [{ result }];
    } },
  };
  return { host: createExtensionTextRevisionHost(browser, 1, async () => {}),
    saves: () => saves, reloads: () => reloads, calls };
}

test("title correction confirms one Save in a new native document",
  async () => {
    const f = fixture();
    assert.equal(await f.host.revise(request, false, Date.now() + 10_000),
      "verified");
    assert.equal(f.saves(), 1);
    assert.equal(f.reloads(), 1);
    assert.ok(f.calls.indexOf("runBlooketTextRevisionPageAction:submit") <
      f.calls.indexOf("runBlooketTextRevisionPageAction:verify"));
  });

test("description correction verifies saved text after a fresh reload",
  async () => {
    const input: BlooketTextRevision = { ...request,
      change: { kind: "set-description",
        description: "Learn everyday English vocabulary." } };
    const f = fixture(false, input);
    assert.equal(await f.host.revise(input, false, Date.now() + 10_000),
      "verified");
    assert.equal(f.saves(), 1);
    assert.equal(f.reloads(), 1);
  });

test("a lost native Save reply never reloads or resubmits the owned form",
  async () => {
    const f = fixture(true);
    assert.equal(await f.host.revise(request, false, Date.now() + 10_000),
      "uncertain");
    assert.equal(f.saves(), 1);
    assert.equal(f.reloads(), 0);
    assert.equal(f.calls.includes("closeBlooketDetailPanel"), false);
  });

test("lost metadata Cancel reply needs an exact orphan-watch release",
  async () => {
    for (const cancel of ["lost-closed", "thrown-closed"] as const) {
      for (const released of [false, true]) {
        const f = fixture(false, request, true, cancel, released);
        assert.equal(await f.host.revise(request, true,
          Date.now() + 10_000), released ? "verified" : "uncertain");
        assert.equal(f.saves(), 0, "Recovery cannot click Save");
        assert.equal(f.calls.filter(x => x ===
          "closeBlooketDetailPanel").length, 1,
          "A lost Cancel reply must not cause another Cancel click");
        assert.equal(f.calls.filter(x => x ===
          "releaseClosedBlooketDetailReadWatch").length, 1);
      }
    }
    const replaced = fixture(false, request, true, "thrown-closed",
      true, true);
    assert.equal(await replaced.host.revise(request, true,
      Date.now() + 10_000), "uncertain");
    assert.equal(replaced.saves(), 0);
    assert.equal(replaced.calls.filter(x =>
      x === "closeBlooketDetailPanel").length, 1);
    const missingProof = fixture(false, request, true, "thrown-closed",
      false, false, true);
    assert.equal(await missingProof.host.revise(request, true,
      Date.now() + 10_000), "uncertain");
    assert.equal(missingProof.saves(), 0);
    assert.equal(missingProof.calls.filter(x =>
      x === "closeBlooketDetailPanel").length, 1,
      "An unreadable closure cannot trigger a second Cancel click");
  });

test("acknowledged metadata Cancel still needs closed-form evidence",
  async () => {
    const f = fixture(false, request, true, "confirmed",
      false, false, false, true);
    assert.equal(await f.host.revise(request, true,
      Date.now() + 10_000), "uncertain");
    assert.equal(f.saves(), 0);
    assert.equal(f.calls.filter(x =>
      x === "closeBlooketDetailPanel").length, 1,
      "Do not retry an acknowledged Cancel");
    assert.ok(f.calls.filter(x =>
      x === "isBlooketDetailPanelClosed").length >= 2);
    const hydrated = fixture(false, request, true, "confirmed",
      false, false, false, false, 2);
    assert.equal(await hydrated.host.revise(request, true,
      Date.now() + 10_000), "verified");
    assert.equal(hydrated.calls.filter(x =>
      x === "isBlooketDetailPanelClosed").length, 3);
    assert.equal(hydrated.calls.filter(x =>
      x === "closeBlooketDetailPanel").length, 1);
    const unknown = fixture(false, request, true, "confirmed",
      false, false, true);
    assert.equal(await unknown.host.revise(request, true,
      Date.now() + 10_000), "uncertain");
    assert.equal(unknown.calls.filter(x =>
      x === "closeBlooketDetailPanel").length, 1);
  });

test("an unchanged metadata Save requires two fresh native documents to rearm",
  async () => {
    const f = fixture(true, request, false);
    assert.equal(await f.host.revise(request, false, Date.now() + 10_000),
      "uncertain");
    assert.equal(f.saves(), 1);
    assert.equal(await f.host.revise(request, true, Date.now() + 10_000),
      "unchanged");
    assert.equal(f.reloads(), 1);
    assert.equal(f.saves(), 1);
  });

test("unchanged recovery requires two fresh original-row observations",
  async () => {
    const input: BlooketTextRevision = { ...request, change: {
      kind: "question-text", previous: { schemaVersion: 4, number: 1,
        question: "Before", equation: null, qType: "mc", random: true,
        timeLimit: 20, hasImage: false, imageEvidence: null, hasAudio: false,
        answers: [{ kind: "text", content: "Yes", correct: true, match: null },
          { kind: "text", content: "No", correct: false, match: null }] },
      question: "After?", answers: ["Yes", "No"],
    } };
    for (const drift of [false, true]) {
      let origin = 1, reads = 0, closes = 0;
      const browser: AddQuestionChromePort = {
        tabs: { get: async () => ({ status: "complete",
          url: "https://dashboard.blooket.com/edit?id=fixture" }),
          update: async () => { throw Error("unexpected navigation"); },
          reload: async () => { origin++; },
        },
        scripting: { executeScript: async ({ func, args = [] }) => {
          let result: unknown;
          if (func.name === "inspectBlooketDocumentOrigin") result = origin;
          else if (func.name === "inspectBlooketDetailSidebar") result = {
            ok: true, value: { title: "Before", description: "Keep" } };
          else if (func.name === "openBlooketQuestionPanel") result = true;
          else if (func.name === "closeBlooketQuestionPanel") {
            closes++; result = true;
          } else if (func.name === "isBlooketQuestionPanelClosed")
            result = true;
          else if (func.name === "runBlooketTextRevisionPageAction") {
            assert.notEqual(args[0], "submit");
            assert.notEqual(args[0], "prepare");
            if (args[0] === "verify-original") {
              reads++;
              result = { ok: !(drift && reads === 2) };
            } else result = { ok: false };
          } else throw Error("unexpected script " + func.name);
          return [{ result }];
        } },
      };
      const host = createExtensionTextRevisionHost(browser, 1,
        async () => {});
      assert.equal(await host.revise(input, true, Date.now() + 10_000),
        drift ? "uncertain" : "unchanged");
      assert.equal(reads, 2);
      assert.equal(origin, 2);
      assert.equal(closes, 2);
    }
  });


test("question Cancel needs closure and never re-clicks after lost reply",
  async () => {
    const input: BlooketTextRevision = { ...request, change: {
      kind: "question-text", previous: { schemaVersion: 4, number: 1,
        question: "Before", equation: null, qType: "mc", random: true,
        timeLimit: 20, hasImage: false, imageEvidence: null, hasAudio: false,
        answers: [{ kind: "text", content: "Yes", correct: true, match: null },
          { kind: "text", content: "No", correct: false, match: null }] },
      question: "After?", answers: ["Yes", "No"],
    } };
    for (const cancel of ["acknowledged-open", "lost-closed",
      "lost-open", "refused"] as const) {
      let closes = 0, saves = 0;
      const browser: AddQuestionChromePort = {
        tabs: { get: async () => ({ status: "complete",
          url: "https://dashboard.blooket.com/edit?id=fixture" }),
          update: async () => { throw Error("unexpected navigation"); },
          reload: async () => { throw Error("unexpected reload"); },
        },
        scripting: { executeScript: async ({ func, args = [] }) => {
          let result: unknown;
          if (func.name === "inspectBlooketDocumentOrigin") result = 100;
          else if (func.name === "inspectBlooketDetailSidebar") result = {
            ok: true, value: { title: "Before", description: "Keep" },
          };
          else if (func.name === "openBlooketQuestionPanel") result = true;
          else if (func.name === "closeBlooketQuestionPanel") {
            closes++;
            if (cancel.startsWith("lost"))
              throw Error("Cancel applied but reply lost");
            result = cancel !== "refused";
          } else if (func.name === "isBlooketQuestionPanelClosed")
            result = cancel === "lost-closed";
          else if (func.name === "runBlooketTextRevisionPageAction") {
            if (args[0] === "submit") saves++;
            result = { ok: true };
          } else throw Error("unexpected script " + func.name);
          return [{ result }];
        } },
      };
      const host = createExtensionTextRevisionHost(browser, 1,
        async () => {});
      assert.equal(await host.revise(input, true, Date.now() + 10_000),
        "uncertain");
      assert.equal(saves, 0);
      assert.equal(closes, 1, "Cancel cannot be clicked twice");
    }
  });

test("image recovery without old bytes binds native media across reloads",
  async () => {
    const input: BlooketTextRevision = { ...request, change: {
      kind: "question-text", previous: { schemaVersion: 4, number: 27,
        question: "Before", equation: null, qType: "mc", random: true,
        timeLimit: 20, hasImage: true, imageEvidence: null, hasAudio: false,
        answers: [{ kind: "text", content: "Yes", correct: true, match: null },
          { kind: "text", content: "No", correct: false, match: null }] },
      question: "After?", answers: ["Yes", "No"],
    } };
    for (const changedMedia of [false, true]) {
      let origin = 1, reads = 0, reloads = 0, saves = 0;
      const digest = "a".repeat(64);
      const browser: AddQuestionChromePort = {
        tabs: { get: async () => ({ status: "complete",
          url: "https://dashboard.blooket.com/edit?id=fixture" }),
          update: async () => { throw Error("unexpected navigation"); },
          reload: async () => { origin++; reloads++; },
        },
        scripting: { executeScript: async ({ func, args = [] }) => {
          let result: unknown;
          if (func.name === "inspectBlooketDocumentOrigin") result = origin;
          else if (func.name === "inspectBlooketDetailSidebar") result = {
            ok: true, value: { title: "Before", description: "Keep" } };
          else if (func.name === "openBlooketQuestionPanel" ||
                   func.name === "closeBlooketQuestionPanel" ||
                   func.name === "isBlooketQuestionPanelClosed")
            result = true;
          else if (func.name === "runBlooketTextRevisionPageAction") {
            if (args[0] === "submit" || args[0] === "prepare") saves++;
            if (args[0] === "verify-original") {
              reads++;
              assert.equal(args[2], reads === 1 ? undefined : digest);
              result = { ok: !(changedMedia && reads === 2),
                mediaIdentity: changedMedia && reads === 2
                  ? "b".repeat(64) : digest };
            } else result = { ok: false };
          } else throw Error("unexpected script " + func.name);
          return [{ result }];
        } },
      };
      const host = createExtensionTextRevisionHost(browser, 1,
        async () => {});
      assert.equal(await host.revise(input, true, Date.now() + 10_000),
        changedMedia ? "uncertain" : "unchanged");
      assert.equal(reads, 2);
      assert.equal(reloads, 1);
      assert.equal(saves, 0);
    }
  });
