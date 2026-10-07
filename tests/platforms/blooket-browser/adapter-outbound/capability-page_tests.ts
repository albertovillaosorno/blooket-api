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
  clicked: number;
  selectors: Record<string, FixtureNode[]>;
  attributes: Record<string, string>;
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
    value: "",
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
  const setId = node("INPUT", "", { id: "setId", name: "setId" });
  setId.value = "set-fixture";
  setId.parent = form;
  const audio = node("BUTTON", " Audio ", { type: "button" });
  audio.parent = form;
  const cancel = node("BUTTON", "Cancel", { type: "button" });
  cancel.parent = form;
  form.selectors['input#setId[name="setId"]'] = [setId];
  form.selectors["button"] = [audio, cancel];
  form.selectors['button[type="button"]'] = [audio, cancel];
  return { document, add, form, question, audio, cancel };
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
    if (priorDocument)
      Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (priorLocation)
      Object.defineProperty(globalThis, "location", priorLocation);
    else Reflect.deleteProperty(globalThis, "location");
  }
}

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
    withPage(page.document, () => {
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

test("ambiguous capability controls fail without clicking", () => {
  const page = fixture();
  page.document.selectors['input#question[name="question"]'] = [page.question];
  withPage(page.document, () => {
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
