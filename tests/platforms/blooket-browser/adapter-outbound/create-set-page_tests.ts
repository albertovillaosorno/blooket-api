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
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/blooket-browser/adapter-outbound/create-set-page.ts";

interface FixtureNode {
  tagName: string;
  textContent: string;
  value: string;
  labels: FixtureNode[];
  clicked: number;
  selectors: Record<string, FixtureNode[]>;
  attributes: Record<string, string>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FixtureNode | null;
  querySelectorAll(selector: string): FixtureNode[];
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
    labels: [],
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
): void {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const key of [
    "document",
    "location",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Event",
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
