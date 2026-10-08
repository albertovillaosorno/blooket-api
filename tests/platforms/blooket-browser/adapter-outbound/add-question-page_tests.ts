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
//   - Synthetic tests for text-only Add Question page preparation/submission.
// - Must-Not:
//   - Contact Blooket, upload media, or treat modal closure as remote success.
// - Allows:
//   - Inputs: Synthetic edit-page forms mirroring recovered controls.
//   - Outputs: Exact open, prepare, revalidation, and submit assertions.
//   - Side effects: Synthetic clicks and hidden-input events only.
// - Split-When:
//   - Media-backed question forms gain verified browser mechanics.
// - Merge-When:
//   - Add Question browser mechanics are removed.
// - Summary:
//   - Proves one observed hidden JSON field is the text-question boundary.
// - Description:
//   - Submission refuses stale values, file data, and ambiguous buttons.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Invalid question semantics fail before the synthetic submit click.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  isBlooketAddQuestionPanelReady,
  openBlooketAddQuestionPanel,
  prepareBlooketAddQuestionForm,
  runBlooketAddQuestionPageAction,
  submitBlooketAddQuestionForm,
  type BlooketTextQuestionPageInput,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/blooket-browser/adapter-outbound/add-question-page.ts";

interface FixtureNode {
  tagName: string;
  textContent: string;
  value: string;
  files?: { readonly length: number };
  parent?: FixtureNode;
  clicked: number;
  selectors: Record<string, FixtureNode[]>;
  attributes: Record<string, string>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FixtureNode | null;
  querySelectorAll(selector: string): FixtureNode[];
  closest(selector: string): FixtureNode | null;
  dispatchEvent(event: Event): boolean;
  click(): void;
}

function node(
  tagName: string,
  textContent = "",
  attributes: Record<string, string> = {},
): FixtureNode {
  return {
    tagName,
    textContent,
    value: "",
    clicked: 0,
    selectors: {},
    attributes,
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    querySelector(selector) {
      return this.selectors[selector]?.[0] ?? null;
    },
    querySelectorAll(selector) {
      return this.selectors[selector] ?? [];
    },
    closest(selector) {
      let current: FixtureNode | undefined = this;
      while (current) {
        if (current.tagName.toLowerCase() === selector.toLowerCase())
          return current;
        current = current.parent;
      }
      return null;
    },
    dispatchEvent() {
      return true;
    },
    click() {
      this.clicked++;
    },
  };
}

function withPage(
  document: FixtureNode,
  href: string,
  run: () => void,
): void {
  const keys = ["document", "location", "HTMLInputElement", "Event"] as const;
  const prior = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  class InputFixture {}
  Object.defineProperty(InputFixture.prototype, "value", {
    configurable: true,
    set(this: FixtureNode, value: string) {
      this.value = value;
    },
  });
  class EventFixture {
    readonly type: string;
    readonly options: { bubbles: boolean };
    constructor(type: string, options: { bubbles: boolean }) {
      this.type = type;
      this.options = options;
    }
  }
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL(href),
  });
  Object.defineProperty(globalThis, "HTMLInputElement", {
    configurable: true,
    value: InputFixture,
  });
  Object.defineProperty(globalThis, "Event", {
    configurable: true,
    value: EventFixture,
  });
  try {
    run();
  } finally {
    for (const [key, descriptor] of prior) {
      if (descriptor)
        Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function fixture() {
  const document = node("DOCUMENT");
  const add = node("BUTTON", "Add Question");
  document.selectors["button"] = [add];

  const form = node("FORM");
  const hidden = node("INPUT", "", {
    id: "question",
    name: "question",
    type: "hidden",
  });
  hidden.parent = form;
  const setId = node("INPUT", "", {
    id: "setId",
    name: "setId",
    type: "hidden",
  });
  setId.value = "set-fixture";
  setId.parent = form;
  const submit = node("BUTTON", "\u00a0 Save Question ", {
    type: "submit",
  });
  submit.parent = form;
  form.selectors['input#setId[name="setId"]'] = [setId];
  form.selectors['button[type="submit"]'] = [submit];
  form.selectors['input[type="file"]'] = [];
  document.selectors['input#question[name="question"]'] = [hidden];
  return { document, add, form, hidden, setId, submit };
}

const typing: BlooketTextQuestionPageInput = {
  setId: "set-fixture",
  number: 1,
  question: "Type sun.",
  answers: [{ text: "sun", correct: true }],
  qType: "typing",
  random: true,
  answerTypes: ["exactly"],
  timeLimit: 15,
};

test("serialized Add Question runner preserves browser semantics", () => {
  const page = fixture();
  const serialized = Function(
    "return (" + runBlooketAddQuestionPageAction.toString() + ")",
  )() as typeof runBlooketAddQuestionPageAction;
  withPage(
    page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture",
    () => {
      assert.equal(serialized("open", "set-fixture"), true);
      assert.equal(serialized("is-ready", "set-fixture"), true);
      assert.deepEqual(serialized("prepare", typing), { ok: true });
      assert.deepEqual(serialized("submit", typing), { ok: true });
      assert.equal(page.submit.clicked, 1);
    },
  );
});

test("Add Question refuses control-bearing set IDs before opening", () => {
  const page = fixture();
  const setId = "x\ny";
  withPage(
    page.document,
    "https://dashboard.blooket.com/edit?id=x%0Ay",
    () => {
      assert.equal(runBlooketAddQuestionPageAction("open", setId), false);
      assert.equal(page.add.clicked, 0);
    },
  );
});

test("unknown serialized Add Question actions never submit", () => {
  const page = fixture();
  const serialized = Function(
    "return (" + runBlooketAddQuestionPageAction.toString() + ")",
  )() as typeof runBlooketAddQuestionPageAction;
  withPage(
    page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture",
    () => {
      assert.deepEqual(serialized("prepare", typing), { ok: true });
      assert.deepEqual(serialized("unknown" as never, typing), {
        ok: false,
        code: "blooket-browser-failed",
      });
      assert.equal(page.submit.clicked, 0);
    },
  );
});

test("Add Question opens and serializes exact typing state", () => {
  const page = fixture();
  withPage(
    page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture",
    () => {
      assert.equal(openBlooketAddQuestionPanel("set-fixture"), true);
      assert.equal(page.add.clicked, 1);
      assert.equal(isBlooketAddQuestionPanelReady("set-fixture"), true);
      assert.deepEqual(prepareBlooketAddQuestionForm(typing), { ok: true });
      assert.deepEqual(JSON.parse(page.hidden.value), {
        number: 1,
        question: "Type sun.",
        answers: ["sun"],
        correctAnswers: ["sun"],
        image: "",
        audio: "",
        qType: "typing",
        random: true,
        answerTypes: ["exactly"],
        timeLimit: 15,
      });
      assert.equal(page.submit.clicked, 0);
      assert.deepEqual(submitBlooketAddQuestionForm(typing), { ok: true });
      assert.equal(page.submit.clicked, 1);
    },
  );
});

test(
  "multiple choice text state preserves answer order and correctness",
  () => {
  const page = fixture();
  const input: BlooketTextQuestionPageInput = {
    setId: "set-fixture",
    number: 2,
    question: "Which one is the sun?",
    answers: [
      { text: "Sun", correct: true },
      { text: "Moon", correct: false },
      { text: "Mars", correct: false },
    ],
    qType: "mc",
    random: false,
    answerTypes: null,
    timeLimit: 20,
  };
  withPage(
    page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture",
    () => {
      assert.deepEqual(prepareBlooketAddQuestionForm(input), { ok: true });
      assert.deepEqual(JSON.parse(page.hidden.value), {
        number: 2,
        question: "Which one is the sun?",
        answers: ["Sun", "Moon", "Mars"],
        correctAnswers: ["Sun"],
        image: "",
        audio: "",
        qType: "mc",
        random: false,
        answerTypes: null,
        timeLimit: 20,
      });
    },
  );
  },
);

test("provider marker text never reaches the hidden question field", () => {
  const page = fixture();
  withPage(
    page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture",
    () => {
      for (const input of [
        { ...typing, question: "Type`*`x^2`*`" },
        {
          ...typing,
          answers: [{ text: "sun`*`x`*`", correct: true }],
        },
        {
          ...typing,
          answers: [{ text: "sun`~`https://provider.invalid", correct: true }],
        },
      ]) {
        assert.equal(prepareBlooketAddQuestionForm(input).ok, false);
        assert.equal(page.hidden.value, "");
        assert.equal(page.submit.clicked, 0);
      }
    },
  );
});

test("stale hidden state and file data prevent submission", () => {
  const page = fixture();
  withPage(
    page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture",
    () => {
      assert.deepEqual(prepareBlooketAddQuestionForm(typing), { ok: true });
      page.hidden.value = page.hidden.value.replace("sun", "moon");
      assert.equal(submitBlooketAddQuestionForm(typing).ok, false);
      assert.equal(page.submit.clicked, 0);

      assert.deepEqual(prepareBlooketAddQuestionForm(typing), { ok: true });
      const file = node("INPUT", "", { type: "file" });
      file.files = { length: 1 };
      page.form.selectors['input[type="file"]'] = [file];
      assert.equal(submitBlooketAddQuestionForm(typing).ok, false);
      assert.equal(page.submit.clicked, 0);
    },
  );
});

test("ambiguous controls and invalid question semantics fail closed", () => {
  const page = fixture();
  withPage(
    page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture",
    () => {
      page.document.selectors["button"] = [
        page.add,
        node("BUTTON", "Add Question"),
      ];
      assert.equal(openBlooketAddQuestionPanel("set-fixture"), false);
      page.document.selectors["button"] = [page.add];

      assert.equal(
        prepareBlooketAddQuestionForm({
          ...typing,
          answers: [
            { text: "sun", correct: true },
            { text: "sun", correct: true },
          ],
          answerTypes: ["exactly", "exactly"],
        }).ok,
        false,
      );
      assert.equal(
        prepareBlooketAddQuestionForm({
          ...typing,
          qType: "mc",
          answers: [{ text: "only", correct: true }],
          answerTypes: null,
        }).ok,
        false,
      );
      assert.equal(page.submit.clicked, 0);
    },
  );
});
