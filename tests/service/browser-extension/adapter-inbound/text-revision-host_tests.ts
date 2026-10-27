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
function fixture(loseSaveReply = false) {
  let origin = 100, saves = 0, reloads = 0;
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
      const title = saves ? "B.1.01 - Vocabulary of Lesson 1" : "Before";
      if (name === "inspectBlooketDocumentOrigin") result = origin;
      else if (name === "inspectBlooketDetailSidebar")
        result = { ok: true, value: { title, description: "Keep" } };
      else if (name === "inspectBlooketPage") result = { ok: true,
        value: { ...request.expectedSet, title } };
      else if (name === "runBlooketTextRevisionPageAction") {
        if (args[0] === "submit") {
          saves++;
          if (loseSaveReply) throw Error("lost submission reply");
          result = { ok: true };
        } else if (args[0] === "release") result = { ok: true };
        else result = { ok: true, mediaIdentity: "a".repeat(64) };
      } else if (["openBlooketDetailPanel", "closeBlooketDetailPanel",
        "isBlooketDetailPanelClosed"].includes(name)) result = true;
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

test("a lost native Save reply never reloads or resubmits the owned form",
  async () => {
    const f = fixture(true);
    assert.equal(await f.host.revise(request, false, Date.now() + 10_000),
      "uncertain");
    assert.equal(f.saves(), 1);
    assert.equal(f.reloads(), 0);
    assert.equal(f.calls.includes("closeBlooketDetailPanel"), false);
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
          } else if (func.name === "runBlooketTextRevisionPageAction") {
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
                   func.name === "closeBlooketQuestionPanel") result = true;
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
