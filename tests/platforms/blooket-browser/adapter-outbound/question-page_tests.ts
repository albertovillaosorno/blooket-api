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
//   - Synthetic regressions for observed Blooket question-modal extraction.
// - Must-Not:
//   - Submit a form, contact Blooket, or infer hidden provider state.
// - Allows:
//   - Inputs: Synthetic controls and serialized question form values.
//   - Outputs: Assertions about bounded text-only question read behavior.
//   - Side effects: Temporary document/location globals restored per case.
// - Split-When:
//   - Media-answer reads gain a separately representable runtime contract.
// - Merge-When:
//   - Question reads no longer require a browser-specific adapter.
// - Summary:
//   - Verifies question modal reads fail closed without relying on CSS classes.
// - Description:
//   - Mirrors the recovered edit controls used by question-page.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Loading, ambiguity, malformed JSON, and answer media are rejected.
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

test("question panels expose exact text-only read facts without saving", () => {
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

  const hidden = node("INPUT");
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
    assert.equal(openBlooketQuestionPanel(1), true);
    assert.equal(opened, 1);
    const result = inspectOpenedBlooketQuestion(1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, {
        schemaVersion: 1,
        number: 1,
        question: "Type sun.",
        qType: "typing",
        random: true,
        timeLimit: 15,
        answers: ["sun", "the sun"],
        correctAnswers: ["sun", "the sun"],
        answerTypes: ["exactly", "contains"],
        hasImage: true,
        hasAudio: false,
      });
      assert.equal(decodeBlooketQuestionRead(result.value).ok, true);
    }
    assert.equal(closeBlooketQuestionPanel(), true);
    assert.equal(closed, 1);
    assert.equal(isBlooketQuestionPanelClosed(), true);
    document.selectors['input#question[name="question"]'] = [hidden];

    hidden.value = JSON.stringify({
      number: 1,
      question: "Image answer",
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: ["opaque\u0060~\u0060https://provider.invalid/media"],
      correctAnswers: [],
      answerTypes: null,
      image: "",
      audio: "",
    });
    assert.equal(inspectOpenedBlooketQuestion(1).ok, false);
    hidden.value = JSON.stringify({
      number: 1,
      question: "Math answer",
      qType: "mc",
      random: false,
      timeLimit: 20,
      answers: ["2`*`x"],
      correctAnswers: ["2`*`x"],
      answerTypes: [],
      image: "",
      audio: "",
    });
    const multipleChoice = inspectOpenedBlooketQuestion(1);
    assert.equal(multipleChoice.ok, true);
    if (multipleChoice.ok) {
      const value = multipleChoice.value as { answerTypes?: unknown };
      assert.equal(value.answerTypes, null);
      assert.equal(decodeBlooketQuestionRead(value).ok, true);
    }
    hidden.value = "{bad";
    assert.equal(inspectOpenedBlooketQuestion(1).ok, false);
  });
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
    assert.equal(openBlooketQuestionPanel(0), false);

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
    assert.equal(inspectOpenedBlooketQuestion(1).ok, false);
    hidden.value = "x".repeat(100_001);
    assert.equal(inspectOpenedBlooketQuestion(1).ok, false);
  });
  },
);
