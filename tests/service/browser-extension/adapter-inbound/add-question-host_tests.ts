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
import { createHash } from "node:crypto";

import {
  createExtensionAddQuestionHost,
  type AddQuestionChromePort,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/service/browser-extension/adapter-inbound/add-question-host.ts";
import type { BlooketTextQuestionPageInput } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/blooket-browser/adapter-outbound/add-question-page.ts";

const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const image = {
  format: "png" as const,
  base64: imageBytes.toString("base64"),
};

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
  readonly priorListReply?: unknown;
  readonly closeFails?: boolean;
  readonly prepareFails?: boolean;
  readonly imageReady?: boolean;
  readonly finalizeFails?: boolean;
  readonly imageProbeReply?: unknown;
  readonly canLeave?: unknown;
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
  let submittedImage = false;
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
          case "inspectBlooketDocumentOrigin":
            return [{ result: 1_000 }];
          case "canLeaveBlooketPageForRead":
            return [{ result: options.canLeave === undefined
              ? true : options.canLeave }];
          case "inspectBlooketPage":
            return [{
              result: {
                ok: true,
                value: options.navigationState ?? "edit",
              },
            }];
          case "runBlooketAddQuestionPageAction":
            if (args?.[0] === "open" || args?.[0] === "open-image") {
              modalOpen = args?.[1] === "set-fixture";
              return [{ result: modalOpen }];
            }
            if (args?.[0] === "is-ready") return [{ result: modalOpen }];
            if (args?.[0] === "is-image-ready")
              return [{ result: options.imageReady ?? true }];
            if (args?.[0] === "finalize-image") return [{ result:
              options.finalizeFails ? {
                ok: false, code: "blooket-browser-failed",
              } : { ok: true },
            }];
            if (args?.[0] === "cancel-image") {
              modalOpen = false;
              return [{ result: { ok: true } }];
            }
            if (args?.[0] === "prepare") return [{ result:
              options.prepareFails ? {
                ok: false, code: "blooket-browser-failed",
              } : { ok: true },
            }];
            if (args?.[0] === "submit") {
              modalOpen = false;
              questionAdded = true;
              submittedImage = !!(args[1] as { image?: unknown })?.image;
              return [{ result: { ok: true } }];
            }
            throw new Error("unexpected-add-question-action");
          case "listBlooketQuestionNumbers":
            return [{
              result: questionAdded && options.listReply !== undefined
                ? options.listReply
                : !questionAdded && options.priorListReply !== undefined
                  ? options.priorListReply
                  : { ok: true, value: questionAdded ? [1] : [] },
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
                  hasImage: submittedImage,
                  hasAudio: false,
                },
              },
            }];
          case "inspectOpenedBlooketQuestionImage":
            return [{ result: options.imageProbeReply ?? {
              ok: true, value: {
                byteLength: imageBytes.length,
                sha256: createHash("sha256").update(imageBytes)
                  .digest("hex"),
              },
            } }];
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

test("image write requires a matching persisted byte digest", async () => {
  const fake = fakeChrome({});
  const result = await createExtensionAddQuestionHost(
    fake.chrome, 7, async () => undefined,
  ).addQuestion({ ...input, image });
  assert.deepEqual(result, { ok: true });
  assert.equal(fake.calls.filter(
    value => value === "runBlooketAddQuestionPageAction:submit",
  ).length, 1);
  assert.equal(fake.calls.includes(
    "runBlooketAddQuestionPageAction:open-image",
  ), true);
  assert.equal(fake.calls.includes("inspectOpenedBlooketQuestionImage"),
    true);
  assert.equal(fake.readBackReads(), 3);
});

test("image write refuses absent, altered, or malformed byte evidence",
  async () => {
  for (const reply of [
    { ok: true, value: null },
    { ok: true, value: { byteLength: imageBytes.length,
      sha256: "0".repeat(64) } },
    { ok: true, value: { byteLength: imageBytes.length,
      sha256: createHash("sha256").update(imageBytes).digest("hex"),
      url: "https://example.invalid/not-a-receipt" } },
    { ok: false, code: "blooket-browser-failed" },
  ]) {
    const fake = fakeChrome({ imageProbeReply: reply });
    const result = await createExtensionAddQuestionHost(
      fake.chrome, 7, async () => undefined,
    ).addQuestion({ ...input, image });
    assert.equal(result.ok, false);
    assert.equal(fake.calls.filter(
      value => value === "runBlooketAddQuestionPageAction:submit",
    ).length, 1);
    assert.equal(fake.calls.includes("closeBlooketQuestionPanel"), true);
  }
  },
);

test("invalid image and failed preparation never submit a question",
  async () => {
  const invalid = fakeChrome({});
  const bad = await createExtensionAddQuestionHost(
    invalid.chrome, 7, async () => undefined,
  ).addQuestion({ ...input, image: {
    format: "png", base64: "AQIDBA==",
  } });
  assert.equal(bad.ok, false);
  assert.equal(invalid.calls.includes(
    "runBlooketAddQuestionPageAction:open-image",
  ), false);
  const failed = fakeChrome({ prepareFails: true });
  const result = await createExtensionAddQuestionHost(
    failed.chrome, 7, async () => undefined,
  ).addQuestion({ ...input, image });
  assert.equal(result.ok, false);
  assert.equal(failed.calls.includes(
    "runBlooketAddQuestionPageAction:cancel-image",
  ), true);
  assert.equal(failed.calls.includes(
    "runBlooketAddQuestionPageAction:submit",
  ), false);
  },
);

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

test("Add Question never abandons a teacher editor on target navigation",
  async () => {
  for (const denied of [false, null, { ok: true }, "true"]) {
    const fake = fakeChrome({
      initialUrl: "https://dashboard.blooket.com/edit?id=teacher-draft",
      canLeave: denied,
    });
    const result = await createExtensionAddQuestionHost(
      fake.chrome, 7, async () => undefined,
    ).addQuestion(input);
    assert.equal(result.ok, false);
    assert.equal(fake.calls.includes("canLeaveBlooketPageForRead"), true);
    assert.equal(fake.calls.some(call => call.startsWith("update:")), false);
    assert.equal(fake.calls.includes(
      "runBlooketAddQuestionPageAction:open",
    ), false);
  }
  },
);

test("Add Question refuses a teacher route changed during leave inspection",
  async () => {
  const fake = fakeChrome({});
  const original = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async request => {
    const reply = await original(request);
    if (request.func.name === "canLeaveBlooketPageForRead")
      fake.setTab("https://dashboard.blooket.com/edit?id=teacher-draft");
    return reply;
  };
  const result = await createExtensionAddQuestionHost(
    fake.chrome, 7, async () => undefined,
  ).addQuestion(input);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.some(call => call.startsWith("update:")), false);
  },
);

test("Add Question refuses to open over a teacher-owned target editor",
  async () => {
  const target = "https://dashboard.blooket.com/edit?id=set-fixture";
  const fake = fakeChrome({ initialUrl: target, canLeave: false });
  const result = await createExtensionAddQuestionHost(
    fake.chrome, 7, async () => undefined,
  ).addQuestion(input);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.includes("canLeaveBlooketPageForRead"), true);
  assert.equal(fake.calls.includes(
    "runBlooketAddQuestionPageAction:open",
  ), false);
  assert.equal(fake.calls.some(call => call.startsWith("update:")), false);
  },
);


test("image settlement failure cancels only before a single possible submit",
  async () => {
  for (const options of [{ imageReady: false }, { finalizeFails: true }]) {
    const fake = fakeChrome(options);
    const host = createExtensionAddQuestionHost(fake.chrome, 7, async () => {});
    assert.equal((await host.addQuestion({ ...input, image })).ok, false);
    assert.equal(fake.calls.includes(
      "runBlooketAddQuestionPageAction:submit",
    ), false);
    assert.equal(fake.calls.filter(call => call ===
      "runBlooketAddQuestionPageAction:prepare").length, 1);
    assert.equal(fake.calls.filter(call => call ===
      "runBlooketAddQuestionPageAction:cancel-image").length, 1);
  }
});

test("lost Add Question submit acknowledgement confirms exactly one save",
  async () => {
  const fake = fakeChrome({});
  const original = fake.chrome.scripting.executeScript;
  let clicks = 0;
  fake.chrome.scripting.executeScript = async request => {
    const response = await original(request);
    if (request.func.name === "runBlooketAddQuestionPageAction" &&
        request.args?.[0] === "submit") {
      clicks++;
      throw new Error("execution-context-lost-after-save-question");
    }
    return response;
  };
  const host = createExtensionAddQuestionHost(fake.chrome, 7,
    async () => undefined);
  assert.deepEqual(await host.addQuestion(input), { ok: true });
  assert.equal(clicks, 1);
  assert.equal(fake.calls.filter(call =>
    call === "runBlooketAddQuestionPageAction:submit").length, 1);
  assert.equal(fake.readBackReads(), 2);
  assert.ok(fake.calls.includes("closeBlooketQuestionPanel"));
  },
);

test("lost Add Question ack before a save does not repeat the click",
  async () => {
  const fake = fakeChrome({});
  const original = fake.chrome.scripting.executeScript;
  let calls = 0;
  fake.chrome.scripting.executeScript = async request => {
    if (request.func.name === "runBlooketAddQuestionPageAction" &&
        request.args?.[0] === "submit") {
      calls++;
      throw new Error("execution-context-lost-before-save-question");
    }
    return await original(request);
  };
  assert.deepEqual(await createExtensionAddQuestionHost(
    fake.chrome, 7, async () => undefined,
  ).addQuestion(input), {
    ok: false, kind: "browser", code: "blooket-browser-failed",
  });
  assert.equal(calls, 1);
  assert.equal(fake.readBackReads(), 0);
  assert.equal(fake.calls.includes("openBlooketQuestionPanel"), false);
  },
);

test("an existing target question stops Add Question before opening form",
  async () => {
  for (const priorListReply of [
    { ok: true, value: [1] },
    { ok: true, value: [1, 1] },
    { ok: true, value: ["1"] },
    { ok: false, code: "blooket-browser-failed" },
    { ok: true, value: [], extra: "untrusted" },
  ]) {
    const fake = fakeChrome({ priorListReply });
    const result = await createExtensionAddQuestionHost(
      fake.chrome, 7, async () => undefined,
    ).addQuestion(input);
    assert.equal(result.ok, false);
    assert.equal(fake.calls.includes(
      "runBlooketAddQuestionPageAction:open"), false);
    assert.equal(fake.calls.includes(
      "runBlooketAddQuestionPageAction:submit"), false);
  }
  },
);

test("a preexisting contiguous question list permits only the next index",
  async () => {
  const target: BlooketTextQuestionPageInput = { ...input, number: 2 };
  const fake = fakeChrome({ priorListReply: { ok: true, value: [1] } });
  const original = fake.chrome.scripting.executeScript;
  let opened = false;
  fake.chrome.scripting.executeScript = async request => {
    if (request.func.name === "runBlooketAddQuestionPageAction" &&
        request.args?.[0] === "open") opened = true;
    return await original(request);
  };
  // Fixture has no number-two card after submit, so the mutation cannot be
  // confirmed, but the admission check must allow opening the next form.
  const result = await createExtensionAddQuestionHost(
    fake.chrome, 7, async () => undefined,
  ).addQuestion(target);
  assert.equal(result.ok, false);
  assert.equal(opened, true);
  assert.equal(fake.calls.filter(call =>
    call === "runBlooketAddQuestionPageAction:submit").length, 1);
  },
);

test("same edit URL with a new document cannot submit or confirm a question",
  async () => {
  for (const phase of ["prepare", "submit", "inspectOpenedBlooketQuestion"]) {
    const fake = fakeChrome({});
    const original = fake.chrome.scripting.executeScript;
    let origin = 1_000;
    fake.chrome.scripting.executeScript = async request => {
      if (request.func.name === "inspectBlooketDocumentOrigin")
        return [{ result: origin }];
      const result = await original(request);
      const action = request.func.name === "runBlooketAddQuestionPageAction"
        ? request.args?.[0] : request.func.name;
      if (action === phase) origin = 2_000;
      return result;
    };
    const host = createExtensionAddQuestionHost(fake.chrome, 7,
      async () => undefined);
    assert.deepEqual(await host.addQuestion(input), {
      ok: false, kind: "browser", code: "blooket-browser-failed",
    });
    assert.equal(fake.calls.filter(call =>
      call === "runBlooketAddQuestionPageAction:submit").length,
      phase === "prepare" ? 0 : 1);
  }
  },
);

test("Add Question cannot write without exact native document identity",
  async () => {
  const fake = fakeChrome({});
  const original = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async request =>
    request.func.name === "inspectBlooketDocumentOrigin"
      ? [{ result: null }] : await original(request);
  const host = createExtensionAddQuestionHost(fake.chrome, 7,
    async () => undefined);
  assert.deepEqual(await host.addQuestion(input), {
    ok: false, kind: "browser", code: "blooket-browser-failed",
  });
  assert.equal(fake.calls.includes("runBlooketAddQuestionPageAction:open"),
    false);
  },
);

test("Add Question refuses an identically routed replacement before navigation",
  async () => {
  for (const replacement of [null, 2_000]) {
    const fake = fakeChrome({});
    const original = fake.chrome.scripting.executeScript;
    let nativeReads = 0;
    fake.chrome.scripting.executeScript = async request => {
      if (request.func.name === "inspectBlooketDocumentOrigin" &&
          ++nativeReads === 2) return [{ result: replacement }];
      return await original(request);
    };
    const result = await createExtensionAddQuestionHost(
      fake.chrome, 7, async () => undefined,
    ).addQuestion(input);
    assert.equal(result.ok, false);
    assert.equal(nativeReads, 2);
    assert.equal(fake.calls.some(call => call.startsWith("update:")), false);
    assert.equal(fake.calls.includes(
      "runBlooketAddQuestionPageAction:open"), false);
  }
  },
);

test("Add Question refuses to navigate without a source document lifetime",
  async () => {
  const fake = fakeChrome({});
  const original = fake.chrome.scripting.executeScript;
  fake.chrome.scripting.executeScript = async request =>
    request.func.name === "inspectBlooketDocumentOrigin"
      ? [{ result: null }] : await original(request);
  const result = await createExtensionAddQuestionHost(
    fake.chrome, 7, async () => undefined,
  ).addQuestion(input);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.some(call => call.startsWith("update:")), false);
  },
);
