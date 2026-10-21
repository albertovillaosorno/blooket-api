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
//   - Read-only provider contract-drift and content-exposure regression tests.
// - Must-Not:
//   - Contact Blooket, submit a form or capture real private content.
// - Allows:
//   - Inputs: Synthetic editor controls, altered fields and routes.
//   - Outputs: Stable non-sensitive compatibility states and drift checks.
//   - Side effects: Scoped browser global stubs restored after each test.
// - Split-When:
//   - Other provider pages need independent read-only shape checks.
// - Merge-When:
//   - This read-only compatibility probe is replaced by a versioned schema.
// - Summary:
//   - Detects provider UI drift before trusting editor selectors.
// - Description:
//   - No synthetic success is claimed as real platform acceptance.
// - Usage:
//   - Run as part of the dedicated provider drift regression command.
// - Defaults:
//   - Unknown or changing forms report drift without clicking.
//
import assert from "node:assert/strict";
import test from "node:test";
import { inspectBlooketQuestionEditorCompatibility } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/blooket-browser/adapter-outbound/compatibility-page.ts";

class Node {
  tagName = "DIV";
  id = "";
  type = "";
  value = "";
  textContent = "";
  selectors: Record<string, Node[]> = {};
  form: Node | null = null;
  clicked = 0;
  constructor(tag: string, value = "") {
    this.tagName = tag;
    this.value = value;
  }
  querySelectorAll(query: string) { return this.selectors[query] ?? []; }
  querySelector(query: string) {
    return this.querySelectorAll(query)[0] ?? null;
  }
  closest(query: string) { return query === "form" ? this.form : null; }
  getBoundingClientRect() { return { width: 20, height: 20 }; }
  click() { this.clicked++; }
}

function withEditor(
  callback: (page: ReturnType<typeof fixture>) => void,
  questionKind: "typing" | "mc" = "typing",
): void {
  const page = fixture(questionKind);
  const names = ["document", "location", "getComputedStyle"] as const;
  const originals = names.map(name =>
    Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, "document", {
    configurable: true, value: page.document,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL("https://dashboard.blooket.com/edit?id=set-fixture"),
  });
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => ({ display: "block", visibility: "visible" }),
  });
  try { callback(page); }
  finally {
    names.forEach((name, index) => {
      if (originals[index])
        Object.defineProperty(globalThis, name, originals[index]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

function fixture(questionKind: "typing" | "mc") {
  const document = new Node("DOCUMENT");
  const form = new Node("FORM");
  const hidden = new Node("INPUT");
  hidden.type = "hidden";
  hidden.form = form;
  const setId = new Node("INPUT", "set-fixture");
  const picker = new Node("DIV");
  const prompt = new Node("TEXTAREA", "Private synthetic question");
  const time = new Node("INPUT", "15");
  time.type = "number";
  const texts = questionKind === "typing"
    ? ["secret answer"] : ["one", "two", "", ""];
  const fields = texts.map((text, index) => {
    const field = new Node(questionKind === "typing" ?
      "INPUT" : "TEXTAREA", text);
    if (questionKind === "mc") field.id = "answer-" + index;
    return field;
  });
  const serialized = {
    number: 1, question: prompt.value,
    answers: questionKind === "typing" ? texts : texts.slice(0, 2),
    correctAnswers: [texts[0]], image: "", audio: "",
    qType: questionKind, random: true,
    answerTypes: questionKind === "typing" ? ["exactly"] : null,
    timeLimit: 15,
  };
  hidden.value = JSON.stringify(serialized);
  document.selectors['input#question[name="question"]'] = [hidden];
  form.selectors['input#setId[name="setId"]'] = [setId];
  form.selectors['[role="combobox"]'] = [picker];
  form.selectors['textarea#question'] = [prompt];
  form.selectors['input#time-limit'] = [time];
  form.selectors['input[name="accepted-answers"]'] =
    questionKind === "typing" ? fields : [];
  form.selectors['textarea[id^="answer-"]'] =
    questionKind === "mc" ? fields : [];
  return { document, form, hidden, setId, picker, prompt, time, fields };
}

test("read-only compatibility probes serialize without module context", () => {
  const injected = Function("return (" +
    inspectBlooketQuestionEditorCompatibility.toString() + ")")() as
      typeof inspectBlooketQuestionEditorCompatibility;
  withEditor(page => {
    assert.deepEqual(injected(), inspectBlooketQuestionEditorCompatibility());
    assert.equal(page.hidden.clicked, 0);
    assert.equal(page.picker.clicked, 0);
  });
});

test("current typing and multiple choice fixture shapes are compatible", () => {
  for (const kind of ["typing", "mc"] as const)
    withEditor(page => {
      const result = inspectBlooketQuestionEditorCompatibility();
      assert.equal(result.state, "shape-compatible");
      assert.ok(Object.values(result.controls).every(Boolean));
      assert.equal(JSON.stringify(result).includes("Private synthetic"), false);
      assert.equal(JSON.stringify(result).includes("secret answer"), false);
      assert.equal(JSON.stringify(result).includes("set-fixture"), false);
      assert.equal(page.hidden.clicked, 0);
    }, kind);
});

test("missing editor and foreign routes do not masquerade as drift", () => {
  withEditor(page => {
    page.document.selectors['input#question[name="question"]'] = [];
    assert.equal(inspectBlooketQuestionEditorCompatibility().state,
      "editor-closed");
    const save = new Node("BUTTON");
    save.textContent = "Save Question";
    page.document.selectors['button[type="submit"]'] = [save];
    assert.equal(inspectBlooketQuestionEditorCompatibility().state,
      "shape-drift");
  });
});

test("security stops cannot be confused with a compatible editor", () => {
  withEditor(page => {
    (page.document as Node & { title: string }).title = "Just a moment...";
    assert.equal(inspectBlooketQuestionEditorCompatibility().state,
      "human-stop");
  });
});

test("visible alertdialogs are human stops, not write-ready editors",
  () => {
  withEditor(page => {
    page.document.selectors['[role="alertdialog"]'] = [new Node("DIV")];
    assert.equal(inspectBlooketQuestionEditorCompatibility().state,
      "human-stop");
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({ display: "none", visibility: "visible" }),
    });
    assert.equal(inspectBlooketQuestionEditorCompatibility().state,
      "shape-compatible", "a hidden former alert must not mask the editor");
  });
});

test("native open dialog is a compatibility human stop", () => {
  withEditor(page => {
    page.document.selectors["dialog[open]"] = [new Node("DIALOG")];
    assert.equal(inspectBlooketQuestionEditorCompatibility().state,
      "human-stop");
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: () => ({ display: "none", visibility: "visible" }),
    });
    assert.equal(inspectBlooketQuestionEditorCompatibility().state,
      "shape-compatible");
  });
});

test("multiple choice answer-slot IDs cannot silently be renumbered", () => {
  withEditor(page => {
    page.fields[1]!.id = "answer-7";
    assert.equal(inspectBlooketQuestionEditorCompatibility().state,
      "shape-drift");
    assert.equal(page.fields.some(field => field.clicked > 0), false);
  }, "mc");
});

test("foreign routes and unexpected edit parameters report incompatibility",
  () => {
  for (const route of ["/create", "/my-sets", "/edit/extra"])
    withEditor(() => {
      (globalThis.location as URL).pathname = route;
      assert.equal(inspectBlooketQuestionEditorCompatibility().state,
        "other-page", route);
    });
  for (const change of ["query", "duplicate", "fragment"] as const)
    withEditor(() => {
      const url = globalThis.location as URL;
      if (change === "query") url.searchParams.set("other", "yes");
      if (change === "duplicate")
        url.searchParams.append("id", "set-fixture");
      if (change === "fragment") url.hash = "#unrecognized";
      assert.equal(inspectBlooketQuestionEditorCompatibility().state,
        "shape-drift", change);
    });
});

test("unexpected DOM exceptions cannot reveal account content", () => {
  withEditor(page => {
    page.document.querySelectorAll = () => {
      throw Error("synthetic private fixture data");
    };
    const report = inspectBlooketQuestionEditorCompatibility();
    assert.equal(report.state, "shape-drift");
    assert.equal(JSON.stringify(report).includes("private fixture"), false);
    assert.equal(page.hidden.clicked, 0);
  });
});

test("changed question semantics are provider drift, not success", () => {
  for (const variant of ["no-correct", "unknown-correct", "wrong-mode",
    "wrong-time", "wrong-number", "wrong-random", "wrong-answer-type",
    "wrong-audio"] as const)
    withEditor(page => {
      const value = JSON.parse(page.hidden.value);
      if (variant === "no-correct") value.correctAnswers = [];
      if (variant === "unknown-correct")
        value.correctAnswers = ["not an answer"];
      if (variant === "wrong-mode") value.answerTypes = ["approximate"];
      if (variant === "wrong-time") value.timeLimit = 0;
      if (variant === "wrong-number") value.number = -1;
      if (variant === "wrong-random") value.random = false;
      if (variant === "wrong-answer-type") value.answers = [7];
      if (variant === "wrong-audio") value.audio = { token: "unexpected" };
      page.hidden.value = JSON.stringify(value);
      assert.equal(inspectBlooketQuestionEditorCompatibility().state,
        "shape-drift", variant);
      assert.equal(page.hidden.clicked, 0, variant);
    });
});

test("provider security frames and organization prompts are human stops",
  () => {
  for (const kind of ["challenge", "organization"] as const)
    withEditor(page => {
      const node = new Node(kind === "challenge" ? "IFRAME" : "H3");
      if (kind === "challenge") {
        page.document.selectors[
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
        ] = [node];
      } else {
        node.textContent = "Select your organization";
        page.document.selectors[
          '[role="dialog"][aria-modal="true"] h3'
        ] = [node];
      }
      assert.equal(inspectBlooketQuestionEditorCompatibility().state,
        "human-stop");
      assert.equal(page.hidden.clicked, 0);
    });
  });

test("changed route, ownership and ambiguous controls report drift", () => {
  for (const change of ["id", "missing-picker", "double-picker",
    "time", "time-type", "prompt", "answer", "hidden", "extra",
    "duplicate", "answer-tag", "answer-order"] as const)
    withEditor(page => {
      if (change === "id") page.setId.value = "different-set";
      if (change === "missing-picker")
        page.form.selectors['[role="combobox"]'] = [];
      if (change === "double-picker")
        page.form.selectors['[role="combobox"]'].push(new Node("DIV"));
      if (change === "time") page.time.value = "20";
      if (change === "time-type") page.time.type = "text";
      if (change === "prompt") page.prompt.value = "different prompt";
      if (change === "answer") page.fields[0]!.value = "different answer";
      if (change === "answer-tag") page.fields[0]!.tagName = "TEXTAREA";
      if (change === "hidden") page.hidden.value = "not-json";
      if (change === "extra") page.hidden.value = JSON.stringify({
        ...JSON.parse(page.hidden.value), unexpectedProviderField: true,
      });
      if (change === "duplicate")
        page.document.selectors['input#question[name="question"]'].push(
          new Node("INPUT"),
        );
      if (change === "answer-order") {
        const answer = page.fields[0]!;
        answer.id = "answer-3";
        page.form.selectors['input[name="accepted-answers"]'] = [];
        page.form.selectors['textarea[id^="answer-"]'] = [answer];
      }
      const result = inspectBlooketQuestionEditorCompatibility();
      assert.equal(result.state, "shape-drift", change);
      assert.equal(page.picker.clicked, 0, change);
      assert.equal(page.hidden.clicked, 0, change);
    });
});
