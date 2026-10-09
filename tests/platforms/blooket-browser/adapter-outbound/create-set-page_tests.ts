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
//   - Synthetic tests for observed Create Set page preparation and success.
// - Must-Not:
//   - Submit a provider form, upload media, or claim live browser acceptance.
// - Allows:
//   - Inputs: Synthetic DOM controls and dashboard URLs.
//   - Outputs: Exact preparation and redirect-observation assertions.
//   - Side effects: Synthetic input events and checkbox clicks only.
// - Split-When:
//   - Media-backed creation gains independently verified page mechanics.
// - Merge-When:
//   - The Create Set browser surface is removed.
// - Summary:
//   - Proves form filling is separate from submission and confirmation.
// - Description:
//   - Success requires only the observed provider edit redirect with one ID.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Wrong routes and ambiguous controls fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  observeBlooketCreateSetSuccess,
  prepareBlooketCreateSetForm,
  submitBlooketCreateSetForm,
  runBlooketCreateSetOwnership,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/blooket-browser/adapter-outbound/create-set-page.ts";

interface FixtureNode {
  tagName: string;
  textContent: string;
  value: string;
  labels: FixtureNode[];
  clicked: number;
  disabled?: boolean;
  selectors: Record<string, FixtureNode[]>;
  attributes: Record<string, string>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FixtureNode | null;
  querySelectorAll(selector: string): FixtureNode[];
  dispatchEvent(event: Event): boolean;
  click(): void;
  getBoundingClientRect(): { readonly width: number; readonly height: number };
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
    labels: [],
    clicked: 0,
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
    dispatchEvent() {
      return true;
    },
    click() {
      this.clicked++;
      const current = this.attributes["aria-checked"];
      this.attributes["aria-checked"] = current === "true" ? "false" : "true";
    },
  };
}

function withPage(
  document: FixtureNode,
  href: string,
  run: () => void,
  withSyntheticOwner = true,
): void {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const key of [
    "document",
    "location",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Event",
    "__blooketCreateSetWatch",
  ])
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

  class InputFixture {}
  Object.defineProperty(InputFixture.prototype, "value", {
    configurable: true,
    set(this: FixtureNode, value: string) {
      this.value = value;
    },
  });
  class TextareaFixture {}
  Object.defineProperty(TextareaFixture.prototype, "value", {
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
  Object.defineProperty(globalThis, "HTMLTextAreaElement", {
    configurable: true,
    value: TextareaFixture,
  });
  Object.defineProperty(globalThis, "Event", {
    configurable: true,
    value: EventFixture,
  });
  if (withSyntheticOwner && href.endsWith("/create")) {
    const form = document.querySelector("form#question-set-form");
    if (form) {
      Object.assign(form, { isConnected: true });
      Object.defineProperty(globalThis, "__blooketCreateSetWatch", {
        configurable: true,
        value: { document, form, dirty: false, submitted: false },
      });
    }
  }
  try {
    run();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor)
        Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function fixture(privateSet: boolean) {
  const document = node("DOCUMENT");
  document.selectors["main"] = [node("MAIN")];
  document.selectors['nav a[href="/my-sets"]'] = [node("A", "My Sets")];
  document.selectors['a[href="https://id.blooket.com/logout"]'] = [
    node("A", "Logout"),
  ];
  const form = node("FORM");
  const title = node("INPUT");
  const description = node("TEXTAREA");
  const privacy = node("INPUT", "", {
    type: "checkbox",
    role: "switch",
    "aria-checked": privateSet ? "false" : "true",
  });
  privacy.labels = [
    node(
      "LABEL",
      privateSet
        ? "Private (Only playable by you)"
        : "Public (Playable by everyone)",
    ),
  ];
  form.selectors["button"] = [node("BUTTON", "Create Set")];
  form.selectors['input#title[name="title"]'] = [title];
  form.selectors['textarea#desc[name="desc"]'] = [description];
  form.selectors['input#private[name="private"]'] = [privacy];
  document.selectors["form#question-set-form"] = [form];
  document.selectors['input#title[name="title"]'] = [title];
  document.selectors['textarea#desc[name="desc"]'] = [description];
  document.selectors['input#private[name="private"]'] = [privacy];
  return { document, form, title, description, privacy };
}

test("preparation fills observed controls without submitting", () => {
  const page = fixture(true);
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    const result = prepareBlooketCreateSetForm({
      title: "Synthetic set",
      description: "Synthetic description",
      private: true,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(page.title.value, "Synthetic set");
    assert.equal(page.description.value, "Synthetic description");
    assert.equal(page.privacy.clicked, 0);
    assert.equal(page.form.clicked, 0);
  });
});

test("privacy changes only through the observed switch", () => {
  const page = fixture(false);
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    const result = prepareBlooketCreateSetForm({
      title: "Synthetic set",
      description: "",
      private: true,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(page.privacy.clicked, 1);
    assert.equal(page.form.clicked, 0);
  });
});

test(
  "disabled privacy switches cannot acknowledge Create Set preparation",
  () => {
  const input = { title: "Synthetic", description: "", private: true };
  for (const reason of ["disabled", "aria", "hidden"] as const) {
    const page = fixture(false);
    if (reason === "disabled") page.privacy.disabled = true;
    if (reason === "aria")
      page.privacy.attributes["aria-disabled"] = "true";
    if (reason === "hidden")
      page.privacy.getBoundingClientRect = () => ({ width: 0, height: 0 });
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.equal(prepareBlooketCreateSetForm(input).ok, false);
      assert.equal(page.privacy.clicked, 0);
    });
  }
});

test("wrong routes ambiguous controls and visibility fail closed", () => {
  const page = fixture(true);
  withPage(page.document, "https://dashboard.blooket.com/edit?id=x", () => {
    assert.equal(
      prepareBlooketCreateSetForm({
        title: "Synthetic set",
        description: "",
        private: true,
      }).ok,
      false,
    );
  });
  page.form.selectors["button"].push(node("BUTTON", "Create Set"));
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    assert.equal(
      prepareBlooketCreateSetForm({
        title: "Synthetic set",
        description: "",
        private: true,
      }).ok,
      false,
    );
  });
  page.form.selectors["button"].pop();
  page.privacy.labels = [node("LABEL", "Unknown")];
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    assert.equal(
      prepareBlooketCreateSetForm({
        title: "Synthetic set",
        description: "",
        private: true,
      }).ok,
      false,
    );
  });
});

test("submit revalidates prepared state before one exact click", () => {
  const page = fixture(true);
  const submit = page.form.selectors["button"]?.[0];
  assert.ok(submit);
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    const expected = {
      title: "Synthetic set",
      description: "Synthetic description",
      private: true,
    };
    assert.deepEqual(prepareBlooketCreateSetForm(expected), { ok: true });
    assert.deepEqual(submitBlooketCreateSetForm(expected), { ok: true });
    assert.equal(submit.clicked, 1);
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
    assert.equal(prepareBlooketCreateSetForm(expected).ok, false);
    assert.equal(submit.clicked, 1);

    page.title.value = "Changed after preparation";
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
    assert.equal(submit.clicked, 1);
  });
});

test("submit refuses stale privacy and ambiguous submit controls", () => {
  const page = fixture(true);
  const submit = page.form.selectors["button"]?.[0];
  assert.ok(submit);
  const expected = {
    title: "Synthetic set",
    description: "",
    private: true,
  };
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    assert.deepEqual(prepareBlooketCreateSetForm(expected), { ok: true });
    page.privacy.attributes["aria-checked"] = "true";
    page.privacy.labels = [node("LABEL", "Public (Playable by everyone)")];
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
    assert.equal(submit.clicked, 0);

    page.privacy.attributes["aria-checked"] = "false";
    page.privacy.labels = [node("LABEL", "Private (Only playable by you)")];
    page.form.selectors["button"]?.push(node("BUTTON", "Create Set"));
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
    assert.equal(submit.clicked, 0);
  });
});

test("hidden or disabled Create Set buttons cannot be clicked", () => {
  const input = { title: "Synthetic", description: "", private: true };
  for (const reason of ["disabled", "aria", "hidden", "wrong-tag"] as const) {
    const page = fixture(true);
    const button = page.form.selectors["button"]![0]!;
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.deepEqual(prepareBlooketCreateSetForm(input), { ok: true });
      if (reason === "disabled") button.disabled = true;
      if (reason === "aria") button.attributes["aria-disabled"] = "true";
      if (reason === "hidden")
        button.getBoundingClientRect = () => ({ width: 0, height: 0 });
      if (reason === "wrong-tag") button.tagName = "DIV";
      assert.equal(submitBlooketCreateSetForm(input).ok, false);
      assert.equal(button.clicked, 0);
    });
  }
});

test("success observation accepts only one exact edit ID", () => {
  const document = node("DOCUMENT");
  for (const [href, expected] of [
    [
      "https://dashboard.blooket.com/edit?id=opaque%2Fset%3Fid",
      { ok: true, remoteSetId: "opaque/set?id" },
    ],
    [
      "https://dashboard.blooket.com/edit?id=one&id=two",
      { ok: false, code: "blooket-browser-failed" },
    ],
    [
      "https://dashboard.blooket.com/create?id=fixture",
      { ok: false, code: "blooket-browser-failed" },
    ],
    [
      "https://example.invalid/edit?id=fixture",
      { ok: false, code: "blooket-browser-failed" },
    ],
  ] as const) {
    withPage(document, href, () => {
      assert.deepEqual(observeBlooketCreateSetSuccess(), expected);
    });
  }
});

test(
  "Create Set rejects ambiguous form and unscoped form controls",
  () => {
  const page = fixture(true);
  const expected = { title: "Synthetic set", description: "", private: true };
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    page.document.selectors["form#question-set-form"] = [
      page.form, node("FORM"),
    ];
    assert.equal(prepareBlooketCreateSetForm(expected).ok, false);
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
    page.document.selectors["form#question-set-form"] = [page.form];
    // The global input may be from an obsolete or unrelated form.
    page.form.selectors['input#title[name="title"]'] = [];
    assert.equal(prepareBlooketCreateSetForm(expected).ok, false);
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
    page.form.selectors['input#title[name="title"]'] = [
      page.title, node("INPUT"),
    ];
    assert.equal(prepareBlooketCreateSetForm(expected).ok, false);
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
  });
  },
);


test("an edit redirect behind a security interstitial is not a receipt", () => {
  const document = Object.assign(node("DOCUMENT"), {
    title: "Just a moment...",
  });
  withPage(document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
    assert.deepEqual(observeBlooketCreateSetSuccess(), {
      ok: false, code: "blooket-browser-failed",
    });
  });
});

test("an edit redirect behind a password prompt is not a receipt", () => {
  const document = node("DOCUMENT");
  document.selectors['input[type="password"]'] = [node("INPUT")];
  withPage(document,
    "https://dashboard.blooket.com/edit?id=set-fixture", () => {
    assert.deepEqual(observeBlooketCreateSetSuccess(), {
      ok: false, code: "blooket-browser-failed",
    });
  });
});


test("human overlays block Create Set preparation and submission", () => {
  const input = { title: "Synthetic", description: "", private: true };
  for (const reason of ["verification", "password", "organization",
    "captcha"] as const) {
    const page = fixture(true);
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.deepEqual(prepareBlooketCreateSetForm(input), { ok: true });
      if (reason === "verification")
        Object.assign(page.document, { title: "Just a moment..." });
      if (reason === "password")
        page.document.selectors['input[type="password"]'] = [node("INPUT")];
      if (reason === "organization")
        page.document.selectors['[role="dialog"][aria-modal="true"] h3'] = [
          node("H3", "Select your organization"),
        ];
      if (reason === "captcha")
        page.document.selectors[
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
        ] = [node("IFRAME")];
      assert.equal(submitBlooketCreateSetForm(input).ok, false);
      assert.equal(page.form.selectors["button"]?.[0]?.clicked, 0);
      assert.equal(prepareBlooketCreateSetForm(input).ok, false);
    });
  }
});


test("stale Create Set controls cannot replace an authenticated shell", () => {
  const input = { title: "Synthetic", description: "", private: true };
  for (const missing of ["main", "navigation", "logout"] as const) {
    const page = fixture(true);
    const selector = missing === "main" ? "main" : missing === "navigation"
      ? 'nav a[href="/my-sets"]'
      : 'a[href="https://id.blooket.com/logout"]';
    page.document.selectors[selector] = [];
    page.title.value = input.title;
    page.description.value = input.description;
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.equal(prepareBlooketCreateSetForm(input).ok, false);
      assert.equal(submitBlooketCreateSetForm(input).ok, false);
      assert.equal(page.form.selectors["button"]?.[0]?.clicked, 0);
    });
  }
});

test("closed account menu permits the observed Create Set form", () => {
  const page = fixture(true);
  const logout = page.document.selectors[
    'a[href="https://id.blooket.com/logout"]'
  ]![0]!;
  logout.getBoundingClientRect = () => ({ width: 0, height: 0 });
  page.document.selectors['a[href="https://id.blooket.com/login"]'] = [
    node("A", "Account"),
  ];
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    assert.deepEqual(prepareBlooketCreateSetForm({
      title: "Synthetic", description: "", private: true,
    }), { ok: true });
  });
});

test("Create Set redirects reject new organization and CAPTCHA prompts", () => {
  for (const kind of ["organization", "captcha"] as const) {
    const document = node("DOCUMENT");
    if (kind === "organization")
      document.selectors['[role="dialog"][aria-modal="true"] h3'] = [
        node("H3", "Select your organization"),
      ];
    if (kind === "captcha")
      document.selectors[
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
      ] = [node("IFRAME")];
    withPage(document,
      "https://dashboard.blooket.com/edit?id=set-fixture", () => {
      assert.deepEqual(observeBlooketCreateSetSuccess(), {
        ok: false, code: "blooket-browser-failed",
      });
    });
  }
});

test("Create Set owner watch refuses human edits and overlapping claims",
  () => {
  const page = fixture(true);
  const form = page.form as FixtureNode & { isConnected: boolean };
  form.isConnected = true;
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
  let mutation = () => {};
  class Observer {
    constructor(callback: () => void) { mutation = callback; }
    observe() {}
    disconnect() {}
  }
  const before = Object.getOwnPropertyDescriptor(globalThis,
    "MutationObserver");
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true, value: Observer,
  });
  try {
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      const serialized = Function("return (" +
        runBlooketCreateSetOwnership.toString() + ")",
      )() as typeof runBlooketCreateSetOwnership;
      assert.equal(serialized("check"), false);
      assert.equal(serialized("claim"), true);
      assert.equal(serialized("claim"), false);
      assert.equal(serialized("check"), true);
      assert.deepEqual(prepareBlooketCreateSetForm({
        title: "Synthetic", description: "", private: true,
      }), { ok: true });
      // Script-generated input events have no trusted browser gesture.
      assert.equal(serialized("check"), true);
      for (const listener of listeners) listener({ isTrusted: true });
      assert.equal(serialized("check"), false);
      assert.equal(serialized("claim"), false);
      form.isConnected = false;
      mutation();
      assert.equal(Object.hasOwn(globalThis, "__blooketCreateSetWatch"),
        false);
      assert.equal(listeners.size, 0);
      assert.equal(serialized("check"), false);
    }, false);
  } finally {
    const world = globalThis as typeof globalThis & {
      __blooketCreateSetWatch?: { dispose: () => void };
    };
    world.__blooketCreateSetWatch?.dispose();
    if (before)
      Object.defineProperty(globalThis, "MutationObserver", before);
    else Reflect.deleteProperty(globalThis, "MutationObserver");
  }
  },
);

test("Create Set watch refuses stale and ambiguous forms", () => {
  const page = fixture(true);
  const form = page.form as FixtureNode & { isConnected: boolean };
  form.isConnected = true;
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    page.document.selectors["form#question-set-form"] = [form, form];
    assert.equal(runBlooketCreateSetOwnership("claim"), false);
    page.document.selectors["form#question-set-form"] = [form];
    page.document.selectors['input[type="password"]'] = [node("INPUT")];
    assert.equal(runBlooketCreateSetOwnership("claim"), false);
    page.document.selectors['input[type="password"]'] = [];
    page.document.selectors['[role="dialog"][aria-modal="true"]'] = [
      node("DIV"),
    ];
    assert.equal(runBlooketCreateSetOwnership("claim"), false);
  });
});

test("Create Set fills and submits only while its form watch still owns work",
  () => {
  const expected = { title: "Synthetic", description: "Draft", private: true };
  for (const state of ["dirty", "lost", "foreign", "detached"] as const) {
    const page = fixture(true);
    const submit = page.form.selectors["button"]![0]!;
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      const world = globalThis as typeof globalThis & {
        __blooketCreateSetWatch?: {
          document: unknown; form: unknown; dirty: boolean;
        };
      };
      const watch = world.__blooketCreateSetWatch!;
      if (state === "dirty") watch.dirty = true;
      if (state === "lost")
        Reflect.deleteProperty(globalThis, "__blooketCreateSetWatch");
      if (state === "foreign") watch.form = node("FORM");
      if (state === "detached")
        (page.form as FixtureNode & { isConnected: boolean })
          .isConnected = false;
      assert.deepEqual(prepareBlooketCreateSetForm(expected), {
        ok: false, code: "blooket-browser-failed",
      });
      assert.equal(submitBlooketCreateSetForm(expected).ok, false);
      assert.equal(page.title.value, "");
      assert.equal(page.description.value, "");
      assert.equal(submit.clicked, 0);
    });
  }
  const page = fixture(true);
  const submit = page.form.selectors["button"]![0]!;
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    const world = globalThis as typeof globalThis & {
      __blooketCreateSetWatch?: { dirty: boolean };
    };
    assert.deepEqual(prepareBlooketCreateSetForm(expected), { ok: true });
    world.__blooketCreateSetWatch!.dirty = true;
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
    assert.equal(submit.clicked, 0);
  });
  },
);

test("Create Set claim releases partial listeners when observation fails",
  () => {
  const page = fixture(true);
  Object.assign(page.form, { isConnected: true });
  const listeners = new Set<unknown>();
  const doc = page.document as FixtureNode & {
    addEventListener: (type: string, callback: unknown) => void;
    removeEventListener: (type: string, callback: unknown) => void;
  };
  doc.addEventListener = (_type, callback) => { listeners.add(callback); };
  doc.removeEventListener = (_type, callback) => {
    listeners.delete(callback);
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis,
    "MutationObserver");
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: class { constructor() { throw new Error("synthetic-observer"); } },
  });
  try {
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.equal(runBlooketCreateSetOwnership("claim"), false);
      assert.equal(listeners.size, 0);
      assert.equal(Object.hasOwn(globalThis, "__blooketCreateSetWatch"),
        false);
    }, false);
  } finally {
    if (previous)
      Object.defineProperty(globalThis, "MutationObserver", previous);
    else Reflect.deleteProperty(globalThis, "MutationObserver");
  }
  },
);
