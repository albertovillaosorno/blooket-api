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
  readonly readBackReplies?: readonly unknown[];
  readonly listReply?: unknown;
  readonly closeFails?: boolean;
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
  let readBackReads = 0;
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
        const call = func.name === "runBlooketAddQuestionPageAction"
          ? func.name + ":" + String(args?.[0])
          : func.name;
        calls.push(call);
        switch (func.name) {
          case "inspectBlooketPage":
            return [{
              result: {
                ok: true,
                value: options.navigationState ?? "edit",
              },
            }];
          case "runBlooketAddQuestionPageAction":
            if (args?.[0] === "open") {
              modalOpen = args?.[1] === "set-fixture";
              return [{ result: modalOpen }];
            }
            if (args?.[0] === "is-ready") return [{ result: modalOpen }];
            if (args?.[0] === "prepare") return [{ result: { ok: true } }];
            if (args?.[0] === "submit") {
              modalOpen = false;
              questionAdded = true;
              return [{ result: { ok: true } }];
            }
            throw new Error("unexpected-add-question-action");
          case "listBlooketQuestionNumbers":
            return [{
              result: options.listReply ?? {
                ok: true,
                value: questionAdded ? [1] : [],
              },
            }];
          case "openBlooketQuestionPanel":
            questionPanel = questionAdded &&
              args?.[0] === "set-fixture" && args?.[1] === 1;
            return [{ result: questionPanel }];
          case "inspectOpenedBlooketQuestion":
            assert.deepEqual(args, ["set-fixture", 1]);
            if (options.readBackReplies) return [{
              result: options.readBackReplies[readBackReads++],
            }];
            readBackReads++;
            return [{
              result: {
                ok: true,
                value: {
                  schemaVersion: 3,
                  number: 1,
                  question: options.mismatchReadBack
                    ? "Different question"
                    : "Type sun.",
                  equation: null,
                  qType: "typing",
                  random: true,
                  timeLimit: 15,
                  answers: [{
                    kind: "text",
                    content: "sun",
                    correct: true,
                    match: "exactly",
                  }],
                  hasImage: false,
                  hasAudio: false,
                },
              },
            }];
          case "closeBlooketQuestionPanel":
            assert.deepEqual(args, ["set-fixture"]);
            if (options.closeFails) return [{ result: false }];
            questionPanel = false;
            return [{ result: true }];
          case "isBlooketQuestionPanelClosed":
            assert.deepEqual(args, ["set-fixture"]);
            return [{ result: !questionPanel }];
          default:
            throw new Error("unexpected-script:" + func.name);
        }
      },
    },
  };
  return { chrome, calls, readBackReads: () => readBackReads,
    setTab: (url: string) => {
    tab = { url, status: "complete" };
    navigated = false;
  } };
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
    fake.calls.filter(
      (name) => name === "runBlooketAddQuestionPageAction:submit",
    ).length,
    1,
  );
  assert.ok(fake.calls.includes("inspectOpenedBlooketQuestion"));
  assert.ok(fake.calls.includes("closeBlooketQuestionPanel"));
  assert.equal(fake.readBackReads(), 2);
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
    fake.calls.includes("runBlooketAddQuestionPageAction:open"),
    false,
  );
  assert.equal(
    fake.calls.includes("runBlooketAddQuestionPageAction:submit"),
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
    fake.calls.filter(
      (name) => name === "runBlooketAddQuestionPageAction:submit",
    ).length,
    1,
  );
  assert.ok(fake.calls.includes("closeBlooketQuestionPanel"));
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

test(
  "a user-selected route is not overwritten by Add Question navigation",
  async () => {
  const fake = fakeChrome({});
  const get = fake.chrome.tabs.get;
  let reads = 0;
  fake.chrome.tabs.get = async (id) => {
    if (++reads === 2)
      fake.setTab("https://dashboard.blooket.com/edit?id=another-set");
    return await get(id);
  };
  const host = createExtensionAddQuestionHost(fake.chrome, 7, async () => {});
  assert.equal((await host.addQuestion(input)).ok, false);
  assert.equal(fake.calls.some((name) => name.startsWith("update:")), false);
  },
);

test(
  "a switched tab after an Add Question opener never prepares or submits",
  async () => {
  const fake = fakeChrome({});
  const execute = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async (request) => {
    const response = await execute(request);
    if (request.func.name === "runBlooketAddQuestionPageAction" &&
        request.args?.[0] === "open")
      fake.setTab("https://dashboard.blooket.com/create");
    return response;
  };
  const host = createExtensionAddQuestionHost(fake.chrome, 7, async () => {});
  assert.equal((await host.addQuestion(input)).ok, false);
  assert.equal(fake.calls.includes("runBlooketAddQuestionPageAction:is-ready"),
    false);
  assert.equal(fake.calls.includes("runBlooketAddQuestionPageAction:submit"),
    false);
  },
);

test(
  "a switched tab after Add Question preparation never submits",
  async () => {
  const fake = fakeChrome({});
  const execute = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async (request) => {
    const response = await execute(request);
    if (request.func.name === "runBlooketAddQuestionPageAction" &&
        request.args?.[0] === "prepare")
      fake.setTab("https://dashboard.blooket.com/create");
    return response;
  };
  const host = createExtensionAddQuestionHost(fake.chrome, 7, async () => {});
  assert.equal((await host.addQuestion(input)).ok, false);
  assert.equal(fake.calls.includes("runBlooketAddQuestionPageAction:submit"),
    false);
  },
);

test(
  "a switched tab during read-back cannot confirm an Add Question write",
  async () => {
  const fake = fakeChrome({});
  const execute = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async (request) => {
    const response = await execute(request);
    if (request.func.name === "listBlooketQuestionNumbers")
      fake.setTab("https://dashboard.blooket.com/edit?id=another-set");
    return response;
  };
  const host = createExtensionAddQuestionHost(fake.chrome, 7, async () => {});
  assert.equal((await host.addQuestion(input)).ok, false);
  assert.equal(fake.calls.includes("openBlooketQuestionPanel"), false);
  },
);

const canonicalReadBack = {
  schemaVersion: 3, number: 1, question: "Type sun.", equation: null,
  qType: "typing", random: true, timeLimit: 15,
  answers: [{ kind: "text", content: "sun", correct: true,
    match: "exactly" }],
  hasImage: false, hasAudio: false,
};

test(
  "malformed successful read-back cannot authorize a question write",
  async () => {
  for (const response of [
    { ok: true, value: { ...canonicalReadBack, secret: "private" } },
    { ok: true, value: canonicalReadBack, secret: "private" },
    { ok: true, value: { ...canonicalReadBack, hasAudio: "false" } },
  ]) {
    const fake = fakeChrome({ readBackReplies: [response] });
    const result = await createExtensionAddQuestionHost(
      fake.chrome, 7, async () => {},
    ).addQuestion(input);
    assert.equal(result.ok, false);
    assert.equal(fake.readBackReads(), 1);
    assert.ok(fake.calls.includes("closeBlooketQuestionPanel"));
  }
  },
);

test(
  "changing question contents invalidate a supposedly confirmed mutation",
  async () => {
  const fake = fakeChrome({ readBackReplies: [
    { ok: true, value: canonicalReadBack },
    { ok: true, value: { ...canonicalReadBack, question: "Different" } },
  ] });
  const result = await createExtensionAddQuestionHost(
    fake.chrome, 7, async () => {},
  ).addQuestion(input);
  assert.equal(result.ok, false);
  assert.equal(fake.readBackReads(), 2);
  assert.ok(fake.calls.includes("closeBlooketQuestionPanel"));
  },
);

test(
  "malformed number-list envelope never opens read-back panel",
  async () => {
  for (const listReply of [
    { ok: true, value: [1], private: "secret" },
    { ok: true, value: [1, 2, 2] },
    { ok: true, value: [1, "2"] },
  ]) {
    const fake = fakeChrome({ listReply });
    const result = await createExtensionAddQuestionHost(
      fake.chrome, 7, async () => {},
    ).addQuestion(input);
    assert.equal(result.ok, false);
    assert.equal(fake.calls.includes("openBlooketQuestionPanel"), false);
  }
  },
);
