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
  readonly parentElement?: FixtureNode;
  selectors: Record<string, FixtureNode[]>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FixtureNode | null;
  querySelectorAll(selector: string): FixtureNode[];
  closest(selector: string): FixtureNode | null;
  getBoundingClientRect(): { readonly width: number; readonly height: number };
  click(): void;
  addEventListener(type: string, listener: (event: { isTrusted: boolean }) =>
    void): void;
  removeEventListener(type: string, listener: (event: { isTrusted: boolean })
    => void): void;
  dispatchTrusted(type: string): void;
}

function node(
  tagName: string,
  textContent = "",
  attributes: Record<string, string> = {},
): FixtureNode {
  const listeners = new Map<string,
    Set<(event: { isTrusted: boolean }) => void>>();
  return {
    tagName,
    textContent,
    selectors: {},
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchTrusted(type) {
      for (const listener of listeners.get(type) ?? [])
        listener({ isTrusted: true });
    },
    get parentElement() { return this.parent; },
    getAttribute: (name) => attributes[name] ?? null,
    querySelector(selector) {
      return this.selectors[selector]?.[0] ?? null;
    },
    querySelectorAll(selector) {
      return this.selectors[selector] ?? [];
    },
    getBoundingClientRect: () => ({ width: 24, height: 20 }),
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

function questionHeader(document: FixtureNode, count: number): FixtureNode {
  const header = node("DIV");
  const heading = node("H1", "Synthetic set");
  const wrapper = node("DIV");
  heading.parent = wrapper;
  wrapper.parent = header;
  const counter = node("DIV",
    count + (count === 1 ? " Question" : " Questions"));
  header.selectors["div"] = [counter];
  header.selectors["button"] = [
    node("BUTTON", "Save Set"), node("BUTTON", "Edit Info"),
  ];
  document.selectors["main h1"] = [heading];
  return counter;
}

function page(document: FixtureNode, href: string, run: () => void): void {
  document.selectors["main"] ??= [node("MAIN")];
  document.selectors['nav a[href="/my-sets"]'] ??= [node("A", "My Sets")];
  document.selectors['a[href="https://id.blooket.com/logout"]'] ??= [
    node("A", "Logout"),
  ];
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
    const world = globalThis as typeof globalThis & {
      __blooketQuestionEditWatch?: {
        document: Document; dispose: () => void
      };
    };
    if (world.__blooketQuestionEditWatch?.document === document)
      world.__blooketQuestionEditWatch.dispose();
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
    document.selectors['input#question[name="question"]'] = [hidden];
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
  form.selectors['button[type="submit"]'] = [
    node("BUTTON", " Save  Question ", { type: "submit" }),
  ];
  document.selectors['form input#question[name="question"]'] = [hidden];

  questionHeader(document, 1);
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
    const save = form.selectors['button[type="submit"]']![0]!;
    save.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    save.getBoundingClientRect = () => ({ width: 24, height: 20 });
    (save as FixtureNode & { disabled?: boolean }).disabled = true;
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    (save as FixtureNode & { disabled?: boolean }).disabled = false;
    form.selectors['button[type="submit"]'] = [];
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    form.selectors['button[type="submit"]'] = [save];
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, true);
    // The form is readable, but stale or ambiguous dashboard shell markers
    // must invalidate every page action before it can click Cancel.
    const main = document.selectors["main"]![0]!;
    const nav = document.selectors['nav a[href="/my-sets"]']![0]!;
    const logout = document.selectors[
      'a[href="https://id.blooket.com/logout"]'
    ]![0]!;
    for (const marker of [
      "hidden-main", "duplicate-main", "hidden-nav", "duplicate-nav",
      "hidden-logout", "duplicate-logout",
    ]) {
      main.getBoundingClientRect = () => ({
        width: marker === "hidden-main" ? 0 : 24, height: 20,
      });
      nav.getBoundingClientRect = () => ({
        width: marker === "hidden-nav" ? 0 : 24, height: 20,
      });
      logout.getBoundingClientRect = () => ({
        width: marker === "hidden-logout" ? 0 : 24, height: 20,
      });
      document.selectors["main"] = marker === "duplicate-main"
        ? [main, node("MAIN")] : [main];
      document.selectors['nav a[href="/my-sets"]'] =
        marker === "duplicate-nav" ? [nav, node("A", "My Sets")] : [nav];
      document.selectors['a[href="https://id.blooket.com/logout"]'] =
        marker === "duplicate-logout"
          ? [logout, node("A", "Logout")] : [logout];
      assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
      assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
      assert.equal(closeBlooketQuestionPanel("fixture"), false);
      assert.equal(closed, 0);
    }
    main.getBoundingClientRect = () => ({ width: 24, height: 20 });
    nav.getBoundingClientRect = () => ({ width: 24, height: 20 });
    logout.getBoundingClientRect = () => ({ width: 24, height: 20 });
    document.selectors["main"] = [main];
    document.selectors['nav a[href="/my-sets"]'] = [nav];
    document.selectors['a[href="https://id.blooket.com/logout"]'] = [logout];
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
    for (const duplicate of [
      { qType: "mc", answers: ["red", "red"],
        correctAnswers: ["red"], answerTypes: [] },
      { qType: "typing", answers: ["sun", "sun"],
        correctAnswers: ["sun"], answerTypes: ["exactly", "contains"] },
      { qType: "mc", answers: ["`~`image-1", "`~`image-1"],
        correctAnswers: ["`~`image-1"], answerTypes: [] },
    ]) {
      hidden.value = JSON.stringify({
        number: 1, question: "Duplicate test", qType: duplicate.qType,
        random: false, timeLimit: 15, ...duplicate,
        image: "", audio: "",
      });
      assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
    }
    hidden.value = "{bad";
    assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
  });
});

test("question modal operations reject switched and duplicate set IDs", () => {
  const document = node("DOCUMENT");
  const group = node("DIV");
  const edit = node("BUTTON", "Edit");
  let clicks = 0;
  edit.click = () => {
    clicks++;
    document.selectors['input#question[name="question"]'] = [hidden];
  };
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
  form.selectors['button[type="submit"]'] = [
    node("BUTTON", " Save  Question ", { type: "submit" }),
  ];

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
    document.selectors['input#question[name="question"]'] = [];
    group.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(openBlooketQuestionPanel("fixture", 1), false);
    group.getBoundingClientRect = () => ({ width: 24, height: 20 });
    edit.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(openBlooketQuestionPanel("fixture", 1), false);
    edit.getBoundingClientRect = () => ({ width: 24, height: 20 });
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
    ] = [first];
    first.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    first.getBoundingClientRect = () => ({ width: 24, height: 20 });
    document.selectors[
      '[role="button"][aria-label^="Edit question "]'
    ] = [];
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    const add = node("BUTTON", "Add Question");
    add.getBoundingClientRect = () => ({ width: 0, height: 0 });
    document.selectors["button"] = [add];
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    add.getBoundingClientRect = () => ({ width: 24, height: 20 });
    document.selectors["button"] = [add, add];
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    document.selectors["button"] = [add];
    // Add Question is rendered even when cards exist. Its presence alone
    // cannot distinguish a genuinely empty set from incomplete hydration.
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
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
  form.selectors['button[type="submit"]'] = [
    node("BUTTON", " Save  Question ", { type: "submit" }),
  ];
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

test("question reads and Cancel stop behind human-action overlays", () => {
  const document = node("DOCUMENT");
  const group = node("DIV", "", { "aria-label": "Edit question 1" });
  const edit = node("BUTTON", "Edit");
  const cancel = node("BUTTON", "Cancel");
  let clicks = 0;
  edit.click = () => { clicks++; };
  cancel.click = () => { clicks++; };
  group.selectors["button"] = [edit];
  document.selectors[
    '[role="button"][aria-label^="Edit question "]'
  ] = [group];
  document.selectors[
    '[role="button"][aria-label="Edit question 1"]'
  ] = [group];
  const form = node("FORM");
  const question = node("INPUT", "", { type: "hidden" });
  question.parent = form;
  question.value = JSON.stringify({
    number: 1, question: "Type sun.", qType: "typing",
    random: true, timeLimit: 15,
    answers: ["sun"], correctAnswers: ["sun"],
    answerTypes: ["exactly"], image: "", audio: "",
  });
  const identity = node("INPUT", "", { type: "hidden" });
  identity.value = "fixture";
  form.selectors['input#setId[name="setId"]'] = [identity];
  form.selectors['button[type="button"]'] = [cancel];
  form.selectors['button[type="submit"]'] = [
    node("BUTTON", " Save  Question ", { type: "submit" }),
  ];
  document.selectors['input#question[name="question"]'] = [question];
  document.selectors['form input#question[name="question"]'] = [question];
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    for (const mode of [
      "organization", "challenge", "missing-shell", "password-overlay",
      "interstitial",
    ] as const) {
      if (mode === "organization") {
        const heading = node("H3", "Select your organization");
        document.selectors[
          '[role="dialog"][aria-modal="true"] h3'
        ] = [heading];
      } else if (mode === "challenge") {
        document.selectors[
          '[role="dialog"][aria-modal="true"] h3'
        ] = [];
        document.selectors[
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
        ] = [node("IFRAME", "", { src: "https://hcaptcha.com/challenge" })];
      } else {
        document.selectors[
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
        ] = [];
        if (mode === "missing-shell") {
          document.selectors['a[href="https://id.blooket.com/logout"]'] = [];
        } else if (mode === "interstitial") {
          (document as FixtureNode & { title: string }).title =
            "Just a moment...";
          document.selectors['input[type="password"]'] = [];
        } else {
          document.selectors['a[href="https://id.blooket.com/logout"]'] = [
            node("A", "Logout"),
          ];
          document.selectors['input[type="password"]'] = [node("INPUT")];
        }
      }
      assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
      assert.equal(openBlooketQuestionPanel("fixture", 1), false);
      assert.equal(inspectOpenedBlooketQuestion("fixture", 1).ok, false);
      assert.equal(closeBlooketQuestionPanel("fixture"), false);
      document.selectors['input#question[name="question"]'] = [];
      assert.equal(isBlooketQuestionPanelClosed("fixture"), false);
      document.selectors['input#question[name="question"]'] = [question];
    }
    assert.equal(clicks, 0);
  });
});

test("all injected question actions work without imported closures", () => {
  const injected = <T extends (...args: never[]) => unknown>(fn: T): T =>
    Function("return (" + fn.toString() + ")")() as T;
  const list = injected(listBlooketQuestionNumbers);
  const open = injected(openBlooketQuestionPanel);
  const inspect = injected(inspectOpenedBlooketQuestion);
  const close = injected(closeBlooketQuestionPanel);
  const isClosed = injected(isBlooketQuestionPanelClosed);
  const document = node("DOCUMENT");
  const group = node("DIV", "", { "aria-label": "Edit question 1" });
  const edit = node("BUTTON", "Edit");
  let opened = 0;
  edit.click = () => {
    opened++;
    document.selectors['input#question[name="question"]'] = [hidden];
  };
  group.selectors["button"] = [edit];
  document.selectors[
    '[role="button"][aria-label^="Edit question "]'
  ] = [group];
  document.selectors[
    '[role="button"][aria-label="Edit question 1"]'
  ] = [group];
  const form = node("FORM");
  const hidden = node("INPUT", "", { type: "hidden" });
  hidden.parent = form;
  hidden.value = JSON.stringify({
    number: 1, question: "Type sun.", qType: "typing",
    random: true, timeLimit: 15, answers: ["sun"],
    correctAnswers: ["sun"], answerTypes: ["exactly"],
    image: "", audio: "",
  });
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
  form.selectors['button[type="submit"]'] = [
    node("BUTTON", " Save  Question ", { type: "submit" }),
  ];
  questionHeader(document, 1);
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.deepEqual(list("fixture"), { ok: true, value: [1] });
    assert.equal(open("fixture", 1), true);
    assert.equal(inspect("fixture", 1).ok, true);
    assert.equal(close("fixture"), true);
    assert.equal(isClosed("fixture"), true);
    assert.equal(opened, 1);
    assert.equal(closed, 1);
    assert.equal(open("fixture", 1), true);
    hidden.value = JSON.stringify({ number: 2 });
    assert.equal(close("fixture"), false);
    assert.equal(closed, 1);
    hidden.value = JSON.stringify({
      number: 1, question: "Type sun.", qType: "typing",
      random: true, timeLimit: 15, answers: ["sun"],
      correctAnswers: ["sun"], answerTypes: ["exactly"],
      image: "", audio: "",
    });
    // A real pointer or form event in the isolated world transfers ownership
    // to the teacher, even if the serialized question JSON is unchanged.
    document.dispatchTrusted("pointerdown");
    assert.equal(close("fixture"), false);
    assert.equal(closed, 1);
    document.dispatchTrusted("change");
    assert.equal(close("fixture"), false);
    assert.equal(closed, 1);
    assert.equal(opened, 2);
  });
});


test("question reads accept the observed closed account menu", () => {
  const document = node("DOCUMENT");
  const logout = node("A", "Logout");
  logout.getBoundingClientRect = () => ({ width: 0, height: 0 });
  document.selectors['a[href="https://id.blooket.com/logout"]'] = [logout];
  const profile = node("A", "Synthetic account");
  document.selectors['a[href="https://id.blooket.com/login"]'] = [profile];
  document.selectors[
    '[role="button"][aria-label^="Edit question "]'
  ] = [node("DIV", "", { "aria-label": "Edit question 1" })];
  questionHeader(document, 1);
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.deepEqual(listBlooketQuestionNumbers("fixture"), {
      ok: true, value: [1],
    });
    profile.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    profile.getBoundingClientRect = () => ({ width: 24, height: 20 });
    document.selectors['input[type="password"]'] = [node("INPUT")];
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
  });
});


test("question enumeration requires the scoped displayed count", () => {
  const document = node("DOCUMENT");
  document.selectors[
    '[role="button"][aria-label^="Edit question "]'
  ] = [];
  const counter = questionHeader(document, 0);
  const heading = document.selectors["main h1"]![0]!;
  const header = heading.parent!.parent!;
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.deepEqual(listBlooketQuestionNumbers("fixture"), {
      ok: true, value: [],
    });
    counter.textContent = "1 Question";
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    document.selectors[
      '[role="button"][aria-label^="Edit question "]'
    ] = [node("DIV", "", { "aria-label": "Edit question 1" })];
    assert.deepEqual(listBlooketQuestionNumbers("fixture"), {
      ok: true, value: [1],
    });
    for (const text of ["0 Questions", "2 Questions", "01 Question"]) {
      counter.textContent = text;
      assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    }
    counter.textContent = "1 Question";
    header.selectors["div"] = [counter, counter];
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    header.selectors["div"] = [counter];
    counter.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    counter.getBoundingClientRect = () => ({ width: 24, height: 20 });
    header.selectors["button"] = [node("BUTTON", "Save Set")];
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    document.selectors["main h1"] = [];
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
  });
});

test("question modal actions refuse disabled and hidden controls", () => {
  const document = node("DOCUMENT");
  const card = node("DIV");
  const edit = node("BUTTON", "Edit");
  let editClicks = 0;
  edit.click = () => {
    editClicks++;
    document.selectors['input#question[name="question"]'] = [hidden];
  };
  card.selectors["button"] = [edit];
  document.selectors[
    '[role="button"][aria-label="Edit question 1"]'
  ] = [card];
  const form = node("FORM");
  const hidden = node("INPUT", "", { type: "hidden" });
  hidden.value = JSON.stringify({ number: 1 });
  hidden.parent = form;
  const identity = node("INPUT", "", { type: "hidden" });
  identity.value = "fixture";
  form.selectors['input#setId[name="setId"]'] = [identity];
  const cancel = node("BUTTON", "Cancel", { type: "button" });
  let cancelClicks = 0;
  cancel.click = () => { cancelClicks++; };
  form.selectors['button[type="button"]'] = [cancel];
  form.selectors['button[type="submit"]'] = [
    node("BUTTON", " Save  Question ", { type: "submit" }),
  ];
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    (edit as FixtureNode & { disabled?: boolean }).disabled = true;
    assert.equal(openBlooketQuestionPanel("fixture", 1), false);
    (edit as FixtureNode & { disabled?: boolean }).disabled = false;
    edit.getAttribute = (key) => key === "aria-disabled" ? "true" : null;
    assert.equal(openBlooketQuestionPanel("fixture", 1), false);
    edit.getAttribute = () => null;
    assert.equal(openBlooketQuestionPanel("fixture", 1), true);
    (cancel as FixtureNode & { disabled?: boolean }).disabled = true;
    assert.equal(closeBlooketQuestionPanel("fixture"), false);
    (cancel as FixtureNode & { disabled?: boolean }).disabled = false;
    cancel.getAttribute = (key) => key === "aria-disabled" ? "true" : null;
    assert.equal(closeBlooketQuestionPanel("fixture"), false);
    cancel.getAttribute = () => null;
    cancel.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(closeBlooketQuestionPanel("fixture"), false);
    cancel.getBoundingClientRect = () => ({ width: 24, height: 20 });
    assert.equal(closeBlooketQuestionPanel("fixture"), true);
  });
  assert.equal(editClicks, 1);
  assert.equal(cancelClicks, 1);
});

test("a teacher-owned question modal is not opened or replaced", () => {
  const document = node("DOCUMENT");
  const card = node("DIV");
  const edit = node("BUTTON", "Edit");
  let clicks = 0;
  edit.click = () => { clicks++; };
  card.selectors["button"] = [edit];
  document.selectors[
    '[role="button"][aria-label^="Edit question "]'
  ] = [card];
  document.selectors[
    '[role="button"][aria-label="Edit question 1"]'
  ] = [card];
  card.getAttribute = (name) =>
    name === "aria-label" ? "Edit question 1" : null;
  questionHeader(document, 1);
  const existing = node("INPUT", "", { type: "hidden" });
  document.selectors['input#question[name="question"]'] = [existing];
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.equal(listBlooketQuestionNumbers("fixture").ok, false);
    assert.equal(openBlooketQuestionPanel("fixture", 1), false);
    assert.equal(clicks, 0);
    // Clearing the user's modal allows the next read to begin normally.
    document.selectors['input#question[name="question"]'] = [];
    assert.deepEqual(listBlooketQuestionNumbers("fixture"), {
      ok: true, value: [1],
    });
    assert.equal(openBlooketQuestionPanel("fixture", 1), true);
    assert.equal(clicks, 1);
  });
});
