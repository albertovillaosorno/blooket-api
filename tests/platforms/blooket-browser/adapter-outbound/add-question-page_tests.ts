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
  parentElement?: FixtureNode;
  clicked: number;
  visibility: string;
  disabled?: boolean;
  selectors: Record<string, FixtureNode[]>;
  attributes: Record<string, string>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FixtureNode | null;
  querySelectorAll(selector: string): FixtureNode[];
  closest(selector: string): FixtureNode | null;
  dispatchEvent(event: Event): boolean;
  getBoundingClientRect(): { width: number; height: number };
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
    visibility: "visible",
    getBoundingClientRect: () => ({ width: 24, height: 20 }),
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
  const keys = ["document", "location", "HTMLInputElement", "Event",
    "MutationObserver", "getComputedStyle",
    "__blooketAddQuestionFormWatch"] as const;
  const prior = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: (node: FixtureNode) => ({
      display: "block", visibility: node.visibility,
    }),
  });
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
  const events = document as FixtureNode & {
    addEventListener?: (name: string, listener: (event: Event) => void,
      capture?: boolean) => void;
    removeEventListener?: (name: string, listener: (event: Event) => void,
      capture?: boolean) => void;
  };
  events.addEventListener ??= () => {};
  events.removeEventListener ??= () => {};
  if (!globalThis.MutationObserver) {
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: class { observe() {} disconnect() {} },
    });
  }
  const field = document.querySelector('input#question[name="question"]');
  if (field && href.startsWith("https://dashboard.blooket.com/edit?")) {
    const form = field.closest("form");
    if (form) {
      Object.assign(form, { isConnected: true });
      Object.defineProperty(globalThis, "__blooketAddQuestionFormWatch", {
        configurable: true,
        value: { document, form, question: field, setId: "set-fixture",
          dirty: false, submitted: false, prepared: false, finalized: false,
          dispose: () => {} },
      });
    }
  }
  try {
    run();
  } finally {
    const world = globalThis as typeof globalThis & {
      __blooketAddQuestionFormWatch?: { dispose: () => void };
    };
    world.__blooketAddQuestionFormWatch?.dispose();
    for (const [key, descriptor] of prior) {
      if (descriptor)
        Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function fixture() {
  const document = node("DOCUMENT");
  document.selectors["main"] = [node("MAIN")];
  document.selectors['nav a[href="/my-sets"]'] = [node("A", "My Sets")];
  document.selectors['a[href="https://id.blooket.com/logout"]'] = [
    node("A", "Logout"),
  ];
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

function closedQuestionEditor(
  page: ReturnType<typeof fixture>,
  opener: FixtureNode = page.add,
): void {
  const selector = 'input#question[name="question"]';
  const clicked = opener.click.bind(opener);
  page.document.selectors[selector] = [];
  opener.click = () => {
    clicked();
    page.document.selectors[selector] = [page.hidden];
  };
}

function withImagePage(
  run: (page: ReturnType<typeof fixture>, interact: () => void,
    detached: () => void, settle: () => void) => void,
  delayed = false,
): void {
  const page = fixture();
  const nativeClick = page.add.click.bind(page.add);
  page.document.selectors['input#question[name="question"]'] = [];
  page.add.click = () => {
    nativeClick();
    page.document.selectors['input#question[name="question"]'] = [page.hidden];
  };
  const listeners = new Set<(event: { isTrusted: boolean }) => void>();
  const document = page.document as FixtureNode & {
    addEventListener: (name: string,
      listener: (event: unknown) => void) => void;
    removeEventListener: (name: string,
      listener: (event: unknown) => void) => void;
    createElement: () => FixtureNode;
  };
  document.addEventListener = (_name, listener) => { listeners.add(listener); };
  document.removeEventListener = (_name, listener) => {
    listeners.delete(listener);
  };
  const fileNode = (name: string) => {
    const input = node("INPUT");
    for (const key of ["name", "type", "accept"]) Object.defineProperty(
      input, key, {
        get: () => input.attributes[key],
        set: (value: string) => { input.attributes[key] = value; },
      });
    input.attributes["name"] = name;
    input.attributes["type"] = "file";
    input.parent = page.form;
    return input;
  };
  // Product code must use the provider's input, never fabricate a hidden one.
  document.createElement = () => { throw new Error("unexpected-input"); };
  const form = page.form as FixtureNode & { isConnected: boolean };
  form.isConnected = true;
  const picker = fileNode("");
  picker.attributes["accept"] = "image/jpeg,image/png,image/gif,image/svg+xml";
  Object.assign(picker, { multiple: false });
  form.selectors['input[type="file"]'] = [picker];
  const settle = () => {
    const hidden = fileNode("coverImageFile");
    Object.assign(hidden, { hidden: true, files: picker.files });
    form.selectors['input[type="file"]'] = [hidden];
    form.selectors['input[name="coverImageFile"]'] = [hidden];
    form.selectors["button"] = [node("BUTTON", "Remove Image")];
    page.hidden.value = JSON.stringify({ number: 1, audio: "",
      image: "blob:https://dashboard.blooket.com/provider-owned" });
  };
  picker.dispatchEvent = event => {
    assert.equal(event.type, "change");
    if (!delayed) settle();
    return true;
  };
  let mutation = () => {};
  class Observer {
    constructor(callback: () => void) { mutation = callback; }
    observe() {}
    disconnect() {}
  }
  class Transfer {
    readonly files: File[] = [];
    readonly items = { add: (file: File) => { this.files.push(file); } };
  }
  const names = ["DataTransfer", "MutationObserver"];
  const previous = names.map(name =>
    Object.getOwnPropertyDescriptor(globalThis, name));
  for (const [i, name] of names.entries()) Object.defineProperty(globalThis,
    name, { configurable: true, value: [Transfer, Observer][i] });
  try {
    withPage(page.document,
      "https://dashboard.blooket.com/edit?id=set-fixture", () => run(
        page,
        () => {
          for (const listener of listeners) listener({ isTrusted: true });
        },
        () => { form.isConnected = false; mutation(); },
        settle,
      ));
  } finally {
    const world = globalThis as typeof globalThis & {
      __blooketAddQuestionFormWatch?: { dispose: () => void };
    };
    world.__blooketAddQuestionFormWatch?.dispose();
    for (const [i, name] of names.entries()) {
      if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("owned prepared image uses a File without opening a native picker", () => {
  const image = { format: "png" as const, base64: "iVBORw0KGgoA" };
  withImagePage((page, _interact, detached) => {
    assert.equal(runBlooketAddQuestionPageAction("open-image", "set-fixture"),
      true);
    const input = { ...typing, image };
    assert.deepEqual(prepareBlooketAddQuestionForm(input), { ok: true });
    const file = page.form.selectors['input[type="file"]']![0]!;
    assert.equal(file.clicked, 0);
    assert.equal(file.files?.length, 1);
    assert.match(JSON.parse(page.hidden.value).image, /^blob:/u);
    assert.equal(runBlooketAddQuestionPageAction(
      "is-image-ready", "set-fixture",
    ), true);
    assert.deepEqual(runBlooketAddQuestionPageAction(
      "finalize-image", input,
    ), { ok: true });
    assert.deepEqual(submitBlooketAddQuestionForm(input), { ok: true });
    assert.equal(submitBlooketAddQuestionForm(input).ok, false);
    assert.equal(page.submit.clicked, 1);
    detached();
    assert.equal(Object.hasOwn(globalThis, "__blooketAddQuestionFormWatch"),
      false);
  });
});

test("image submission refuses replaced files, human input, and changed bytes",
  () => {
    const input = {
      ...typing, image: { format: "png" as const, base64: "iVBORw0KGgoA" },
    };
    for (const change of ["file", "human", "bytes", "raw", "type"] as const)
      withImagePage((page, interact) => {
        assert.equal(runBlooketAddQuestionPageAction(
          "open-image", "set-fixture",
        ), true);
        assert.deepEqual(prepareBlooketAddQuestionForm(input), { ok: true });
        assert.equal(runBlooketAddQuestionPageAction(
          "is-image-ready", "set-fixture",
        ), true);
        assert.deepEqual(runBlooketAddQuestionPageAction(
          "finalize-image", input,
        ), { ok: true });
        const file = page.form.selectors['input[type="file"]']![0]!;
        if (change === "file") file.files = [new File(["other"], "other.png")];
        if (change === "human") interact();
        if (change === "raw") page.hidden.value += " ";
        if (change === "type") file.attributes["type"] = "text";
        const changed = change === "bytes"
          ? { ...input, image: { ...input.image, base64: "iVBORw0KGgoB" } }
          : input;
        assert.equal(submitBlooketAddQuestionForm(changed).ok, false);
        assert.equal(page.submit.clicked, 0);
      });
  },
);

test("new image opens cannot replace a still-owned or submitted upload",
  () => {
  const image = { format: "png" as const, base64: "iVBORw0KGgoA" };
  withImagePage((page) => {
    assert.equal(runBlooketAddQuestionPageAction(
      "open-image", "set-fixture",
    ), true);
    assert.deepEqual(prepareBlooketAddQuestionForm({ ...typing, image }),
      { ok: true });
    const before = page.add.clicked;
    page.document.selectors['input#question[name="question"]'] = [];
    assert.equal(runBlooketAddQuestionPageAction(
      "open-image", "set-fixture",
    ), false);
    assert.equal(page.add.clicked, before);
  });
  withImagePage((page) => {
    assert.equal(runBlooketAddQuestionPageAction(
      "open-image", "set-fixture",
    ), true);
    const input = { ...typing, image };
    assert.deepEqual(prepareBlooketAddQuestionForm(input), { ok: true });
    assert.equal(runBlooketAddQuestionPageAction(
      "is-image-ready", "set-fixture",
    ), true);
    assert.deepEqual(runBlooketAddQuestionPageAction(
      "finalize-image", input,
    ), { ok: true });
    assert.deepEqual(submitBlooketAddQuestionForm(input), { ok: true });
    const before = page.add.clicked;
    page.document.selectors['input#question[name="question"]'] = [];
    assert.equal(runBlooketAddQuestionPageAction(
      "open-image", "set-fixture",
    ), false);
    assert.equal(page.add.clicked, before);
    assert.equal(page.submit.clicked, 1);
  });
  },
);

test("owned image cancellation releases transient file and input watches",
  () => {
  const image = { format: "png" as const, base64: "iVBORw0KGgoA" };
  withImagePage((page) => {
    const cancel = node("BUTTON", "Cancel", { type: "button" });
    cancel.parent = page.form;
    page.form.selectors['button[type="button"]'] = [cancel];
    assert.equal(runBlooketAddQuestionPageAction(
      "open-image", "set-fixture",
    ), true);
    assert.deepEqual(prepareBlooketAddQuestionForm({ ...typing, image }),
      { ok: true });
    assert.deepEqual(runBlooketAddQuestionPageAction(
      "cancel-image", "set-fixture",
    ), { ok: true });
    assert.equal(cancel.clicked, 1);
    assert.equal(Object.hasOwn(globalThis, "__blooketAddQuestionFormWatch"),
      false);
    assert.equal(submitBlooketAddQuestionForm({ ...typing, image }).ok,
      false);
  });
  },
);

test("provider image preparation must settle before finalization or submit",
  () => {
  const input = {
    ...typing, image: { format: "png" as const, base64: "iVBORw0KGgoA" },
  };
  withImagePage((page, _interact, _detached, settle) => {
    const serialized = Function(
      "return (" + runBlooketAddQuestionPageAction.toString() + ")",
    )() as typeof runBlooketAddQuestionPageAction;
    assert.equal(serialized("open-image", "set-fixture"), true);
    assert.deepEqual(serialized("prepare", input), { ok: true });
    assert.deepEqual(serialized("prepare", input), {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(serialized("is-image-ready", "set-fixture"), false);
    assert.equal(submitBlooketAddQuestionForm(input).ok, false);
    assert.deepEqual(serialized("finalize-image", input), {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.submit.clicked, 0);
    settle();
    assert.equal(serialized("is-image-ready", "set-fixture"), true);
    assert.deepEqual(serialized("finalize-image", input), { ok: true });
    assert.deepEqual(serialized("finalize-image", input), {
      ok: false, code: "blooket-browser-failed",
    });
    assert.deepEqual(serialized("submit", input), { ok: true });
    assert.equal(page.submit.clicked, 1);
  }, true);
});

test("provider image readiness refuses changed previews and ambiguous controls",
  () => {
  const input = {
    ...typing, image: { format: "png" as const, base64: "iVBORw0KGgoA" },
  };
  for (const reason of ["number", "audio", "url", "duplicate", "button",
    "hidden", "human", "replaced"] as const) {
    withImagePage((page, interact) => {
      assert.equal(runBlooketAddQuestionPageAction(
        "open-image", "set-fixture",
      ), true);
      assert.deepEqual(prepareBlooketAddQuestionForm(input), { ok: true });
      const raw = JSON.parse(page.hidden.value);
      if (reason === "number") raw.number = 2;
      if (reason === "audio") raw.audio = "unexpected";
      if (reason === "url") raw.image = "blob:https://foreign.invalid/file";
      page.hidden.value = JSON.stringify(raw);
      if (reason === "duplicate") page.form.selectors["button"]!.push(
        node("BUTTON", "Remove Image"),
      );
      if (reason === "button") page.form.selectors["button"]![0]!.disabled =
        true;
      if (reason === "hidden") Object.assign(
        page.form.selectors['input[name="coverImageFile"]']![0]!,
        { hidden: false },
      );
      if (reason === "human") interact();
      if (reason === "replaced") {
        assert.equal(runBlooketAddQuestionPageAction(
          "is-image-ready", "set-fixture",
        ), true);
        raw.image += "-changed";
        page.hidden.value = JSON.stringify(raw);
      }
      assert.equal(runBlooketAddQuestionPageAction(
        "is-image-ready", "set-fixture",
      ), false);
      assert.equal(submitBlooketAddQuestionForm(input).ok, false);
      assert.equal(page.submit.clicked, 0);
    });
  }
});

test("unrecognized file picker never receives bytes or opens a native dialog",
  () => {
  for (const reason of ["accept", "name", "multiple", "disabled",
    "duplicate", "form"] as const) {
    withImagePage((page) => {
      assert.equal(runBlooketAddQuestionPageAction(
        "open-image", "set-fixture",
      ), true);
      const picker = page.form.selectors['input[type="file"]']![0]!;
      if (reason === "accept") picker.attributes["accept"] = "*/*";
      if (reason === "name") picker.attributes["name"] = "another-slot";
      if (reason === "multiple") Object.assign(picker, { multiple: true });
      if (reason === "disabled") picker.disabled = true;
      if (reason === "duplicate")
        page.form.selectors['input[type="file"]']!.push(picker);
      if (reason === "form") picker.attributes["form"] = "another-form";
      assert.equal(prepareBlooketAddQuestionForm({ ...typing,
        image: { format: "png", base64: "iVBORw0KGgoA" } }).ok, false);
      assert.equal(picker.files, undefined);
      assert.equal(picker.clicked, 0);
      assert.equal(page.submit.clicked, 0);
    });
  }
});

test("an existing teacher editor cannot be claimed for image upload", () => {
  const page = fixture();
  withPage(page.document, "https://dashboard.blooket.com/edit?id=set-fixture",
    () => {
      assert.equal(runBlooketAddQuestionPageAction("open-image", "set-fixture"),
        false);
      assert.equal(prepareBlooketAddQuestionForm({
        ...typing, image: { format: "png", base64: "iVBORw0KGgoA" },
      }).ok, false);
      assert.equal(page.add.clicked, 0);
    });
});

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
  closedQuestionEditor(page);
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

test("unusable Save Question buttons cannot authorize a click", () => {
  for (const reason of ["disabled", "aria", "hidden", "wrong-tag"] as const) {
    const page = fixture();
    withPage(page.document,
      "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.deepEqual(prepareBlooketAddQuestionForm(typing), { ok: true });
      if (reason === "disabled") page.submit.disabled = true;
      if (reason === "aria") page.submit.attributes["aria-disabled"] = "true";
      if (reason === "hidden")
        page.submit.getBoundingClientRect = () => ({ width: 0, height: 0 });
      if (reason === "wrong-tag") page.submit.tagName = "DIV";
      assert.equal(submitBlooketAddQuestionForm(typing).ok, false);
      assert.equal(page.submit.clicked, 0);
    });
  }
});

test("Add Question opens and serializes exact typing state", () => {
  const page = fixture();
  closedQuestionEditor(page);
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
  for (const change of ["raw", "file"] as const) {
    const page = fixture();
    withPage(page.document,
      "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.deepEqual(prepareBlooketAddQuestionForm(typing), { ok: true });
      if (change === "raw")
        page.hidden.value = page.hidden.value.replace("sun", "moon");
      else {
        const file = node("INPUT", "", { type: "file" });
        file.files = { length: 1 };
        page.form.selectors['input[type="file"]'] = [file];
      }
      assert.equal(submitBlooketAddQuestionForm(typing).ok, false);
      assert.equal(page.submit.clicked, 0);
    });
  }
});

test("a text question preparation is single-use and cannot be replayed",
  () => {
  const page = fixture();
  withPage(page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.deepEqual(prepareBlooketAddQuestionForm(typing), { ok: true });
      assert.equal(prepareBlooketAddQuestionForm(typing).ok, false);
      assert.deepEqual(submitBlooketAddQuestionForm(typing), { ok: true });
      assert.equal(submitBlooketAddQuestionForm(typing).ok, false);
      assert.equal(page.submit.clicked, 1);
    });
  },
);

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


test("hidden or disabled Add Question openers are not acknowledged", () => {
  for (const reason of ["disabled", "aria", "hidden"] as const) {
    const page = fixture();
    if (reason === "disabled") page.add.disabled = true;
    if (reason === "aria") page.add.attributes["aria-disabled"] = "true";
    if (reason === "hidden")
      page.add.getBoundingClientRect = () => ({ width: 0, height: 0 });
    withPage(page.document,
      "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.equal(openBlooketAddQuestionPanel("set-fixture"), false);
      assert.equal(page.add.clicked, 0);
    });
  }
});

test("two Add Question buttons resolve only the question-list toolbar", () => {
  const page = fixture();
  const toolbar = node("DIV");
  const bottom = node("BUTTON", "Add Question");
  bottom.parentElement = toolbar;
  toolbar.selectors["button"] = [
    node("BUTTON", "Show all answers"), bottom,
  ];
  page.document.selectors["button"] = [page.add, bottom];
  closedQuestionEditor(page, bottom);
  withPage(page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.equal(openBlooketAddQuestionPanel("set-fixture"), true);
      assert.equal(page.add.clicked, 0);
      assert.equal(bottom.clicked, 1);
      page.document.selectors['input#question[name="question"]'] = [];
      toolbar.selectors["button"]!.push(node("BUTTON", "Add Question"));
      assert.equal(openBlooketAddQuestionPanel("set-fixture"), false);
      assert.equal(bottom.clicked, 1);
    });
});

test(
  "human and security overlays block every Add Question page action",
  () => {
  for (const blocked of ["verification", "password", "organization",
    "captcha"] as const) {
    const page = fixture();
    if (blocked === "verification")
      Object.assign(page.document, { title: "Just a moment..." });
    if (blocked === "password")
      page.document.selectors['input[type="password"]'] = [node("INPUT")];
    if (blocked === "organization")
      page.document.selectors['[role="dialog"][aria-modal="true"] h3'] = [
        node("H3", "Select your organization"),
      ];
    if (blocked === "captcha")
      page.document.selectors[
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
      ] = [node("IFRAME")];
    withPage(page.document,
      "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.equal(openBlooketAddQuestionPanel("set-fixture"), false);
      assert.equal(isBlooketAddQuestionPanelReady("set-fixture"), false);
      assert.deepEqual(prepareBlooketAddQuestionForm(typing), {
        ok: false, code: "blooket-browser-failed",
      });
      assert.deepEqual(submitBlooketAddQuestionForm(typing), {
        ok: false, code: "blooket-browser-failed",
      });
      assert.equal(page.add.clicked, 0);
      assert.equal(page.submit.clicked, 0);
    });
  }
  },
);


test(
  "stale Add Question controls cannot replace a lost dashboard shell",
  () => {
  for (const missing of ["main", "navigation", "logout"] as const) {
    const page = fixture();
    const selector = missing === "main" ? "main" : missing === "navigation"
      ? 'nav a[href="/my-sets"]'
      : 'a[href="https://id.blooket.com/logout"]';
    page.document.selectors[selector] = [];
    withPage(page.document,
      "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.equal(openBlooketAddQuestionPanel("set-fixture"), false);
      assert.equal(isBlooketAddQuestionPanelReady("set-fixture"), false);
      assert.equal(prepareBlooketAddQuestionForm(typing).ok, false);
      assert.equal(submitBlooketAddQuestionForm(typing).ok, false);
      assert.equal(page.add.clicked, 0);
      assert.equal(page.submit.clicked, 0);
    });
  }
});

test("closed Blooket account menu still permits authenticated edits", () => {
  const page = fixture();
  closedQuestionEditor(page);
  const logout = page.document.selectors[
    'a[href="https://id.blooket.com/logout"]'
  ]![0]!;
  logout.getBoundingClientRect = () => ({ width: 0, height: 0 });
  page.document.selectors['a[href="https://id.blooket.com/login"]'] = [
    node("A", "Account"),
  ];
  withPage(page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
    assert.equal(openBlooketAddQuestionPanel("set-fixture"), true);
    assert.equal(page.add.clicked, 1);
  });
});

test("text Add Question never reuses an existing teacher question editor",
  () => {
  const page = fixture();
  withPage(page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.equal(runBlooketAddQuestionPageAction(
        "open", "set-fixture",
      ), false);
      assert.equal(page.add.clicked, 0);
  });
  },
);

test("question openers refuse a visible teacher modal", () => {
  const page = fixture();
  closedQuestionEditor(page);
  const modal = node("DIV");
  page.document.selectors['[role="dialog"][aria-modal="true"]'] = [modal];
  withPage(page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.equal(openBlooketAddQuestionPanel("set-fixture"), false);
      assert.equal(page.add.clicked, 0);
      modal.visibility = "hidden";
      const injected = Function("return (" +
        runBlooketAddQuestionPageAction.toString() + ")",
      )() as typeof runBlooketAddQuestionPageAction;
      assert.equal(injected("open", "set-fixture"), true);
      assert.equal(page.add.clicked, 1);
  });
});

test("trusted teacher interaction vetoes text question submission",
  () => {
  const page = fixture();
  closedQuestionEditor(page);
  const listeners = new Set<(event: { isTrusted: boolean }) => void>();
  const doc = page.document as FixtureNode & {
    addEventListener: (kind: string,
      listener: (event: { isTrusted: boolean }) => void) => void;
    removeEventListener: (kind: string,
      listener: (event: { isTrusted: boolean }) => void) => void;
  };
  doc.addEventListener = (_kind, listener) => { listeners.add(listener); };
  doc.removeEventListener = (_kind, listener) => {
    listeners.delete(listener);
  };
  withPage(page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.equal(openBlooketAddQuestionPanel("set-fixture"), true);
      assert.equal(isBlooketAddQuestionPanelReady("set-fixture"), true);
      assert.deepEqual(prepareBlooketAddQuestionForm(typing), { ok: true });
      assert.ok(listeners.size > 0);
      for (const listener of listeners) listener({ isTrusted: true });
      assert.equal(submitBlooketAddQuestionForm(typing).ok, false);
      assert.equal(page.submit.clicked, 0);
      assert.equal(isBlooketAddQuestionPanelReady("set-fixture"), false);
    });
  assert.equal(listeners.size, 0);
  },
);

test("lost text question ownership cannot authorize a hidden form write",
  () => {
  const page = fixture();
  withPage(page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.deepEqual(prepareBlooketAddQuestionForm(typing), { ok: true });
      Reflect.deleteProperty(globalThis, "__blooketAddQuestionFormWatch");
      assert.equal(submitBlooketAddQuestionForm(typing).ok, false);
      assert.equal(page.submit.clicked, 0);
    });
  },
);

test("Add Question click rechecks the exact prior cards atomically",
  () => {
  const selector = '[role="button"][aria-label^="Edit question "]';
  for (const [number, cards, allowed] of [
    [1, [], true],
    [1, ["Edit question 1"], false],
    [2, ["Edit question 1"], true],
    [2, [], false],
    [2, ["Edit question 2"], false],
    [2, ["Edit question 1", "Edit question 1"], false],
    [3, ["Edit question 1", "Edit question 3"], false],
  ] as const) {
    const page = fixture();
    closedQuestionEditor(page);
    page.document.selectors[selector] = cards.map(label =>
      node("DIV", "", { "aria-label": label }));
    withPage(page.document,
      "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.equal(runBlooketAddQuestionPageAction(
        "open", "set-fixture", number,
      ), allowed);
      assert.equal(page.add.clicked, allowed ? 1 : 0);
    });
  }
  },
);

test("hidden and malformed prior cards never authorize Add Question",
  () => {
  const selector = '[role="button"][aria-label^="Edit question "]';
  const page = fixture();
  closedQuestionEditor(page);
  const hidden = node("DIV", "", { "aria-label": "Edit question 1" });
  hidden.getBoundingClientRect = () => ({ width: 0, height: 0 });
  page.document.selectors[selector] = [hidden];
  withPage(page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
    for (const number of [-1, 0, 2, 201, 1.5, Infinity])
      assert.equal(runBlooketAddQuestionPageAction(
        "open", "set-fixture", number,
      ), false);
    assert.equal(page.add.clicked, 0);
  });
  },
);

test("page opener's observed next slot binds the prepared question number",
  () => {
  const page = fixture();
  closedQuestionEditor(page);
  withPage(page.document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
    assert.equal(runBlooketAddQuestionPageAction(
      "open", "set-fixture", 1,
    ), true);
    assert.equal(runBlooketAddQuestionPageAction(
      "is-ready", "set-fixture",
    ), true);
    assert.deepEqual(runBlooketAddQuestionPageAction("prepare", {
      ...typing, number: 2,
    }), { ok: false, code: "blooket-browser-failed" });
    assert.equal(page.hidden.value, "");
    assert.equal(page.submit.clicked, 0);
  });
  },
);
