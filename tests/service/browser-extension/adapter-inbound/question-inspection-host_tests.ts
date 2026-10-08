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
//   - Synthetic host coverage for stable Blooket question enumeration.
// - Must-Not:
//   - Contact Blooket, create sets, submit forms, or use credentials.
// - Allows:
//   - Inputs: Synthetic Chrome scripts and a deterministic read deadline.
//   - Outputs: Assertions on accepted reads, drift, and cleanup failures.
//   - Side effects: Test-local call recording only.
// - Split-When:
//   - A new browser transport requires independent inspection tests.
// - Merge-When:
//   - Question reading no longer uses extension-host orchestration.
// - Summary:
//   - Ensures no incomplete question collection becomes a successful read.
// - Description:
//   - Rejects drift, ambiguous scripts, timeouts, and failed cancellation.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - No real browser or remote account is involved.
//
import assert from "node:assert/strict";
import test from "node:test";

import { createExtensionQuestionInspectionHost } from
  // jig-ignore-next-line: Preserve the exact mirrored source import.
  "../../../../src/service/browser-extension/adapter-inbound/question-inspection-host.ts";

const FIXTURE_SET = "opaque fixture";
const EDIT_URL = "https://dashboard.blooket.com/edit?id=opaque%20fixture";
const validQuestion = {
  schemaVersion: 3,
  number: 1,
  question: "Choose one.",
  equation: null,
  qType: "mc",
  random: false,
  timeLimit: 20,
  answers: [
    { kind: "text", content: "yes", correct: true, match: null },
    { kind: "text", content: "no", correct: false, match: null },
  ],
  hasImage: false,
  hasAudio: false,
};

interface Scenario {
  readonly initial?: unknown;
  readonly listReplies?: readonly unknown[];
  readonly after?: unknown;
  readonly inspected?: unknown;
  readonly inspectedReplies?: readonly unknown[];
  readonly opened?: unknown;
  readonly canceled?: unknown;
  readonly panelClosed?: unknown;
  readonly inspectThrows?: boolean;
  readonly throwAtInspection?: number;
  readonly tabUrl?: string;
  readonly tabStatus?: string;
  readonly scriptLatencyMs?: number;
  readonly tabReadLatencyMs?: number;
  readonly switchAtEnumeration?: number;
}

function synthetic(options: Scenario = {}) {
  const calls: string[] = [];
  let enumerations = 0;
  let inspections = 0;
  let tick = 0;
  let currentUrl = options.tabUrl ?? EDIT_URL;
  const port = {
    tabs: {
      get: async (id: number) => {
        assert.equal(id, 7);
        tick += options.tabReadLatencyMs ?? 0;
        return {
          url: currentUrl,
          status: options.tabStatus ?? "complete",
        };
      },
    },
    scripting: {
      executeScript: async (request: {
        readonly target: { readonly tabId: number };
        readonly func: (...args: never[]) => unknown;
        readonly args?: unknown[];
      }) => {
        assert.equal(request.target.tabId, 7);
        assert.equal(request.args?.[0], FIXTURE_SET);
        calls.push(request.func.name);
        tick += options.scriptLatencyMs ?? 0;
        const name = request.func.name;
        if (name === "listBlooketQuestionNumbers") {
          enumerations++;
          if (enumerations === options.switchAtEnumeration)
            currentUrl = "https://dashboard.blooket.com/edit?id=other";
          return [{
            result: options.listReplies
              ? options.listReplies[enumerations - 1]
              : enumerations === 1
                ? ("initial" in options
                    ? options.initial : { ok: true, value: [1] })
                : ("after" in options
                    ? options.after : { ok: true, value: [1] }),
          }];
        }
        if (name === "openBlooketQuestionPanel") {
          assert.ok([1, 2].includes(request.args?.[1] as number));
          return [{ result: options.opened ?? true }];
        }
        if (name === "inspectOpenedBlooketQuestion") {
          assert.ok([1, 2].includes(request.args?.[1] as number));
          inspections++;
          if (options.inspectThrows ||
              inspections === options.throwAtInspection)
            throw new Error("synthetic-script-failed");
          return [{
            result: options.inspectedReplies
              ? options.inspectedReplies[inspections - 1]
              : "inspected" in options
                ? options.inspected : {
                  ok: true,
                  value: { ...validQuestion, number: request.args?.[1] },
                },
          }];
        }
        if (name === "closeBlooketQuestionPanel")
          return [{ result: options.canceled ?? true }];
        if (name === "isBlooketQuestionPanelClosed")
          return [{ result: options.panelClosed ?? true }];
        throw new Error("unexpected-script");
      },
    },
  };
  const host = createExtensionQuestionInspectionHost(
    port,
    7,
    async (ms) => { tick += ms; },
    () => tick,
  );
  return {
    host,
    calls,
    enumerations: () => enumerations,
    inspections: () => inspections,
    tick: () => tick,
  };
}

const failed = { ok: false, code: "blooket-browser-failed" };

test(
  "a stable question scan requires cancellation and a second list",
  async () => {
  const fixture = synthetic();
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), {
    ok: true, value: [validQuestion],
  });
  assert.deepEqual(fixture.calls, [
    "listBlooketQuestionNumbers",
    "openBlooketQuestionPanel",
    "inspectOpenedBlooketQuestion",
    "inspectOpenedBlooketQuestion",
    "closeBlooketQuestionPanel",
    "isBlooketQuestionPanelClosed",
    "listBlooketQuestionNumbers",
  ]);
  },
);

test(
  "an empty visible enumeration cannot establish complete questions",
  async () => {
  const fixture = synthetic({
    initial: { ok: true, value: [] },
    after: { ok: true, value: [] },
  });
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
  assert.equal(fixture.enumerations(), 1);
  assert.equal(fixture.calls.includes("openBlooketQuestionPanel"), false);
  },
);

test(
  "changed visible question numbers invalidate the entire read",
  async () => {
  for (const after of [
    { ok: true, value: [] },
    { ok: true, value: [2] },
    { ok: true, value: [1, 2] },
    { ok: true, value: [1], secret: "private" },
  ]) {
    const fixture = synthetic({ after });
    assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
    assert.equal(fixture.enumerations(), 2);
    assert.ok(fixture.calls.includes("closeBlooketQuestionPanel"));
  }
  },
);

test("malformed initial enumerations cannot open a panel", async () => {
  for (const initial of [
    { ok: true, value: [1, 1] },
    { ok: true, value: [10_001] },
    { ok: true, value: [0] },
    { ok: true, value: ["1"] },
    { ok: true, value: [1], unknown: "untrusted" },
    { ok: true, value: Array.from({ length: 201 }, (_, i) => i + 1) },
    { ok: "true", value: [1] },
    null,
  ]) {
    const fixture = synthetic({ initial });
    assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
    assert.deepEqual(fixture.calls, ["listBlooketQuestionNumbers"]);
  }
});

test(
  "mismatched and injected question replies fail after cancellation",
  async () => {
  for (const inspected of [
    { ok: true, value: { ...validQuestion, number: 2 } },
    { ok: true, value: validQuestion, secret: "untrusted" },
    { ok: true, value: { ...validQuestion, cookie: "private" } },
    { ok: false, code: "blooket-browser-failed" },
  ]) {
    const fixture = synthetic({ inspected });
    assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 200), failed);
    assert.equal(fixture.enumerations(), 1);
    assert.ok(fixture.calls.includes("closeBlooketQuestionPanel"));
  }
  },
);

test("script exceptions still attempt modal cancellation", async () => {
  const fixture = synthetic({ inspectThrows: true });
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
  assert.ok(fixture.calls.includes("closeBlooketQuestionPanel"));
});

test("failed modal cleanup always rejects read results", async () => {
  for (const options of [
    { canceled: false },
    { panelClosed: false },
  ]) {
    const fixture = synthetic(options);
    assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 300), failed);
    assert.equal(fixture.enumerations(), 1);
  }
});

test("deadline and switched tabs cannot yield partial reads", async () => {
  for (const options of [
    { tabUrl: "https://dashboard.blooket.com/edit?id=another" },
    { tabStatus: "loading" },
  ]) {
    const fixture = synthetic(options);
    assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
    assert.deepEqual(fixture.calls, []);
  }
  const fixture = synthetic();
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 0), failed);
  assert.deepEqual(fixture.calls, []);
});

test(
  "the host normalizes legacy reads and drops provider image URLs",
  async () => {
  const providerUrl = "https://provider.invalid/answer-image.png";
  const fixture = synthetic({ inspected: { ok: true, value: {
    schemaVersion: 1, number: 1, question: "Pick an image.",
    qType: "mc", random: false, timeLimit: 20,
    answers: ["`~`" + providerUrl, "no"],
    correctAnswers: ["`~`" + providerUrl], answerTypes: null,
    hasImage: false, hasAudio: false,
  } } });
  const result = await fixture.host.inspect(FIXTURE_SET, 1_000);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
  assert.deepEqual(result.value[0].answers, [
    { kind: "image", content: null, correct: true, match: null },
    { kind: "text", content: "no", correct: false, match: null },
  ]);
  assert.equal(JSON.stringify(result).includes(providerUrl), false);
  assert.equal(result.value[0].schemaVersion, 3);
  },
);

test(
  "a tab switch during either enumeration invalidates its result",
  async () => {
  for (const switchAtEnumeration of [1, 2]) {
    const fixture = synthetic({ switchAtEnumeration });
    assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
    assert.equal(fixture.enumerations(), switchAtEnumeration);
  }
  },
);

test(
  "a deadline expiring inside a page script invalidates the read",
  async () => {
  const fixture = synthetic({ scriptLatencyMs: 150 });
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 800), failed);
  assert.equal(fixture.enumerations(), 1);
  assert.ok(fixture.calls.includes("closeBlooketQuestionPanel"));
  },
);

test(
  "two visible questions must retain their exact enumeration order",
  async () => {
  const stable = synthetic({
    initial: { ok: true, value: [1, 2] },
    after: { ok: true, value: [1, 2] },
  });
  const result = await stable.host.inspect(FIXTURE_SET, 1_000);
  assert.equal(result.ok, true);
  if (result.ok)
    assert.deepEqual(result.value.map((item) => item.number), [1, 2]);
  assert.equal(stable.calls.filter(
    (name) => name === "closeBlooketQuestionPanel",
  ).length, 2);

  const reordered = synthetic({
    initial: { ok: true, value: [1, 2] },
    after: { ok: true, value: [2, 1] },
  });
  assert.deepEqual(await reordered.host.inspect(FIXTURE_SET, 1_000), failed);
  assert.equal(reordered.enumerations(), 2);
  },
);

test("invalid IDs are refused without contacting the tab", async () => {
  for (const id of ["", "x\ny", "x\ty", "x\u007fy", "x".repeat(513)]) {
    const fixture = synthetic();
    assert.deepEqual(await fixture.host.inspect(id, 1_000), failed);
    assert.deepEqual(fixture.calls, []);
  }
});

test(
  "aggregate read bytes are bounded below the local bridge limit",
  async () => {
  const large = (count: number) => ({
    ...validQuestion,
    answers: Array.from({ length: count }, (_, index) => ({
      kind: "text",
      content: "a".repeat(9_500) + index,
      correct: index === 0,
      match: null,
    })),
  });
  const within = synthetic({ inspected: { ok: true, value: large(70) } });
  assert.equal((await within.host.inspect(FIXTURE_SET, 1_000)).ok, true);
  const tooLarge = synthetic({ inspected: { ok: true, value: large(90) } });
  assert.deepEqual(await tooLarge.host.inspect(FIXTURE_SET, 1_000), failed);
  assert.ok(tooLarge.calls.includes("closeBlooketQuestionPanel"));
  assert.equal(tooLarge.enumerations(), 1);
  },
);

test("initial list retries bounded loading-state failures", async () => {
  const unavailable = { ok: false, code: "blooket-browser-failed" };
  const page = synthetic({ listReplies: [
    unavailable, unavailable, { ok: true, value: [1] },
    { ok: true, value: [1] },
  ] });
  assert.equal((await page.host.inspect(FIXTURE_SET, 1_000)).ok, true);
  assert.equal(page.enumerations(), 4);
  assert.equal(page.tick(), 200);
  assert.equal(page.calls.filter(
    (name) => name === "openBlooketQuestionPanel",
  ).length, 1);
});

test("persistent missing question UI never opens an edit modal", async () => {
  const page = synthetic({
    listReplies: Array.from(
      { length: 15 },
      () => ({ ok: false, code: "blooket-browser-failed" }),
    ),
  });
  assert.deepEqual(await page.host.inspect(FIXTURE_SET, 8_000), failed);
  assert.equal(page.enumerations(), 15);
  assert.equal(page.calls.includes("openBlooketQuestionPanel"), false);
});

test("malformed enumeration envelopes do not get retried", async () => {
  const page = synthetic({
    listReplies: [
      { ok: false, code: "blooket-browser-failed", secret: "unknown" },
      { ok: true, value: [1] },
    ],
  });
  assert.deepEqual(await page.host.inspect(FIXTURE_SET, 1_000), failed);
  assert.equal(page.enumerations(), 1);
  assert.equal(page.calls.includes("openBlooketQuestionPanel"), false);
});

test(
  "an empty list becoming nonempty during hydration is rejected",
  async () => {
  const page = synthetic({
    listReplies: [
      { ok: true, value: [] },
      { ok: true, value: [1] },
    ],
  });
  assert.deepEqual(await page.host.inspect(FIXTURE_SET, 1_000), failed);
  assert.equal(page.enumerations(), 1);
  assert.equal(page.tick(), 0);
  assert.equal(page.calls.includes("openBlooketQuestionPanel"), false);
  },
);

test("question-list hydration respects the shared read deadline", async () => {
  const unavailable = { ok: false, code: "blooket-browser-failed" };
  const page = synthetic({
    listReplies: [unavailable, unavailable, unavailable],
  });
  assert.deepEqual(await page.host.inspect(FIXTURE_SET, 150), failed);
  assert.equal(page.enumerations(), 2);
  assert.equal(page.calls.includes("openBlooketQuestionPanel"), false);
});

test("malformed successful modal data fails before any retry", async () => {
  const malformed = [
    { ok: true, value: { ...validQuestion, number: 2 } },
    { ok: true, value: validQuestion, extra: "untrusted" },
    { ok: true, value: { ...validQuestion, cookie: "private" } },
    { ok: "true", value: validQuestion },
  ];
  for (const first of malformed) {
    const fixture = synthetic({
      inspectedReplies: [first, { ok: true, value: validQuestion }],
    });
    assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
    assert.equal(fixture.inspections(), 1);
    assert.ok(fixture.calls.includes("closeBlooketQuestionPanel"));
    assert.equal(fixture.enumerations(), 1);
  }
});

test("only a known page-unavailable modal reply can be retried", async () => {
  const unavailable = { ok: false, code: "blooket-browser-failed" };
  const fixture = synthetic({
    inspectedReplies: [
      unavailable, unavailable,
      { ok: true, value: validQuestion },
      { ok: true, value: validQuestion },
    ],
  });
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), {
    ok: true, value: [validQuestion],
  });
  assert.equal(fixture.inspections(), 4);
  assert.equal(fixture.calls.filter(
    (name) => name === "closeBlooketQuestionPanel",
  ).length, 1);
});

test(
  "an overdue tab-read reply must not initiate a question script",
  async () => {
  const fixture = synthetic({ tabReadLatencyMs: 150 });
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 100), failed);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.tick(), 150);
  },
);

test("a late second tab confirmation cannot open a question", async () => {
  const fixture = synthetic({ tabReadLatencyMs: 60 });
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 100), failed);
  assert.deepEqual(fixture.calls, ["listBlooketQuestionNumbers"]);
  assert.equal(fixture.tick(), 120);
});

test(
  "question content changing while its modal is open fails closed",
  async () => {
  const fixture = synthetic({ inspectedReplies: [
    { ok: true, value: validQuestion },
    { ok: true, value: { ...validQuestion, question: "Changed prompt." } },
  ] });
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
  assert.equal(fixture.inspections(), 2);
  assert.equal(fixture.enumerations(), 1);
  assert.equal(fixture.calls.filter(
    (name) => name === "closeBlooketQuestionPanel",
  ).length, 1);
  },
);

test(
  "second modal read refuses malformed and unavailable replies",
  async () => {
  for (const second of [
    { ok: false, code: "blooket-browser-failed" },
    { ok: true, value: validQuestion, diagnostic: "private" },
    { ok: true, value: { ...validQuestion, number: 2 } },
  ]) {
    const fixture = synthetic({ inspectedReplies: [
      { ok: true, value: validQuestion }, second,
    ] });
    assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
    assert.equal(fixture.inspections(), 2);
    assert.ok(fixture.calls.includes("closeBlooketQuestionPanel"));
  }
  },
);

test(
  "a second modal script exception still cancels the owned panel",
  async () => {
  const fixture = synthetic({ throwAtInspection: 2 });
  assert.deepEqual(await fixture.host.inspect(FIXTURE_SET, 1_000), failed);
  assert.equal(fixture.inspections(), 2);
  assert.equal(fixture.calls.filter(
    (name) => name === "closeBlooketQuestionPanel",
  ).length, 1);
  assert.equal(fixture.enumerations(), 1);
  },
);
