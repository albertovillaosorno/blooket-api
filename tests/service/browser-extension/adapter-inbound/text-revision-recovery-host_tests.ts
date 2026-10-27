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
//   - Read-only recovery of an exact retained question-text Save.
// - Must-Not:
//   - Replay Save, alter media, adopt foreign editors, or invent success.
// - Allows:
//   - Inputs: Exact submitted owner, revision and bounded Chrome port.
//   - Outputs: Verified, unchanged or uncertain recovery; no Save.
//   - Side effects: One temporary read tab and confirmed source-panel cleanup.
// - Split-When:
//   - Provider media editing requires independent host mechanics.
// - Merge-When:
//   - Existing text edits share one provider mutation host.
// - Summary:
//   - Preserves the submitted form until an independent read finishes.
// - Description:
//   - A lost response permits verification only, never another Save.
// - Usage:
//   - Execute only through an admitted text.revise bridge command.
// - Defaults:
//   - Pre-submit failures refuse; post-submit failures remain uncertain.
//
import assert from "node:assert/strict";
import test from "node:test";
import { recoverRetainedTextRevision } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/service/browser-extension/adapter-inbound/text-revision-recovery-host.ts";
import type { BlooketTextRevision } from
  "../../../../src/ir/blooket-publication-commands/contract/text-revision.ts";

const input: BlooketTextRevision = { schemaVersion: 1, expectedSet: {
  schemaVersion: 1, id: "fixture", title: "Title", description: "Keep",
  visibility: "private" }, change: { kind: "question-text", previous: {
    schemaVersion: 4, number: 1, question: "Original", equation: null,
    qType: "mc", random: true, timeLimit: 20, hasAudio: false,
    hasImage: true, imageEvidence: null, answers: [
      { kind: "text", content: "Yes", correct: true, match: null },
      { kind: "text", content: "No", correct: false, match: null },
    ] }, question: "Corrected?", answers: ["Yes", "No"] } };

test("retained text recovery verifies independently before source cleanup",
  async () => {
    for (const state of ["verified", "unchanged", "mixed", "interrupted",
      "missing", "cleanup-failed"]) {
      let created = 0, removed = 0, released = false, read = false;
      let origin = 200;
      const identity = "a".repeat(64);
      const browser: Parameters<typeof recoverRetainedTextRevision>[0] = {
        tabs: {
          create: async options => {
            assert.equal(options.active, false); created++;
            return { id: 2, url: options.url, status: "complete" };
          },
          get: async () => ({ url:
            "https://dashboard.blooket.com/edit?id=fixture",
            status: "complete" }),
          update: async () => { throw Error("no source navigation"); },
          reload: async id => { assert.equal(id, 2); origin++; },
          remove: async id => {
            assert.equal(id, 2); removed++;
            if (state === "cleanup-failed") throw Error("retained read tab");
          },
        },
        scripting: { executeScript: async ({ target, func, args = [] }) => {
          let result: unknown;
          if (func.name === "inspectBlooketDocumentOrigin")
            result = target.tabId === 1 ? 100 : origin;
          else if (func.name === "inspectBlooketDetailSidebar") result = {
            ok: true, value: { title: "Title", description: "Keep" } };
          else if (func.name === "openBlooketQuestionPanel" ||
              func.name === "closeBlooketQuestionPanel") result = true;
          else if (func.name === "isBlooketQuestionPanelClosed")
            result = released;
          else if (func.name === "runBlooketTextRevisionPageAction") {
            assert.notEqual(args[0], "submit");
            assert.notEqual(args[0], "prepare");
            if (target.tabId === 1) {
              if (args[0] === "inspect-pending") result =
                state === "missing" || (state === "interrupted" && read)
                  ? { ok: false } : { ok: true, mediaIdentity: identity };
              else {
                assert.equal(args[0], "release-confirmed");
                assert.equal(read, true);
                assert.equal(args[2], identity);
                released = true; result = { ok: true };
              }
            } else {
              read = true;
              assert.equal(args[2], identity);
              result = { ok: args[0] === "verify-original"
                ? state === "unchanged"
                : state !== "unchanged" && state !== "mixed" };
            }
          } else throw Error("unexpected script " + func.name);
          return [{ result }];
        } },
      };
      const result = await recoverRetainedTextRevision(browser, 1, input,
        Date.now() + 10_000, async () => {});
      assert.equal(result, ["verified", "unchanged"].includes(state)
        ? state : state === "missing" ? undefined : "uncertain");
      assert.equal(created, state === "missing" ? 0 : 1);
      assert.equal(removed, created);
      assert.equal(released,
        ["verified", "unchanged", "cleanup-failed"].includes(state));
    }
  });
