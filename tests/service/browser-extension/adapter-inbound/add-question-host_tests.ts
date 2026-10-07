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
//   - Synthetic Chrome-host tests for text-only Add Question confirmation.
// - Must-Not:
//   - Contact Blooket, upload files, or treat form submission as success.
// - Allows:
//   - Inputs: Deterministic tabs and page-script results.
//   - Outputs: Submit-count, stop propagation, and read-back assertions.
//   - Side effects: In-memory fake browser state only.
// - Split-When:
//   - Media-backed question hosting gains separate browser mechanics.
// - Merge-When:
//   - Add Question Chrome hosting is removed.
// - Summary:
//   - Proves one submit requires exact question read-back before success.
// - Description:
//   - Post-submit mismatch remains a browser failure for reconciliation.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Foreign tabs and challenge states fail before mutation.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  createExtensionAddQuestionHost,
  type AddQuestionChromePort,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/service/browser-extension/adapter-inbound/add-question-host.ts";
import type { BlooketTextQuestionPageInput } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/blooket-browser/adapter-outbound/add-question-page.ts";

const input: BlooketTextQuestionPageInput = {
  setId: "set-fixture",
  number: 1,
  question: "Type sun.",
  answers: [{ text: "sun", correct: true }],
  qType: "typing",
  random: true,
  answerTypes: ["exactly"],
  timeLimit: 15,
};

function fakeChrome(options: {
  readonly initialUrl?: string;
  readonly navigationState?: string;
  readonly mismatchReadBack?: boolean;
}) {
  let tab = {
    url: options.initialUrl ??
      "https://dashboard.blooket.com/my-sets",
    status: "complete",
  };
  let navigated = false;
  let modalOpen = false;
  let questionAdded = false;
  let questionPanel = false;
  const calls: string[] = [];
  const chrome: AddQuestionChromePort = {
    tabs: {
      get: async () => {
        calls.push("get");
        if (navigated) {
          tab = {
            url: "https://dashboard.blooket.com/edit?id=set-fixture",
            status: "complete",
          };
          navigated = false;
        }
        return tab;
      },
      update: async (_tabId, update) => {
        calls.push("update:" + update.url);
        tab = { url: update.url, status: "loading" };
        navigated = true;
        return tab;
      },
    },
    scripting: {
      executeScript: async ({ func, args }) => {
        calls.push(func.name);
        switch (func.name) {
          case "inspectBlooketPage":
            return [{
              result: {
                ok: true,
                value: options.navigationState ?? "edit",
              },
            }];
          case "openBlooketAddQuestionPanel":
            modalOpen = args?.[0] === "set-fixture";
            return [{ result: modalOpen }];
          case "isBlooketAddQuestionPanelReady":
            return [{ result: modalOpen }];
          case "prepareBlooketAddQuestionForm":
            return [{ result: { ok: true } }];
          case "submitBlooketAddQuestionForm":
            modalOpen = false;
            questionAdded = true;
            return [{ result: { ok: true } }];
          case "listBlooketQuestionNumbers":
            return [{
              result: {
                ok: true,
                value: questionAdded ? [1] : [],
              },
            }];
          case "openBlooketQuestionPanel":
            questionPanel = questionAdded && args?.[0] === 1;
            return [{ result: questionPanel }];
          case "inspectOpenedBlooketQuestion":
            return [{
              result: {
                ok: true,
                value: {
                  schemaVersion: 1,
                  number: 1,
                  question: options.mismatchReadBack
                    ? "Different question"
                    : "Type sun.",
                  qType: "typing",
                  random: true,
                  timeLimit: 15,
                  answers: ["sun"],
                  correctAnswers: ["sun"],
                  answerTypes: ["exactly"],
                  hasImage: false,
                  hasAudio: false,
                },
              },
            }];
          case "closeBlooketQuestionPanel":
            questionPanel = false;
            return [{ result: true }];
          case "isBlooketQuestionPanelClosed":
            return [{ result: !questionPanel }];
          default:
            throw new Error("unexpected-script:" + func.name);
        }
      },
    },
  };
  return { chrome, calls };
}

test("host confirms Add Question only after exact read-back", async () => {
  const fake = fakeChrome({});
  const host = createExtensionAddQuestionHost(
    fake.chrome,
    7,
    async () => undefined,
  );
  assert.deepEqual(await host.addQuestion(input), { ok: true });
  assert.equal(
    fake.calls.filter((name) => name === "submitBlooketAddQuestionForm")
      .length,
    1,
  );
  assert.ok(fake.calls.includes("inspectOpenedBlooketQuestion"));
  assert.ok(fake.calls.includes("closeBlooketQuestionPanel"));
});

test("navigation challenge stops before opening Add Question", async () => {
  const fake = fakeChrome({ navigationState: "security-challenge" });
  const host = createExtensionAddQuestionHost(
    fake.chrome,
    7,
    async () => undefined,
  );
  assert.deepEqual(await host.addQuestion(input), {
    ok: false,
    kind: "navigation",
    state: "security-challenge",
  });
  assert.equal(
    fake.calls.includes("openBlooketAddQuestionPanel"),
    false,
  );
  assert.equal(
    fake.calls.includes("submitBlooketAddQuestionForm"),
    false,
  );
});

test("post-submit mismatch fails without a second submit", async () => {
  const fake = fakeChrome({ mismatchReadBack: true });
  const host = createExtensionAddQuestionHost(
    fake.chrome,
    7,
    async () => undefined,
  );
  assert.deepEqual(await host.addQuestion(input), {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  });
  assert.equal(
    fake.calls.filter((name) => name === "submitBlooketAddQuestionForm")
      .length,
    1,
  );
});

test("foreign starting tabs fail before navigation", async () => {
  const fake = fakeChrome({ initialUrl: "https://example.invalid/" });
  const host = createExtensionAddQuestionHost(
    fake.chrome,
    7,
    async () => undefined,
  );
  assert.deepEqual(await host.addQuestion(input), {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  });
  assert.equal(fake.calls.some((value) => value.startsWith("update:")), false);
});
