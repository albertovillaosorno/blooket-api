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
//   - Synthetic regressions for normalized Blooket question-modal extraction.
// - Must-Not:
//   - Submit a form, contact Blooket, or infer hidden provider state.
// - Allows:
//   - Inputs: Synthetic controls and serialized question form values.
//   - Outputs: Assertions about bounded normalized question read behavior.
//   - Side effects: Temporary document/location globals restored per case.
// - Split-When:
//   - Another provider answer encoding needs independent normalization.
// - Merge-When:
//   - Question reads no longer require a browser-specific adapter.
// - Summary:
//   - Verifies question modal reads fail closed without relying on CSS classes.
// - Description:
//   - Mirrors the recovered edit controls used by question-page.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Loading, ambiguity, malformed JSON, and malformed media are rejected.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  closeBlooketQuestionPanel,
  inspectOpenedBlooketQuestion,
  isBlooketQuestionPanelClosed,
  listBlooketQuestionNumbers,
  openBlooketQuestionPanel,
} from
  "../../../../src/platforms/blooket-browser/adapter-outbound/question-page.ts";
import { decodeBlooketQuestionRead } from
  "../../../../src/ir/blooket-question-reads/contract/question-read.ts";

interface FixtureNode {
  tagName: string;
  textContent: string;
  value?: string;
  parent?: FixtureNode;
  selectors: Record<string, FixtureNode[]>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FixtureNode | null;
  querySelectorAll(selector: string): FixtureNode[];
  closest(selector: string): FixtureNode | null;
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
    selectors: {},
    getAttribute: (name) => attributes[name] ?? null,
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
    click: () => {
      throw new Error("unexpected-dom-mutation");
    },
  };
}

function page(document: FixtureNode, href: string, run: () => void): void {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const priorLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL(href),
  });
  try {
    run();
  } finally {
    if (priorDocument)
      Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (priorLocation)
      Object.defineProperty(globalThis, "location", priorLocation);
    else Reflect.deleteProperty(globalThis, "location");
  }
}

test("question panels expose normalized read facts without saving", () => {
  const document = node("DOCUMENT");
  const group = node("DIV", "", {
    role: "button",
    "aria-label": "Edit question 1",
  });
  const edit = node("BUTTON", "\u00a0Edit");
  let opened = 0;
  edit.click = () => {
    opened++;
  };
  group.selectors["button"] = [edit];
  document.selectors[
    '[role="button"][aria-label^="Edit question "]'
  ] = [group];
  document.selectors[
    '[role="button"][aria-label="Edit question 1"]'
  ] = [group];

  const hidden = node("INPUT", "", { type: "hidden" });
  hidden.value = JSON.stringify({
    number: 1,
    question: "Type sun.",
    qType: "typing",
    random: true,
    timeLimit: 15,
    answers: ["sun", "the sun"],
    correctAnswers: ["sun", "the sun"],
    answerTypes: ["exactly", "contains"],
    image: "opaque-question-media",
    audio: "",
    masteryLevel: 2,
  });
  const form = node("FORM");
  hidden.parent = form;
  const identity = node("INPUT", "", { type: "hidden" });
  identity.value = "fixture";
  form.selectors['input#setId[name="setId"]'] = [identity];
  const cancel = node("BUTTON", "Cancel", { type: "button" });
  let closed = 0;
  cancel.click = () => {
    closed++;
    document.selectors['input#question[name="question"]'] = [];
  };
  form.selectors['button[type="button"]'] = [cancel];
  document.selectors['input#question[name="question"]'] = [hidden];
  document.selectors['form input#question[name="question"]'] = [hidden];

  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.deepEqual(listBlooketQuestionNumbers("fixture"), {
      ok: true,
      value: [1],
    });
    assert.equal(openBlooketQuestionPanel("fixture", 1), true);
    assert.equal(opened, 1);
    const result = inspectOpenedBlooketQuestion("fixture", 1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, {
        schemaVersion: 3,
        number: 1,
        question: "Type sun.",
        equation: null,
        qType: "typing",
        random: true,
        timeLimit: 15,
        answers: [
          {
            kind: "text",
            content: "sun",
            correct: true,
            match: "exactly",
          },
          {
            kind: "text",
            content: "the sun",
            correct: true,
            match: "contains",
          },
        ],
        hasImage: true,
        hasAudio: false,
      });
      assert.equal(decodeBlooketQuestionRead(result.value).ok, true);
    }
    assert.equal(closeBlooketQuestionPanel("fixture"), true);
    assert.equal(closed, 1);
    assert.equal(isBlooketQuestionPanelClosed("fixture"), true);
    document.selectors['input#question[name="question"]'] = [hidden];

    const providerUrl = "https://provider.invalid/media";
    hidden.value = JSON.stringify({
      number: 1,
      question: "Image answer",
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: ["`~`" + providerUrl, "plain"],
      correctAnswers: ["`~`" + providerUrl],
      answerTypes: [],
      image: "",
      audio: "",
    });
    const imageAnswer = inspectOpenedBlooketQuestion("fixture", 1);
    assert.equal(imageAnswer.ok, true);
    if (imageAnswer.ok) {
      assert.deepEqual(imageAnswer.value, {
        schemaVersion: 3,
        number: 1,
        question: "Image answer",
        equation: null,
        qType: "mc",
        random: false,
        timeLimit: 20,
        answers: [
          { kind: "image", content: null, correct: true, match: null },
          { kind: "text", content: "plain", correct: false, match: null },
        ],
        hasImage: false,
        hasAudio: false,
      });
      assert.equal(
        JSON.stringify(imageAnswer.value).includes(providerUrl),
        false,
      );
      assert.equal(decodeBlooketQuestionRead(imageAnswer.value).ok, true);
    }
    hidden.value = JSON.stringify({
      number: 1,
      question: "Math answer",
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: ["`*`x^2`*`"],
      correctAnswers: ["`*`x^2`*`"],
      answerTypes: [],
      image: "",
      audio: "",
    });
    const mathAnswer = inspectOpenedBlooketQuestion("fixture", 1);
    assert.equal(mathAnswer.ok, true);
    if (mathAnswer.ok) {
      const value = mathAnswer.value as { answers?: unknown };
      assert.deepEqual(value.answers, [{
        kind: "math",
        content: "x^2",
        correct: true,
        match: null,
      }]);
      assert.equal(decodeBlooketQuestionRead(mathAnswer.value).ok, true);
    }
    hidden.value = JSON.stringify({
      number: 1,
      question: "Ambiguous math answer",
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: ["`*`x`*`y`*`", "plain"],
      correctAnswers: ["`*`x`*`y`*`"],
      answerTypes: [],
      image: "",
      audio: "",
    });
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    hidden.value = JSON.stringify({
      number: 1,
      question: "Solve this`*`x^2`*`",
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: ["4", "5"],
      correctAnswers: ["4"],
      answerTypes: [],
      image: "",
      audio: "",
    });
    const equationQuestion = inspectOpenedBlooketQuestion("fixture", 1);
    assert.equal(equationQuestion.ok, true);
    if (equationQuestion.ok) {
      const value = equationQuestion.value as {
        question?: unknown;
        equation?: unknown;
      };
      assert.equal(value.question, "Solve this");
      assert.equal(value.equation, "x^2");
      assert.equal(JSON.stringify(value).includes("`*`"), false);
      assert.equal(decodeBlooketQuestionRead(equationQuestion.value).ok, true);
    }
    hidden.value = JSON.stringify({
      number: 1,
      question: "Solve this`*`x^2`*`",
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: ["4", "5"],
      correctAnswers: ["4"],
      answerTypes: [],
      image: "opaque-image",
      audio: "",
    });
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    hidden.value = JSON.stringify({
      number: 1,
      question: "Solve this`*`x^2",
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: ["4", "5"],
      correctAnswers: ["4"],
      answerTypes: [],
      image: "",
      audio: "",
    });
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    hidden.value = JSON.stringify({
      number: 1,
      question: "Malformed image answer",
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: ["prefix`~`https://provider.invalid/media"],
      correctAnswers: [],
      answerTypes: [],
      image: "",
      audio: "",
    });
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    hidden.value = "{bad";
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
  });
});

test("question modal operations reject switched and duplicate set IDs", () => {
  const document = node("DOCUMENT");
  const group = node("DIV");
  const edit = node("BUTTON", "Edit");
  let clicks = 0;
  edit.click = () => { clicks++; };
  group.selectors["button"] = [edit];
  document.selectors[
    '[role="button"][aria-label="Edit question 1"]'
  ] = [group];

  const form = node("FORM");
  const hidden = node("INPUT", "", { type: "hidden" });
  hidden.parent = form;
  const identity = node("INPUT", "", { type: "hidden" });
  identity.value = "fixture";
  form.selectors['input#setId[name="setId"]'] = [identity];
  hidden.value = JSON.stringify({
    number: 1, question: "Type sun.", qType: "typing",
    random: true, timeLimit: 15, answers: ["sun"],
    correctAnswers: ["sun"], answerTypes: ["exactly"],
    image: "", audio: "",
  });
  document.selectors['input#question[name="question"]'] = [hidden];
  document.selectors['form input#question[name="question"]'] = [hidden];
  const cancel = node("BUTTON", "Cancel");
  cancel.click = () => { clicks++; };
  form.selectors['button[type="button"]'] = [cancel];

  for (const [href, setId] of [
    ["https://dashboard.blooket.com/edit?id=other", "fixture"],
    ["https://dashboard.blooket.com/edit?id=fixture&id=other", "fixture"],
    ["https://dashboard.blooket.com/edit?id=fixture&id=fixture", "fixture"],
    ["https://dashboard.blooket.com/edit?id=x%0Ay", "x\ny"],
  ] as const) {
    page(document, href, () => {
      assert.equal(listBlooketQuestionNumbers(setId).ok, false);
      assert.equal(openBlooketQuestionPanel(setId, 1), false);
      assert.equal(inspectOpenedBlooketQuestion(setId, 1).ok, false);
      assert.equal(closeBlooketQuestionPanel(setId), false);
      assert.equal(isBlooketQuestionPanelClosed(setId), false);
    });
  }
  assert.equal(clicks, 0);
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.equal(openBlooketQuestionPanel("fixture", 1), true);
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, true);
    assert.equal(closeBlooketQuestionPanel("fixture"), true);
  });
  assert.equal(clicks, 2);
});

test(
  "question enumeration distinguishes loaded empty state from ambiguity",
  () => {
  const document = node("DOCUMENT");
  const first = node("DIV", "", { "aria-label": "Edit question 1" });
  const duplicate = node("DIV", "", { "aria-label": "Edit question 1" });
  document.selectors[
    '[role="button"][aria-label^="Edit question "]'
  ] = [first, duplicate];

  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    assert.equal(listBlooketQuestionNumbers("other").ok, false);
    assert.equal(openBlooketQuestionPanel("fixture", 0), false);

    document.selectors[
      '[role="button"][aria-label^="Edit question "]'
    ] = [];
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    document.selectors["button"] = [node("BUTTON", "Add Question")];
    assert.deepEqual(listBlooketQuestionNumbers("fixture"), {
      ok: true,
      value: [],
    });
  });
  },
);

test(
  "question extraction rejects mismatched and oversized visible state",
  () => {
  const document = node("DOCUMENT");
  const hidden = node("INPUT");
  hidden.value = JSON.stringify({
    number: 2,
    question: "Wrong number",
    qType: "typing",
    random: true,
    timeLimit: 10,
    answers: ["x"],
    correctAnswers: ["x"],
    answerTypes: ["exactly"],
    image: "",
    audio: "",
  });
  document.selectors['input#question[name="question"]'] = [hidden];

  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    hidden.value = "x".repeat(100_001);
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
  });
  },
);

test("question reads require one modal tied to the requested set ID", () => {
  const document = node("DOCUMENT");
  const form = node("FORM");
  const question = node("INPUT", "", { type: "hidden" });
  question.value = JSON.stringify({
    number: 1, question: "Type sun.", qType: "typing",
    random: true, timeLimit: 15, answers: ["sun"],
    correctAnswers: ["sun"], answerTypes: ["exactly"],
    image: "", audio: "",
  });
  question.parent = form;
  const identity = node("INPUT", "", { type: "hidden" });
  identity.value = "wrong-set";
  form.selectors['input#setId[name="setId"]'] = [identity];
  const cancel = node("BUTTON", "Cancel", { type: "button" });
  let cancels = 0;
  cancel.click = () => { cancels++; };
  form.selectors['button[type="button"]'] = [cancel];
  document.selectors['input#question[name="question"]'] = [question];
  document.selectors['form input#question[name="question"]'] = [question];
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    assert.equal(closeBlooketQuestionPanel("fixture"), false);
    assert.equal(cancels, 0);
    identity.value = "fixture";
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, true);
    form.selectors['input#setId[name="setId"]'] = [identity, identity];
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    assert.equal(closeBlooketQuestionPanel("fixture"), false);
    form.selectors['input#setId[name="setId"]'] = [identity];
    document.selectors['input#question[name="question"]'] = [
      question, question,
    ];
    document.selectors['form input#question[name="question"]'] = [
      question, question,
    ];
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    assert.equal(closeBlooketQuestionPanel("fixture"), false);
    assert.equal(cancels, 0);
    document.selectors['input#question[name="question"]'] = [question];
    document.selectors['form input#question[name="question"]'] = [question];
    form.selectors['input#setId[name="setId"]'] = [];
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    assert.equal(closeBlooketQuestionPanel("fixture"), false);
    form.selectors['input#setId[name="setId"]'] = [identity];
    identity.getAttribute = (name) => name === "type" ? "text" : null;
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    assert.equal(closeBlooketQuestionPanel("fixture"), false);
    identity.getAttribute = (name) => name === "type" ? "hidden" : null;
    question.getAttribute = (name) => name === "type" ? "text" : null;
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    assert.equal(closeBlooketQuestionPanel("fixture"), false);
    assert.equal(cancels, 0);
  });
});
