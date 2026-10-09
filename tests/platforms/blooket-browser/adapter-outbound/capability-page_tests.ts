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
//   - Synthetic regressions for account capability page controls.
// - Must-Not:
//   - Contact Blooket, submit forms, or upload media.
// - Allows:
//   - Inputs: Synthetic edit-page Add Question and audio drawer DOM.
//   - Outputs: Exact Plus-gate and cleanup assertions.
//   - Side effects: Synthetic open/cancel clicks only.
// - Split-When:
//   - Another account capability requires different controls.
// - Merge-When:
//   - Capability probing no longer uses browser page controls.
// - Summary:
//   - Proves the shared answer-image/audio account gate without saving.
// - Description:
//   - Mirrors recovered modules 89770 and 72398 accessible controls.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Ambiguous drawers, routes, and controls fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  blooketCapabilitySnapshotCandidate,
  canLeaveBlooketPageForRead,
  closeBlooketAudioCapabilityDrawer,
  closeBlooketCapabilityQuestionPanel,
  inspectBlooketAudioCapabilityDrawer,
  isBlooketAudioCapabilityDrawerClosed,
  isBlooketCapabilityQuestionPanelClosed,
  isBlooketCapabilityQuestionPanelReady,
  openBlooketAudioCapabilityDrawer,
  openBlooketCapabilityQuestionPanel,
} from
// jig-ignore-next-line: Static import path cannot be wrapped safely.
  "../../../../src/platforms/blooket-browser/adapter-outbound/capability-page.ts";
import { decodeBlooketCapabilitySnapshot } from
  "../../../../src/ir/capability-snapshots/contract/blooket-capabilities.ts";

interface FixtureNode {
  tagName: string;
  textContent: string;
  value: string;
  parent?: FixtureNode;
  parentElement?: FixtureNode;
  clicked: number;
  selectors: Record<string, FixtureNode[]>;
  attributes: Record<string, string>;
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
    value: "",
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
    click() {
      this.clicked++;
    },
  };
}

function fixture() {
  const document = node("DOCUMENT");
  const add = node("BUTTON", "Add Question");
  document.selectors["button"] = [add];
  const form = node("FORM");
  const question = node("INPUT", "", {
    id: "question",
    name: "question",
    type: "hidden",
  });
  question.parent = form;
  const setId = node("INPUT", "", {
    id: "setId", name: "setId", type: "hidden",
  });
  setId.value = "set-fixture";
  setId.parent = form;
  const audio = node("BUTTON", " Audio ", { type: "button" });
  audio.parent = form;
  const cancel = node("BUTTON", "Cancel", { type: "button" });
  cancel.parent = form;
  form.selectors['input#setId[name="setId"]'] = [setId];
  form.selectors["button"] = [audio, cancel];
  form.selectors['button[type="button"]'] = [audio, cancel];
  return { document, add, form, question, setId, audio, cancel };
}

function drawer(kind: "supported" | "unsupported") {
  const item = node(
    "ASIDE",
    kind === "supported"
      ? "Question 3 Audio Drag and drop an audio file here"
      : "Upgrade to Plus Add audio to your questions and unlock many other " +
        "premium features with Blooket Plus.",
    { "data-drawer-open": "true" },
  );
  item.selectors["span"] = [
    node("SPAN", kind === "supported" ? "Question 3 Audio" : "Upgrade to Plus"),
  ];
  item.selectors['input[type="file"][accept="audio/*"]'] =
    kind === "supported"
      ? [node("INPUT", "", { type: "file", accept: "audio/*" })]
      : [];
  item.selectors['button[aria-label="Cancel"]'] = [
    node("BUTTON", "Cancel", { "aria-label": "Cancel" }),
  ];
  return item;
}

function withPage(document: FixtureNode, run: () => void): void {
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
    value: new URL("https://dashboard.blooket.com/edit?id=set-fixture"),
  });
  try {
    run();
  } finally {
    const world = globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; dispose: () => void
      };
    };
    if (world.__blooketCapabilityEditWatch?.document === document)
      world.__blooketCapabilityEditWatch.dispose();
    if (priorDocument)
      Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (priorLocation)
      Object.defineProperty(globalThis, "location", priorLocation);
    else Reflect.deleteProperty(globalThis, "location");
  }
}

test("capability navigation leaves all teacher-owned editors untouched", () => {
  const page = fixture();
  const injected = Function(
    "return (" + canLeaveBlooketPageForRead.toString() + ")",
  )() as typeof canLeaveBlooketPageForRead;
  withPage(page.document, () => {
    assert.equal(injected(), true);
    // A blank, unfocused Create Set page is still an unowned draft.
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://dashboard.blooket.com/create"),
    });
    assert.equal(injected(), false);
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://dashboard.blooket.com/edit?id=set-fixture"),
    });
    const draft = node("INPUT");
    draft.getBoundingClientRect = () => ({ width: 0, height: 0 });
    const selector =
      'form#question-set-form input#title[name="title"], ' +
      'form#question-set-form textarea#desc[name="desc"]';
    page.document.selectors[selector] = [draft];
    assert.equal(injected(), true); // Closed Edit Info remains in the DOM.
    draft.getBoundingClientRect = () => ({ width: 30, height: 20 });
    assert.equal(injected(), false);
    draft.getBoundingClientRect = () => ({ width: 0, height: 0 });
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    assert.equal(injected(), false);
    page.document.selectors['input#question[name="question"]'] = [];
    page.document.selectors['aside[data-drawer-open="true"]'] = [
      drawer("supported"),
    ];
    assert.equal(injected(), false);
    page.document.selectors['aside[data-drawer-open="true"]'] = [];
    page.document.selectors[
      '[role="dialog"][aria-modal="true"]'
    ] = [node("DIV")];
    assert.equal(injected(), false);
    page.document.selectors[
      '[role="dialog"][aria-modal="true"]'
    ] = [];
    (page.document as FixtureNode & { activeElement?: FixtureNode })
      .activeElement = node("TEXTAREA");
    assert.equal(injected(), false);
    (page.document as FixtureNode & { activeElement?: FixtureNode })
      .activeElement = undefined;
    assert.equal(injected(), true);
    page.document.selectors['input[type="password"]'] = [node("INPUT")];
    assert.equal(injected(), false);
    page.document.selectors['input[type="password"]'] = [];
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://dashboard.blooket.com/unknown-route"),
    });
    assert.equal(injected(), false);
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://dashboard.blooket.com/edit?id=set-fixture"),
    });
    (page.document as FixtureNode & { title?: string }).title =
      "Just a moment...";
    assert.equal(injected(), false);
  });
});

test("capability probe opens only the exact Add Question form", () => {
  const page = fixture();
  withPage(page.document, () => {
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), true);
    assert.equal(page.add.clicked, 1);
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    assert.equal(isBlooketCapabilityQuestionPanelReady("set-fixture"), true);
    assert.equal(isBlooketCapabilityQuestionPanelReady("other"), false);
  });
});

test("audio drawer distinguishes the shared Plus gate and cancels", () => {
  for (const kind of ["supported", "unsupported"] as const) {
    const page = fixture();
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    const openDrawer = drawer(kind);
    page.document.selectors['input#question[name="question"]'] = [];
    withPage(page.document, () => {
      assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), true);
      page.document.selectors['input#question[name="question"]'] = [
        page.question,
      ];
      assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), true);
      assert.equal(page.audio.clicked, 1);
      page.document.selectors['aside[data-drawer-open="true"]'] = [openDrawer];
      assert.deepEqual(inspectBlooketAudioCapabilityDrawer("set-fixture"), {
        ok: true,
        value: kind,
      });
      assert.equal(closeBlooketAudioCapabilityDrawer("set-fixture"), true);
      assert.equal(
        openDrawer.selectors['button[aria-label="Cancel"]']?.[0]?.clicked,
        1,
      );
      page.document.selectors['aside[data-drawer-open="true"]'] = [];
      assert.equal(isBlooketAudioCapabilityDrawerClosed("set-fixture"), true);
      assert.equal(closeBlooketCapabilityQuestionPanel("set-fixture"), true);
      assert.equal(page.cancel.clicked, 1);
      page.document.selectors['input#question[name="question"]'] = [];
      assert.equal(isBlooketCapabilityQuestionPanelClosed("set-fixture"), true);
    });
  }
});

test("capability controls refuse control-bearing set IDs", () => {
  const page = fixture();
  withPage(page.document, () => {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://dashboard.blooket.com/edit?id=x%0Ay"),
    });
    assert.equal(openBlooketCapabilityQuestionPanel("x\ny"), false);
    assert.equal(page.add.clicked, 0);
  });
});

test("ambiguous capability controls fail without clicking", () => {
  const page = fixture();
  withPage(page.document, () => {
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), true);
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    page.form.selectors["button"] = [
      page.audio,
      node("BUTTON", "Audio", { type: "button" }),
      page.cancel,
    ];
    assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), false);
    assert.equal(page.audio.clicked, 0);
    page.document.selectors['aside[data-drawer-open="true"]'] = [
      drawer("supported"),
      drawer("unsupported"),
    ];
    assert.equal(inspectBlooketAudioCapabilityDrawer("set-fixture").ok, false);
    assert.equal(closeBlooketCapabilityQuestionPanel("set-fixture"), false);
  });
});

test("capability snapshot resolves only the shared account media gate", () => {
  for (const state of [
    "supported",
    "unsupported",
    "account-dependent",
  ] as const) {
    const decoded = decodeBlooketCapabilitySnapshot(
      blooketCapabilitySnapshotCandidate("2026-10-07", state),
    );
    assert.equal(decoded.ok, true);
    if (decoded.ok) {
      assert.equal(decoded.value.features.answerImages, state);
      assert.equal(decoded.value.features.audio, state);
      assert.equal(decoded.value.features.questionImages, "supported");
      assert.equal(decoded.value.upload.maxBytes, 2_500_000);
      assert.equal(
        decoded.value.evidence.some(
          (item) =>
            item.reference === "authenticated Add Question audio Plus gate",
        ),
        state !== "account-dependent",
      );
    }
  }
});

test("capability drawer never trusts a stale question-form set ID", () => {
  const page = fixture();
  const openDrawer = drawer("supported");
  withPage(page.document, () => {
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), true);
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    page.document.selectors['aside[data-drawer-open="true"]'] = [openDrawer];
    page.setId.value = "another-set";
    assert.equal(isBlooketCapabilityQuestionPanelReady("set-fixture"), false);
    assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), false);
    assert.equal(inspectBlooketAudioCapabilityDrawer("set-fixture").ok, false);
    assert.equal(closeBlooketAudioCapabilityDrawer("set-fixture"), false);
    assert.equal(isBlooketAudioCapabilityDrawerClosed("set-fixture"), false);
    page.document.selectors['aside[data-drawer-open="true"]'] = [];
    assert.equal(closeBlooketCapabilityQuestionPanel("set-fixture"), false);
    assert.equal(page.audio.clicked, 0);
    assert.equal(page.cancel.clicked, 0);
    assert.equal(openDrawer.selectors[
      'button[aria-label="Cancel"]'
    ]?.[0]?.clicked, 0);
  });
});

test(
  "capability controls refuse malformed and duplicate form identities",
  () => {
  const page = fixture();
  const existingDrawer = drawer("unsupported");
  withPage(page.document, () => {
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), true);
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    for (const identities of [
      [],
      [page.setId, page.setId],
      [node("INPUT", "", { type: "text" })],
    ]) {
      page.form.selectors['input#setId[name="setId"]'] = identities;
      assert.equal(isBlooketCapabilityQuestionPanelReady("set-fixture"), false);
      assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), false);
      page.document.selectors['aside[data-drawer-open="true"]'] = [
        existingDrawer,
      ];
      assert.equal(inspectBlooketAudioCapabilityDrawer("set-fixture").ok,
        false);
      assert.equal(closeBlooketAudioCapabilityDrawer("set-fixture"), false);
      page.document.selectors['aside[data-drawer-open="true"]'] = [];
      assert.equal(closeBlooketCapabilityQuestionPanel("set-fixture"), false);
    }
    assert.equal(page.audio.clicked, 0);
    page.form.selectors['input#setId[name="setId"]'] = [page.setId];
    for (const questions of [
      [page.question, page.question],
      [node("INPUT", "", { type: "text" })],
    ]) {
      page.document.selectors['input#question[name="question"]'] = questions;
      assert.equal(isBlooketCapabilityQuestionPanelReady("set-fixture"), false);
      assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), false);
      page.document.selectors['aside[data-drawer-open="true"]'] = [
        existingDrawer,
      ];
      assert.equal(inspectBlooketAudioCapabilityDrawer("set-fixture").ok,
        false);
      assert.equal(closeBlooketAudioCapabilityDrawer("set-fixture"), false);
      page.document.selectors['aside[data-drawer-open="true"]'] = [];
      assert.equal(closeBlooketCapabilityQuestionPanel("set-fixture"), false);
    }
    assert.equal(page.audio.clicked, 0);
    assert.equal(page.cancel.clicked, 0);
  });
  },
);

test("capability probes refuse a human prompt or missing session", () => {
  for (const mode of [
    "organization", "challenge", "password-overlay", "missing-shell",
    "interstitial", "hidden-main", "duplicate-main", "hidden-navigation",
    "duplicate-navigation", "hidden-logout", "duplicate-logout",
  ] as const) {
    const page = fixture();
    const activeDrawer = drawer("supported");
    if (mode === "organization") {
      page.document.selectors[
        '[role="dialog"][aria-modal="true"] h3'
      ] = [node("H3", "Select your organization")];
    } else if (mode === "challenge") {
      page.document.selectors[
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
      ] = [node("IFRAME", "", { src: "https://hcaptcha.com/challenge" })];
    } else if (mode === "password-overlay") {
      page.document.selectors['input[type="password"]'] = [node("INPUT")];
    } else if (mode === "interstitial") {
      (page.document as FixtureNode & { title: string }).title =
        "Just a moment...";
    } else if (mode === "missing-shell") {
      page.document.selectors['a[href="https://id.blooket.com/logout"]'] = [];
    }
    withPage(page.document, () => {
      if (mode === "hidden-main")
        page.document.selectors["main"]![0]!.getBoundingClientRect =
          () => ({ width: 0, height: 0 });
      if (mode === "duplicate-main")
        page.document.selectors["main"]!.push(node("MAIN"));
      if (mode === "hidden-navigation")
        page.document.selectors['nav a[href="/my-sets"]']![0]!
          .getBoundingClientRect = () => ({ width: 0, height: 0 });
      if (mode === "duplicate-navigation")
        page.document.selectors['nav a[href="/my-sets"]']!.push(
          node("A", "My Sets"),
        );
      if (mode === "hidden-logout")
        page.document.selectors[
          'a[href="https://id.blooket.com/logout"]'
        ]![0]!.getBoundingClientRect = () => ({ width: 0, height: 0 });
      if (mode === "duplicate-logout")
        page.document.selectors[
          'a[href="https://id.blooket.com/logout"]'
        ]!.push(node("A", "Logout"));
      assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), false);
      page.document.selectors['input#question[name="question"]'] = [
        page.question,
      ];
      assert.equal(isBlooketCapabilityQuestionPanelReady("set-fixture"), false);
      assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), false);
      page.document.selectors['aside[data-drawer-open="true"]'] = [
        activeDrawer,
      ];
      assert.equal(inspectBlooketAudioCapabilityDrawer("set-fixture").ok,
        false);
      assert.equal(closeBlooketAudioCapabilityDrawer("set-fixture"), false);
      page.document.selectors['aside[data-drawer-open="true"]'] = [];
      assert.equal(isBlooketAudioCapabilityDrawerClosed("set-fixture"), false);
      assert.equal(closeBlooketCapabilityQuestionPanel("set-fixture"), false);
      page.document.selectors['input#question[name="question"]'] = [];
      assert.equal(isBlooketCapabilityQuestionPanelClosed(
        "set-fixture",
      ), false);
      assert.equal(page.add.clicked, 0);
      assert.equal(page.audio.clicked, 0);
      assert.equal(page.cancel.clicked, 0);
    });
  }
});

test("every injected capability action works without module imports", () => {
  const injected = <T extends (...args: never[]) => unknown>(fn: T): T =>
    Function("return (" + fn.toString() + ")")() as T;
  const openQuestion = injected(openBlooketCapabilityQuestionPanel);
  const isReady = injected(isBlooketCapabilityQuestionPanelReady);
  const openAudio = injected(openBlooketAudioCapabilityDrawer);
  const inspectAudio = injected(inspectBlooketAudioCapabilityDrawer);
  const closeAudio = injected(closeBlooketAudioCapabilityDrawer);
  const isAudioClosed = injected(isBlooketAudioCapabilityDrawerClosed);
  const closeQuestion = injected(closeBlooketCapabilityQuestionPanel);
  const isQuestionClosed = injected(isBlooketCapabilityQuestionPanelClosed);
  const page = fixture();
  const activeDrawer = drawer("unsupported");
  withPage(page.document, () => {
    assert.equal(openQuestion("set-fixture"), true);
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    assert.equal(isReady("set-fixture"), true);
    assert.equal(openAudio("set-fixture"), true);
    page.document.selectors['aside[data-drawer-open="true"]'] = [
      activeDrawer,
    ];
    assert.deepEqual(inspectAudio("set-fixture"), {
      ok: true, value: "unsupported",
    });
    assert.equal(closeAudio("set-fixture"), true);
    page.document.selectors['aside[data-drawer-open="true"]'] = [];
    assert.equal(isAudioClosed("set-fixture"), true);
    assert.equal(closeQuestion("set-fixture"), true);
    page.document.selectors['input#question[name="question"]'] = [];
    assert.equal(isQuestionClosed("set-fixture"), true);
    assert.equal(openQuestion("set-fixture"), true);
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    assert.equal(openAudio("set-fixture"), true);
    page.document.selectors['aside[data-drawer-open="true"]'] = [
      activeDrawer,
    ];
    const previousDrawerClicks = activeDrawer.selectors[
      'button[aria-label="Cancel"]'
    ]![0]!.clicked;
    const previousQuestionClicks = page.cancel.clicked;
    // Trusted human interaction transfers both nested controls to the user.
    page.document.dispatchTrusted("pointerdown");
    assert.equal(inspectAudio("set-fixture").ok, false);
    assert.equal(closeAudio("set-fixture"), false);
    assert.equal(closeQuestion("set-fixture"), false);
    assert.equal(activeDrawer.selectors[
      'button[aria-label="Cancel"]'
    ]![0]!.clicked, previousDrawerClicks);
    assert.equal(page.cancel.clicked, previousQuestionClicks);
  });
});

test(
  "a disabled Audio file picker cannot establish Plus availability",
  () => {
  const page = fixture();
  const activeDrawer = drawer("supported");
  const input = activeDrawer.selectors[
    'input[type="file"][accept="audio/*"]'
  ]?.[0] as FixtureNode & { disabled?: boolean };
  assert.ok(input);
  input.disabled = true;
  withPage(page.document, () => {
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), true);
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), true);
    page.document.selectors['aside[data-drawer-open="true"]'] = [activeDrawer];
    assert.deepEqual(inspectBlooketAudioCapabilityDrawer("set-fixture"), {
      ok: false, code: "blooket-browser-failed",
    });
  });
  },
);


test("capability opener accepts the observed closed account menu", () => {
  const page = fixture();
  const logout = node("A", "Logout");
  logout.getBoundingClientRect = () => ({ width: 0, height: 0 });
  page.document.selectors['a[href="https://id.blooket.com/logout"]'] = [logout];
  const profile = node("A", "Synthetic account");
  page.document.selectors['a[href="https://id.blooket.com/login"]'] = [profile];
  withPage(page.document, () => {
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), true);
    assert.equal(page.add.clicked, 1);
    profile.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), false);
    assert.equal(page.add.clicked, 1);
  });
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
  withPage(page.document, () => {
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), true);
    assert.equal(page.add.clicked, 0);
    assert.equal(bottom.clicked, 1);
    toolbar.selectors["button"]!.push(node("BUTTON", "Add Question"));
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), false);
    assert.equal(bottom.clicked, 1);
  });
});

test("capability modal and Audio controls refuse disabled actions", () => {
  const page = fixture();
  withPage(page.document, () => {
    page.add.disabled = true;
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), false);
    page.add.disabled = false;
    page.add.attributes["aria-disabled"] = "true";
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), false);
    delete page.add.attributes["aria-disabled"];
    assert.equal(openBlooketCapabilityQuestionPanel("set-fixture"), true);
    page.document.selectors['input#question[name="question"]'] = [
      page.question,
    ];
    page.audio.disabled = true;
    assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), false);
    page.audio.disabled = false;
    page.audio.attributes["aria-disabled"] = "true";
    assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), false);
    delete page.audio.attributes["aria-disabled"];
    assert.equal(openBlooketAudioCapabilityDrawer("set-fixture"), true);
    const opened = drawer("supported");
    page.document.selectors['aside[data-drawer-open="true"]'] = [opened];
    const drawerCancel = opened.selectors[
      'button[aria-label="Cancel"]'
    ]![0]!;
    drawerCancel.disabled = true;
    assert.equal(closeBlooketAudioCapabilityDrawer("set-fixture"), false);
    drawerCancel.disabled = false;
    drawerCancel.attributes["aria-disabled"] = "true";
    assert.equal(closeBlooketAudioCapabilityDrawer("set-fixture"), false);
    delete drawerCancel.attributes["aria-disabled"];
    assert.equal(closeBlooketAudioCapabilityDrawer("set-fixture"), true);
    delete page.document.selectors['aside[data-drawer-open="true"]'];
    page.cancel.disabled = true;
    assert.equal(closeBlooketCapabilityQuestionPanel("set-fixture"), false);
    page.cancel.disabled = false;
    assert.equal(closeBlooketCapabilityQuestionPanel("set-fixture"), true);
    assert.equal(page.add.clicked, 1);
    assert.equal(page.audio.clicked, 1);
    assert.equal(drawerCancel.clicked, 1);
    assert.equal(page.cancel.clicked, 1);
  });
});
