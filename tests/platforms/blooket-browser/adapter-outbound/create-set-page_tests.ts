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
  parentElement?: FixtureNode;
  clicked: number;
  visibility: string;
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
    "getComputedStyle",
    "__blooketCreateSetWatch",
  ])
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

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
  if (withSyntheticOwner && new URL(href).pathname === "/create") {
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
  const row = node("DIV");
  const toggleLabel = node("LABEL", "Toggle");
  toggleLabel.parentElement = row;
  const privacyState = node("P", privateSet
    ? "Private (Only playable by you)"
    : "Public (Playable by everyone)");
  row.selectors[":scope > p"] = [privacyState];
  privacy.labels = [toggleLabel];
  const oldClick = privacy.click.bind(privacy);
  privacy.click = () => {
    oldClick();
    privacyState.textContent = privacy.attributes["aria-checked"] === "true"
      ? "Public (Playable by everyone)"
      : "Private (Only playable by you)";
  };
  form.selectors["button"] = [node("BUTTON", "Create Set")];
  form.selectors['input#title[name="title"]'] = [title];
  form.selectors['textarea#desc[name="desc"]'] = [description];
  form.selectors['input#private[name="private"]'] = [privacy];
  document.selectors["form#question-set-form"] = [form];
  document.selectors['input#title[name="title"]'] = [title];
  document.selectors['textarea#desc[name="desc"]'] = [description];
  document.selectors['input#private[name="private"]'] = [privacy];
  return { document, form, title, description, privacy, privacyState,
    privacyRow: row };
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
    page.privacyState.textContent = "Public (Playable by everyone)";
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
    assert.equal(submit.clicked, 0);

    page.privacy.attributes["aria-checked"] = "false";
    page.privacyState.textContent = "Private (Only playable by you)";
    page.form.selectors["button"]?.push(node("BUTTON", "Create Set"));
    assert.equal(submitBlooketCreateSetForm(expected).ok, false);
    assert.equal(submit.clicked, 0);
  });
});

test("hidden or disabled Create Set buttons cannot be clicked", () => {
  const input = { title: "Synthetic", description: "", private: true };
  for (const reason of ["disabled", "aria", "hidden", "css-hidden",
    "wrong-tag"] as const) {
    const page = fixture(true);
    const button = page.form.selectors["button"]![0]!;
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.deepEqual(prepareBlooketCreateSetForm(input), { ok: true });
      if (reason === "disabled") button.disabled = true;
      if (reason === "aria") button.attributes["aria-disabled"] = "true";
      if (reason === "hidden")
        button.getBoundingClientRect = () => ({ width: 0, height: 0 });
      if (reason === "css-hidden") button.visibility = "hidden";
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
      "https://dashboard.blooket.com/edit?id=one&filter=private",
      { ok: false, code: "blooket-browser-failed" },
    ],
    [
      "https://dashboard.blooket.com/edit?id=one#teacher",
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
      const click = page.privacy.click.bind(page.privacy);
      page.privacy.click = () => {
        click();
        for (const type of ["input", "change"]) {
          for (const listener of listeners) listener({
            isTrusted: true, type, target: page.privacy,
          } as { isTrusted: boolean });
        }
      };
      assert.deepEqual(prepareBlooketCreateSetForm({
        title: "Synthetic", description: "", private: false,
      }), { ok: true });
      assert.equal(serialized("check"), true);
      // The same trusted checkbox event after click returns is a human edit.
      for (const listener of listeners) listener({
        isTrusted: true, type: "change", target: page.privacy,
      } as { isTrusted: boolean });
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
    const dialog = page.document.selectors[
      '[role="dialog"][aria-modal="true"]'
    ]![0]!;
    dialog.visibility = "hidden";
    assert.equal(runBlooketCreateSetOwnership("check"), true);
    dialog.visibility = "visible";
    assert.equal(runBlooketCreateSetOwnership("check"), false);
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

test("Create Set reads privacy from the observed sibling paragraph",
  () => {
  for (const privateSet of [true, false]) {
    const page = fixture(privateSet);
    const expected = { title: "Synthetic", description: "",
      private: privateSet };
    // The toggle's accessible label does not contain the provider state.
    assert.equal(page.privacy.labels[0]?.textContent, "Toggle");
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.deepEqual(prepareBlooketCreateSetForm(expected), { ok: true });
      assert.deepEqual(submitBlooketCreateSetForm(expected), { ok: true });
      assert.equal(page.form.selectors["button"]?.[0]?.clicked, 1);
    });
  }
  },
);

test("a switched Create Set privacy must agree before the Save click",
  () => {
  const page = fixture(false);
  const expected = { title: "Synthetic", description: "", private: true };
  withPage(page.document, "https://dashboard.blooket.com/create", () => {
    assert.deepEqual(prepareBlooketCreateSetForm(expected), { ok: true });
    assert.equal(page.privacy.clicked, 1);
    assert.equal(page.privacyState.textContent,
      "Private (Only playable by you)");
    assert.deepEqual(submitBlooketCreateSetForm(expected), { ok: true });
    assert.equal(page.form.selectors["button"]?.[0]?.clicked, 1);
  });
  },
);

test("Create Set refuses hidden ambiguous or inconsistent privacy rows",
  () => {
  const expected = { title: "Synthetic", description: "", private: true };
  for (const mutate of [
    (page: ReturnType<typeof fixture>) => {
      page.privacyState.textContent = "Public (Playable by everyone)";
    },
    (page: ReturnType<typeof fixture>) => {
      page.privacyState.getBoundingClientRect = () => ({ width: 0,
        height: 0 });
    },
    (page: ReturnType<typeof fixture>) => {
      page.privacyRow.selectors[":scope > p"] = [
        page.privacyState, node("P", "Private (Only playable by you)"),
      ];
    },
    (page: ReturnType<typeof fixture>) => {
      const another = node("DIV");
      another.selectors[":scope > p"] = [
        node("P", "Private (Only playable by you)"),
      ];
      const label = node("LABEL", "Toggle");
      label.parentElement = another;
      page.privacy.labels.push(label);
    },
    (page: ReturnType<typeof fixture>) => {
      page.privacyRow.getBoundingClientRect = () => ({ width: 0,
        height: 0 });
    },
    (page: ReturnType<typeof fixture>) => {
      page.privacyState.visibility = "hidden";
    },
    (page: ReturnType<typeof fixture>) => {
      page.privacyRow.visibility = "hidden";
    },
  ]) {
    const page = fixture(true);
    mutate(page);
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.equal(prepareBlooketCreateSetForm(expected).ok, false);
      assert.equal(submitBlooketCreateSetForm(expected).ok, false);
      assert.equal(page.form.selectors["button"]?.[0]?.clicked, 0);
    });
  }
  },
);


test("Create Set refuses query and fragment variants at every write step",
  () => {
  const expected = { title: "Synthetic", description: "", private: true };
  for (const suffix of ["?source=teacher", "#teacher-editor"]) {
    const page = fixture(true);
    withPage(page.document,
      "https://dashboard.blooket.com/create" + suffix, () => {
        assert.equal(runBlooketCreateSetOwnership("claim"), false);
        assert.equal(prepareBlooketCreateSetForm(expected).ok, false);
        page.title.value = expected.title;
        assert.equal(submitBlooketCreateSetForm(expected).ok, false);
        assert.equal(page.form.selectors["button"]![0]!.clicked, 0);
      });
  }
  },
);

test("Create Set form refuses CSS-hidden inputs and Save before mutation",
  () => {
  const expected = { title: "Synthetic", description: "", private: true };
  for (const target of ["form", "title", "description", "privacy",
    "submit", "main", "navigation"] as const) {
    const page = fixture(true);
    const element = target === "form" ? page.form :
      target === "title" ? page.title :
        target === "description" ? page.description :
          target === "privacy" ? page.privacy :
            target === "submit" ? page.form.selectors["button"]![0]! :
              target === "main" ? page.document.selectors["main"]![0]! :
                page.document.selectors['nav a[href="/my-sets"]']![0]!;
    element.visibility = "hidden";
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.equal(prepareBlooketCreateSetForm(expected).ok, false);
      assert.equal(page.title.value, "");
      assert.equal(page.description.value, "");
      assert.equal(submitBlooketCreateSetForm(expected).ok, false);
      assert.equal(page.form.selectors["button"]![0]!.clicked, 0);
    });
  }
  },
);


test("Create Set title events must retain exact controls before description",
  () => {
  const input = { title: "Synthetic", description: "Review", private: false };
  const variants = ["form", "title", "challenge", "privacy", "hidden",
    "sidebar"] as const;
  for (const variant of variants) {
    const page = fixture(true);
    page.title.dispatchEvent = (event) => {
      if (event.type !== "input") return true;
      if (variant === "form")
        page.document.selectors["form#question-set-form"] = [node("FORM")];
      if (variant === "title")
        page.form.selectors['input#title[name="title"]'] = [node("INPUT")];
      if (variant === "challenge")
        page.document.selectors[
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
        ] = [node("IFRAME")];
      if (variant === "privacy") {
        page.privacy.attributes["aria-checked"] = "true";
        page.privacyState.textContent = "Public (Playable by everyone)";
      }
      if (variant === "hidden") page.description.visibility = "hidden";
      if (variant === "sidebar")
        page.document.selectors['nav a[href="/my-sets"]'] = [];
      return true;
    };
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.equal(prepareBlooketCreateSetForm(input).ok, false, variant);
      assert.equal(page.description.value, "", variant);
      assert.equal(page.privacy.clicked, 0, variant);
      assert.equal(page.form.selectors["button"]![0]!.clicked, 0);
    });
  }
  },
);

test("Create Set description events cannot use changed privacy controls",
  () => {
  const input = { title: "Synthetic", description: "Review", private: false };
  for (const variant of ["privacy", "challenge", "row"] as const) {
    const page = fixture(true);
    page.description.dispatchEvent = event => {
      if (event.type !== "change") return true;
      if (variant === "privacy") {
        page.privacy.attributes["aria-checked"] = "true";
        page.privacyState.textContent = "Public (Playable by everyone)";
      }
      if (variant === "challenge")
        page.document.selectors[
          '[role="dialog"][aria-modal="true"] h3'
        ] = [node("H3", "Select your organization")];
      if (variant === "row")
        page.privacy.labels = [node("LABEL")];
      return true;
    };
    withPage(page.document, "https://dashboard.blooket.com/create", () => {
      assert.equal(prepareBlooketCreateSetForm(input).ok, false, variant);
      assert.equal(page.privacy.clicked, 0, variant);
      assert.equal(page.form.selectors["button"]![0]!.clicked, 0);
    });
  }
  },
);
