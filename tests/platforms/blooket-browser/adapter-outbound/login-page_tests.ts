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
//   - Synthetic regression coverage for the exact public Blooket login form.
// - Must-Not:
//   - Contact Blooket, persist credentials, or claim authentication success.
// - Allows:
//   - Inputs: Synthetic login controls and bounded fixture credentials.
//   - Outputs: Preparation, revalidation, challenge, and one-submit assertions.
//   - Side effects: Synthetic input events and button clicks only.
// - Split-When:
//   - Another login method needs independent DOM mechanics.
// - Merge-When:
//   - Browser login no longer needs a page-level adapter.
// - Summary:
//   - Proves login secrets never cross back out of the page helper.
// - Description:
//   - Mirrors the public 2026-10-07 login labels without private account data.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Foreign routes, ambiguity, and visible challenges fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  isBlooketLoginFormPrepared,
  prepareBlooketLoginForm,
  runBlooketLoginPageAction,
  submitBlooketLoginForm,
} from
  "../../../../src/platforms/blooket-browser/adapter-outbound/login-page.ts";

interface FixtureNode {
  tagName: string;
  textContent: string;
  value: string;
  disabled: boolean;
  clicked: number;
  selectors: Record<string, FixtureNode[]>;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): FixtureNode[];
  getBoundingClientRect(): { width: number; height: number };
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
    disabled: false,
    clicked: 0,
    selectors: {},
    getAttribute: (name) => attributes[name] ?? null,
    querySelectorAll(selector) {
      return this.selectors[selector] ?? [];
    },
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    dispatchEvent: () => true,
    click() {
      this.clicked++;
    },
  };
}

function fixture() {
  const document = node("DOCUMENT");
  const heading = node("H1", "Log in");
  const identifier = node("INPUT");
  const password = node("INPUT");
  const submit = node("BUTTON", "Let's go!");
  document.selectors["h1, h2, h3"] = [heading];
  document.selectors['input[placeholder="Username or email"]'] = [identifier];
  document.selectors[
    'input[type="password"][placeholder="Password"]'
  ] = [password];
  document.selectors["button"] = [submit];
  return { document, heading, identifier, password, submit };
}

function withPage(
  document: FixtureNode,
  href: string,
  run: () => void,
): void {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["document", "location", "HTMLInputElement", "Event"])
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

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
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

const credentials = {
  loginIdentifier: "teacher@example.test",
  password: "synthetic-password",
};

test("serialized login runner preserves injected-browser semantics", () => {
  const page = fixture();
  const serialized = Function(
    "return (" + runBlooketLoginPageAction.toString() + ")",
  )() as typeof runBlooketLoginPageAction;
  withPage(page.document, "https://id.blooket.com/login", () => {
    assert.deepEqual(serialized("prepare", credentials), { ok: true });
    assert.equal(serialized("is-prepared", credentials), true);
    assert.deepEqual(serialized("submit", credentials), { ok: true });
    assert.equal(page.submit.clicked, 1);
  });
});

test("unknown serialized login actions never submit", () => {
  const page = fixture();
  const serialized = Function(
    "return (" + runBlooketLoginPageAction.toString() + ")",
  )() as typeof runBlooketLoginPageAction;
  withPage(page.document, "https://id.blooket.com/login", () => {
    assert.deepEqual(serialized("prepare", credentials), { ok: true });
    assert.deepEqual(serialized("unknown" as never, credentials), {
      ok: false,
      code: "blooket-browser-failed",
    });
    assert.equal(page.submit.clicked, 0);
  });
});

test("login preparation fills exact controls without submitting", () => {
  const page = fixture();
  withPage(page.document, "https://id.blooket.com/login", () => {
    assert.deepEqual(prepareBlooketLoginForm(credentials), { ok: true });
    assert.equal(page.identifier.value, credentials.loginIdentifier);
    assert.equal(page.password.value, credentials.password);
    assert.equal(page.submit.clicked, 0);
    assert.equal(isBlooketLoginFormPrepared(credentials), true);
    assert.equal(
      JSON.stringify(prepareBlooketLoginForm(credentials)),
      '{"ok":true}',
    );
  });
});

test("login submit revalidates values and clicks exactly once", () => {
  const page = fixture();
  withPage(page.document, "https://id.blooket.com/login", () => {
    assert.deepEqual(prepareBlooketLoginForm(credentials), { ok: true });
    assert.deepEqual(submitBlooketLoginForm(credentials), { ok: true });
    assert.equal(page.submit.clicked, 1);
    page.password.value = "changed-after-preparation";
    assert.equal(submitBlooketLoginForm(credentials).ok, false);
    assert.equal(page.submit.clicked, 1);
  });
});

test("normal invisible reCAPTCHA does not block the login form", () => {
  const page = fixture();
  page.document.selectors[
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
  ] = [
    node("IFRAME", "", {
      src: "https://www.google.com/recaptcha/api2/anchor?size=invisible",
    }),
  ];
  withPage(page.document, "https://id.blooket.com/login", () => {
    assert.deepEqual(prepareBlooketLoginForm(credentials), { ok: true });
    assert.equal(isBlooketLoginFormPrepared(credentials), true);
  });
});

test("a challenge appearing after preparation blocks the submit", () => {
  const page = fixture();
  withPage(page.document, "https://id.blooket.com/login", () => {
    assert.deepEqual(prepareBlooketLoginForm(credentials), { ok: true });
    page.document.selectors[
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
    ] = [node("IFRAME", "", {
      src: "https://www.google.com/recaptcha/api2/bframe?k=fixture",
    })];
    assert.equal(submitBlooketLoginForm(credentials).ok, false);
    assert.equal(page.submit.clicked, 0);
  });
});

test("login refuses foreign ambiguous challenged and disabled surfaces", () => {
  const page = fixture();
  withPage(page.document, "https://example.invalid/login", () => {
    assert.equal(prepareBlooketLoginForm(credentials).ok, false);
  });
  page.document.selectors["h1, h2, h3"]?.push(node("H2", "Log in"));
  withPage(page.document, "https://id.blooket.com/login", () => {
    assert.equal(prepareBlooketLoginForm(credentials).ok, false);
  });
  page.document.selectors["h1, h2, h3"] = [page.heading];
  page.document.selectors[
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
  ] = [node("IFRAME")];
  withPage(page.document, "https://id.blooket.com/login", () => {
    assert.equal(prepareBlooketLoginForm(credentials).ok, false);
  });
  page.document.selectors[
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
  ] = [];
  page.submit.disabled = true;
  withPage(page.document, "https://id.blooket.com/login", () => {
    assert.deepEqual(prepareBlooketLoginForm(credentials), { ok: true });
    assert.equal(isBlooketLoginFormPrepared(credentials), false);
    assert.equal(submitBlooketLoginForm(credentials).ok, false);
    assert.equal(page.submit.clicked, 0);
  });
});
