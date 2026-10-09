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
//   - Synthetic regression coverage for observed Blooket page extraction.
// - Must-Not:
//   - Read hidden framework state, cookies, credentials, or raw page HTML.
// - Allows:
//   - Inputs: One admitted read operation on the confirmed dashboard origin.
//   - Outputs: Untrusted visible facts or a stable browser failure.
//   - Side effects: DOM inspection and opening details without saving edits.
// - Split-When:
//   - Question reading gains independently verified control semantics.
// - Merge-When:
//   - Visible page reads no longer require a browser-specific boundary.
// - Summary:
//   - Extracts set summaries and detail without guessing unavailable fields.
// - Description:
//   - Application IR decoders remain the authority for returned values.
// - Usage:
//   - Run with synthetic DOM controls and the owning IR decoders.
// - Defaults:
//   - Unknown routes, incomplete controls, and ambiguous values fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectBlooketPage,
  blooketReadUrl,
  openBlooketDetailPanel,
  inspectBlooketDetailSidebar,
  closeBlooketDetailPanel,
  isBlooketDetailPanelClosed,
} from "../../../../src/platforms/blooket-browser/adapter-outbound/page.ts";
import {
  decodeBlooketSetList,
  decodeBlooketSetDetail,
} from "../../../../src/ir/blooket-set-reads/contract/set-read.ts";

interface FixtureNode {
  tagName: string;
  textContent: string;
  value?: string;
  labels?: FixtureNode[];
  parentElement?: FixtureNode;
  selectors: Record<string, FixtureNode[]>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FixtureNode | null;
  querySelectorAll(selector: string): FixtureNode[];
  getBoundingClientRect(): { width: number; height: number };
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
    getAttribute: (name) => attributes[name] ?? null,
    querySelector(selector) {
      return this.selectors[selector]?.[0] ?? null;
    },
    querySelectorAll(selector) {
      return this.selectors[selector] ?? [];
    },
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
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
    const world = globalThis as typeof globalThis & {
      __blooketDetailEditWatch?: {
        document: Document; dispose: () => void
      };
    };
    if (world.__blooketDetailEditWatch?.document === document)
      world.__blooketDetailEditWatch.dispose();
    if (priorDocument)
      Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (priorLocation)
      Object.defineProperty(globalThis, "location", priorLocation);
    else Reflect.deleteProperty(globalThis, "location");
  }
}
function base() {
  const document = node("DOCUMENT");
  const main = node("MAIN");
  document.selectors["main"] = [main];
  document.selectors['nav a[href="/my-sets"]'] = [node("A", "My Sets")];
  document.selectors['a[href="https://id.blooket.com/logout"]'] = [
    node("A", "Logout"),
  ];
  main.selectors["h1"] = [node("H1", "My Sets")];
  return { document, main };
}
function privacyLabel(text: string): FixtureNode {
  const label = node("LABEL");
  const row = node("DIV");
  row.selectors[":scope > p"] = [node("P", text)];
  label.parentElement = row;
  return label;
}

function card(id = "fixture-set") {
  const article = node("ARTICLE");
  article.selectors["h3"] = [node("H3", "Synthetic fixture")];
  article.selectors["a[href]"] = [
    node("A", " Edit ", {
      href: "/edit?id=" + encodeURIComponent(id),
    }),
    node("A", "View Set", { href: "/set/" + id }),
  ];
  return article;
}

test(
  "visible set summaries preserve opaque IDs and pass the IR decoder",
  () => {
  const { document, main } = base();
  main.selectors["article"] = [card("opaque/set? id")];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "my-sets",
    });
    const pageTitle = main.selectors["h1"]![0]!;
    pageTitle.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "unexpected-page",
    });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    pageTitle.getBoundingClientRect = () => ({ width: 20, height: 20 });
    const result = inspectBlooketPage({ kind: "sets.list" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      items: [
        { schemaVersion: 1, id: "opaque/set? id", title: "Synthetic fixture" },
      ],
      completeness: "unknown",
    });
    assert.equal(
      decodeBlooketSetList(
        (result.value as { readonly items: unknown }).items,
      ).ok,
      true,
    );
    const shown = main.selectors["article"]![0]!;
    shown.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    shown.getBoundingClientRect = () => ({ width: 20, height: 20 });
    const heading = shown.selectors["h3"]![0]!;
    heading.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    heading.getBoundingClientRect = () => ({ width: 20, height: 20 });
    const editLink = shown.selectors["a[href]"]![0]!;
    editLink.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    editLink.getBoundingClientRect = () => ({ width: 20, height: 20 });
    main.selectors["article"] = [card(), card()];
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    main.selectors["article"] = [];
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    main.selectors["h2"] = [
      node("H2", "You'll need a question set to host!"),
    ];
    main.selectors["button"] = [node("BUTTON", "Create a Set")];
    const empty = inspectBlooketPage({ kind: "sets.list" });
    assert.deepEqual(empty, {
      ok: true,
      value: { items: [], completeness: "complete" },
    });
    const emptyHeading = main.selectors["h2"]![0]!;
    emptyHeading.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    emptyHeading.getBoundingClientRect = () => ({ width: 20, height: 20 });
    const create = main.selectors["button"]![0]!;
    create.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    create.getBoundingClientRect = () => ({ width: 20, height: 20 });
    main.selectors["h2"] = [emptyHeading, emptyHeading];
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    main.selectors["h2"] = [emptyHeading];
    main.selectors["button"] = [create, create];
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    main.selectors["button"] = [create];
    assert.equal(
      decodeBlooketSetList(
        empty.ok
          ? (empty.value as { readonly items: unknown }).items
          : null,
      ).ok,
      true,
    );
    main.selectors["h2"] = [node("H2", "Open a folder to view your sets!")];
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    main.selectors["h2"] = [node("H2", "No sets found.")];
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
  });
});

test(
  "malformed or foreign set links fail instead of returning partial lists",
  () => {
  const { document, main } = base();
  for (const href of [
    "https://example.invalid/edit?id=fixture",
    "/delete?id=fixture",
    "/edit",
    "/edit?id=",
    "/edit?id=fixture&id=other",
    "/edit?id=fixture&id=fixture",
    "/edit?id=x%0Ay",
  ]) {
    const article = card();
    article.selectors["a[href]"] = [node("A", "Edit", { href })];
    main.selectors["article"] = [article];
    page(document, "https://dashboard.blooket.com/my-sets", () =>
      assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false),
    );
  }
  main.selectors["article"] = Array.from({ length: 201 }, (_, i) =>
    card("id" + i),
  );
  page(document, "https://dashboard.blooket.com/my-sets", () =>
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false),
  );
});

test(
  "detail requires the observed private label and exact requested set",
  () => {
  const { document, main } = base();
  main.selectors["h1"] = [node("H1", "Synthetic fixture")];
  const title = node("INPUT");
  title.value = "Synthetic fixture";
  const description = node("TEXTAREA");
  description.value = "Original text";
  const attributes = {
    type: "checkbox",
    role: "switch",
    "aria-checked": "false",
  };
  const privacy = node("INPUT", "", attributes);
  privacy.labels = [privacyLabel("Private (Only playable by you)")];
  document.selectors['input#title[name="title"]'] = [title];
  document.selectors['textarea#desc[name="desc"]'] = [description];
  document.selectors['input#private[name="private"]'] = [privacy];
  const form = node("FORM");
  const identity = node("INPUT", "", { type: "hidden", name: "setId" });
  identity.value = "fixture";
  form.selectors['input[type="hidden"][name="setId"]'] = [identity];
  form.selectors['input#title[name="title"]'] = [title];
  form.selectors['textarea#desc[name="desc"]'] = [description];
  form.selectors['input#private[name="private"]'] = [privacy];
  document.selectors['form#question-set-form'] = [form];
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    // The worker compares these mutable editor values with its separate
    // pre-open sidebar baseline; this page helper only decodes the form.
    const result = inspectBlooketPage({ kind: "sets.get", setId: "fixture" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(decodeBlooketSetDetail(result.value).ok, true);
    assert.equal(
      inspectBlooketPage({ kind: "sets.get", setId: "other" }).ok,
      false,
    );
    attributes["aria-checked"] = "true";
    privacy.labels = [privacyLabel("Public (Playable by everyone)")];
    const publicResult = inspectBlooketPage({
      kind: "sets.get",
      setId: "fixture",
    });
    assert.equal(publicResult.ok, true);
    if (publicResult.ok) {
      const decoded = decodeBlooketSetDetail(publicResult.value);
      assert.equal(decoded.ok, true);
      if (decoded.ok) assert.equal(decoded.value.visibility, "public");
    }
    attributes["aria-checked"] = "false";
    privacy.labels = [privacyLabel("Public (Playable by everyone)")];
    assert.equal(
      inspectBlooketPage({ kind: "sets.get", setId: "fixture" }).ok,
      false,
    );
    privacy.labels = [privacyLabel("Unknown visibility")];
    assert.equal(
      inspectBlooketPage({ kind: "sets.get", setId: "fixture" }).ok,
      false,
    );
    privacy.labels = [privacyLabel("Private (Only playable by you)")];
    identity.value = "another";
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    identity.value = "fixture";
    form.selectors['input[type="hidden"][name="setId"]'] = [
      identity, node("INPUT"),
    ];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    form.selectors['input[type="hidden"][name="setId"]'] = [identity];
    document.selectors['input#title[name="title"]'] = [
      node("INPUT"),
    ];
    const scoped = inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    });
    assert.equal(scoped.ok, true);
    if (scoped.ok)
      assert.equal((scoped.value as { title: string }).title,
        "Synthetic fixture");
    form.selectors['input#title[name="title"]'] = [];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    form.selectors['input#title[name="title"]'] = [title, title];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    form.selectors['input#title[name="title"]'] = [title];
    form.selectors['textarea#desc[name="desc"]'] = [
      description, description,
    ];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    form.selectors['textarea#desc[name="desc"]'] = [description];
    form.selectors['input#private[name="private"]'] = [
      privacy, privacy,
    ];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    form.selectors['input#private[name="private"]'] = [privacy];
    title.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
  });
});

test("set privacy comes from the recovered visible sibling paragraph", () => {
  const { document, main } = base();
  main.selectors["h1"] = [node("H1", "Synthetic fixture")];
  const form = node("FORM");
  const identity = node("INPUT", "", { type: "hidden" });
  identity.value = "fixture";
  form.selectors['input[type="hidden"][name="setId"]'] = [identity];
  const title = node("INPUT");
  title.value = "Synthetic fixture";
  const description = node("TEXTAREA");
  description.value = "Original text";
  const attributes = {
    type: "checkbox", role: "switch", "aria-checked": "false",
  };
  const privacy = node("INPUT", "", attributes);
  const switchLabel = node("LABEL", "");
  const toggleContainer = node("DIV");
  const state = node("P", "Private (Only playable by you)");
  toggleContainer.selectors[":scope > p"] = [state];
  switchLabel.parentElement = toggleContainer;
  privacy.labels = [switchLabel];
  form.selectors['input#title[name="title"]'] = [title];
  form.selectors['textarea#desc[name="desc"]'] = [description];
  form.selectors['input#private[name="private"]'] = [privacy];
  document.selectors['form#question-set-form'] = [form];
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    let result = inspectBlooketPage({ kind: "sets.get", setId: "fixture" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.value as { visibility: string }).visibility,
        "private");
    }
    attributes["aria-checked"] = "true";
    state.textContent = "Public (Playable by everyone)";
    result = inspectBlooketPage({ kind: "sets.get", setId: "fixture" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.value as { visibility: string }).visibility,
        "public");
    }
    attributes["aria-checked"] = "false";
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    state.textContent = "Private (Only playable by you)";
    state.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    state.getBoundingClientRect = () => ({ width: 20, height: 20 });
    toggleContainer.selectors[":scope > p"] = [state, state];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    toggleContainer.selectors[":scope > p"] = [];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    toggleContainer.selectors[":scope > p"] = [state];
    privacy.labels = [switchLabel, switchLabel];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    privacy.labels = [];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    const outer = node("LABEL", "Privacy Setting");
    outer.parentElement = node("DIV");
    const wrapper = node("SPAN");
    wrapper.parentElement = toggleContainer;
    switchLabel.parentElement = wrapper;
    privacy.labels = [outer, switchLabel];
    const injected = Function(
      "return (" + inspectBlooketPage.toString() + ")",
    )() as typeof inspectBlooketPage;
    assert.equal(injected({ kind: "sets.get", setId: "fixture" }).ok, true);
    outer.parentElement.selectors[":scope > p"] = [state];
    assert.equal(injected({ kind: "sets.get", setId: "fixture" }).ok, false);
    switchLabel.parentElement = toggleContainer;
    privacy.labels = [switchLabel];
    switchLabel.textContent = "Private (Only playable by you)";
    toggleContainer.selectors[":scope > p"] = [];
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
    toggleContainer.selectors[":scope > p"] = [state];
    switchLabel.parentElement = undefined;
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
  });
});

test("set detail refuses duplicate set IDs in the current route", () => {
  const { document } = base();
  const title = node("INPUT");
  title.value = "Synthetic fixture";
  const description = node("TEXTAREA");
  description.value = "Original text";
  const privacy = node("INPUT", "", {
    type: "checkbox", role: "switch", "aria-checked": "false",
  });
  privacy.labels = [privacyLabel("Private (Only playable by you)")];
  document.selectors['input#title[name="title"]'] = [title];
  document.selectors['textarea#desc[name="desc"]'] = [description];
  document.selectors['input#private[name="private"]'] = [privacy];
  for (const href of [
    "https://dashboard.blooket.com/edit?id=fixture&id=other",
    "https://dashboard.blooket.com/edit?id=fixture&id=fixture",
    "https://dashboard.blooket.com/edit?id=x%0Ay",
  ]) {
    page(document, href, () => {
      assert.equal(inspectBlooketPage({
        kind: "sets.get", setId: "fixture",
      }).ok, false);
    });
  }
});

test("dashboard password overlays cannot establish reads or signed-out", () => {
  const { document, main } = base();
  main.selectors["article"] = [card()];
  const password = node("INPUT", "", { type: "password" });
  document.selectors['input[type="password"]'] = [password];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "unexpected-page",
    });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    document.selectors[
      '[role="dialog"][aria-modal="true"] h3'
    ] = [node("H3", "Select your organization")];
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "organization-prompt",
    });
    document.selectors[
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
    ] = [node("IFRAME", "", { src: "https://hcaptcha.com/challenge" })];
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "security-challenge",
    });
    document.selectors[
      '[role="dialog"][aria-modal="true"] h3'
    ] = [];
    document.selectors[
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
    ] = [];
  });
  const form = node("FORM");
  const identity = node("INPUT", "", { type: "hidden" });
  identity.value = "fixture";
  form.selectors['input[type="hidden"][name="setId"]'] = [identity];
  const title = node("INPUT");
  title.value = "Synthetic fixture";
  const description = node("TEXTAREA");
  description.value = "Original text";
  const privacy = node("INPUT", "", {
    type: "checkbox", role: "switch", "aria-checked": "false",
  });
  privacy.labels = [privacyLabel("Private (Only playable by you)")];
  form.selectors['input#title[name="title"]'] = [title];
  form.selectors['textarea#desc[name="desc"]'] = [description];
  form.selectors['input#private[name="private"]'] = [privacy];
  document.selectors['form#question-set-form'] = [form];
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "unexpected-page",
    });
    assert.equal(inspectBlooketPage({
      kind: "sets.get", setId: "fixture",
    }).ok, false);
  });
});

test("dashboard reads require the recovered authenticated shell", () => {
  const { document, main } = base();
  main.selectors["article"] = [card()];
  document.selectors['a[href="https://id.blooket.com/logout"]'] = [];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "unexpected-page",
    });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
  });

  document.selectors['a[href="https://id.blooket.com/logout"]'] = [
    node("A", "Logout"),
    node("A", "Logout"),
  ];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "unexpected-page",
    });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
  });

  document.selectors['a[href="https://id.blooket.com/logout"]'] = [
    node("A", "Sign out"),
  ];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "unexpected-page",
    });
  });
});

test("hidden or duplicate authenticated shell markers reject reads", () => {
  for (const marker of [
    "hidden-main", "duplicate-main", "hidden-navigation",
    "duplicate-navigation", "hidden-logout", "duplicate-logout",
  ]) {
    const { document, main } = base();
    main.selectors["article"] = [card()];
    if (marker === "hidden-main")
      main.getBoundingClientRect = () => ({ width: 0, height: 0 });
    if (marker === "duplicate-main")
      document.selectors["main"]!.push(node("MAIN"));
    if (marker === "hidden-navigation") {
      document.selectors['nav a[href="/my-sets"]']![0]!
        .getBoundingClientRect = () => ({ width: 0, height: 0 });
    }
    if (marker === "duplicate-navigation") {
      document.selectors['nav a[href="/my-sets"]']!.push(
        node("A", "My Sets"),
      );
    }
    if (marker === "hidden-logout") {
      document.selectors[
        'a[href="https://id.blooket.com/logout"]'
      ]![0]!.getBoundingClientRect = () => ({ width: 0, height: 0 });
    }
    if (marker === "duplicate-logout") {
      document.selectors[
        'a[href="https://id.blooket.com/logout"]'
      ]!.push(node("A", "Logout"));
    }
    page(document, "https://dashboard.blooket.com/my-sets", () => {
      assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
        ok: true, value: "unexpected-page",
      });
      assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    });
  }
});

test(
  "organization selection is a human stop before set reads",
  () => {
  const { document, main } = base();
  main.selectors["article"] = [card()];
  document.selectors[
    '[role="dialog"][aria-modal="true"] h3'
  ] = [node("H3", "Select your organization")];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "organization-prompt",
    });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
  });
  },
);

test("create page observation requires the exact observed form", () => {
  const { document } = base();
  const form = node("FORM");
  const button = node("BUTTON", "Create Set");
  document.selectors["form#question-set-form"] = [form];
  document.selectors["form#question-set-form button"] = [button];
  page(document, "https://dashboard.blooket.com/create", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "create",
    });
    button.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "unexpected-page",
    });
    button.getBoundingClientRect = () => ({ width: 20, height: 20 });
    form.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "unexpected-page",
    });
    form.getBoundingClientRect = () => ({ width: 20, height: 20 });
    document.selectors["form#question-set-form"] = [form, form];
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "unexpected-page",
    });
    document.selectors["form#question-set-form"] = [form];
    document.selectors["form#question-set-form button"] = [
      button,
      node("BUTTON", "Create Set"),
    ];
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "unexpected-page",
    });
  });
});

test("edit readiness refuses hidden or duplicate Save Set controls", () => {
  const { document, main } = base();
  const save = node("BUTTON", "Save Set");
  main.selectors["button"] = [save];
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "edit",
    });
    save.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "unexpected-page",
    });
    save.getBoundingClientRect = () => ({ width: 20, height: 20 });
    main.selectors["button"] = [save, save];
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "unexpected-page",
    });
    main.selectors["button"] = [save];
    const heading = main.selectors["h1"]![0]!;
    heading.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "unexpected-page",
    });
  });
});

test(
  "public login page is the only admitted identity-origin observation",
  () => {
  const document = node("DOCUMENT");
  document.selectors["h1, h2, h3"] = [node("H1", "Log in")];
  document.selectors['input[placeholder="Username or email"]'] = [
    node("INPUT"),
  ];
  document.selectors[
    'input[type="password"][placeholder="Password"]'
  ] = [node("INPUT")];
  document.selectors["button"] = [node("BUTTON", "Let's go!")];
  page(document, "https://id.blooket.com/login", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "signed-out",
    });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
  });

  document.selectors[
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
  ] = [
    node("IFRAME", "", {
      src: "https://www.google.com/recaptcha/api2/anchor?size=invisible",
    }),
  ];
  page(document, "https://id.blooket.com/login", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "signed-out",
    });
  });

  for (const source of [
    "https://www.google.com/recaptcha/api2/bframe?size=invisible",
    "https://example.invalid/recaptcha/api2/anchor?size=invisible",
    "https://www.google.com/recaptcha/api2/anchor" +
      "?size=invisible&size=invisible",
  ]) {
    document.selectors[
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
    ] = [node("IFRAME", "", { src: source })];
    page(document, "https://id.blooket.com/login", () => {
      assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
        ok: true,
        value: "security-challenge",
      });
    });
  }
  document.selectors[
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
  ] = [];
  page(document, "https://id.blooket.com/signup", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "unexpected-page",
    });
  });
  },
);

test("invisible anchors are never ignored on dashboard reads", () => {
  const { document, main } = base();
  main.selectors["article"] = [card()];
  document.selectors[
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
  ] = [node("IFRAME", "", {
    src: "https://www.google.com/recaptcha/api2/anchor?size=invisible",
  })];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "security-challenge",
    });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
  });
});

test(
  "challenge and unknown origin observations never proceed to set reads",
  () => {
  const { document, main } = base();
  main.selectors["article"] = [card()];
  document.selectors['iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'] = [
    node("IFRAME"),
  ];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true,
      value: "security-challenge",
    });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
  });
  page(document, "https://example.invalid/my-sets", () =>
    assert.equal(inspectBlooketPage({ kind: "session.observe" }).ok, false),
  );
});

test("read routes encode IDs and panel opening never submits a form", () => {
  assert.equal(
    blooketReadUrl({ kind: "sets.get", setId: "x&redirect=http://bad" }),
    "https://dashboard.blooket.com/edit?id=x%26redirect%3Dhttp%3A%2F%2Fbad",
  );
  assert.throws(() => blooketReadUrl({ kind: "sets.get", setId: "\0" }));
  assert.throws(() => blooketReadUrl({ kind: "sets.get", setId: "x\ny" }));
  const { document } = base();
  const button = node("BUTTON", "Edit Info");
  let clicks = 0;
  button.click = () => {
    clicks++;
  };
  document.selectors["main button"] = [button];
  const form = node("FORM");
  const identity = node("INPUT", "", { type: "hidden", name: "setId" });
  identity.value = "fixture";
  form.selectors['input[type="hidden"][name="setId"]'] = [identity];
  document.selectors['form#question-set-form'] = [form];
  const title = node("INPUT");
  title.getBoundingClientRect = () => ({ width: 0, height: 0 });
  form.selectors['input#title[name="title"]'] = [title];
  document.selectors['input#title[name="title"]'] = [
    node("INPUT"),
  ];
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.equal(openBlooketDetailPanel("fixture"), true);
    assert.equal(clicks, 1);
    (button as FixtureNode & { disabled?: boolean }).disabled = true;
    assert.equal(openBlooketDetailPanel("fixture"), false);
    (button as FixtureNode & { disabled?: boolean }).disabled = false;
    button.getAttribute = (key) => key === "aria-disabled" ? "true" : null;
    assert.equal(openBlooketDetailPanel("fixture"), false);
    button.getAttribute = () => null;
    button.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(openBlooketDetailPanel("fixture"), false);
    button.getBoundingClientRect = () => ({ width: 20, height: 20 });
    assert.equal(clicks, 1);
    identity.value = "old-set";
    assert.equal(openBlooketDetailPanel("fixture"), false);
    assert.equal(clicks, 1);
    identity.value = "fixture";
    form.selectors['input#title[name="title"]'] = [title, title];
    assert.equal(openBlooketDetailPanel("fixture"), false);
    assert.equal(clicks, 1);
    form.selectors['input#title[name="title"]'] = [title];
    title.getBoundingClientRect = () => ({ width: 20, height: 20 });
    // Never reuse an unowned editor with potentially unsaved changes.
    assert.equal(openBlooketDetailPanel("fixture"), false);
    assert.equal(clicks, 1);
  });
  page(document, "https://example.invalid/edit?id=fixture", () => {
    assert.equal(openBlooketDetailPanel("fixture"), false);
    assert.equal(clicks, 1);
  });
  for (const href of [
    "https://dashboard.blooket.com/edit?id=other",
    "https://dashboard.blooket.com/edit?id=fixture&id=other",
    "https://dashboard.blooket.com/edit?id=fixture&id=fixture",
  ]) {
    page(document, href, () => {
      assert.equal(openBlooketDetailPanel("fixture"), false);
      assert.equal(clicks, 1);
    });
  }
});

test("Edit Info opener refuses human-action overlays and lost sessions", () => {
  for (const mode of [
    "organization", "challenge", "password-overlay", "missing-shell",
    "interstitial", "hidden-main", "duplicate-main", "hidden-nav",
    "duplicate-nav", "hidden-logout", "duplicate-logout",
  ] as const) {
    const { document } = base();
    const button = node("BUTTON", "Edit Info");
    let clicks = 0;
    button.click = () => { clicks++; };
    document.selectors["main button"] = [button];
    const form = node("FORM");
    const identity = node("INPUT", "", { type: "hidden" });
    identity.value = "fixture";
    form.selectors['input[type="hidden"][name="setId"]'] = [identity];
    const title = node("INPUT");
    title.getBoundingClientRect = () => ({ width: 0, height: 0 });
    form.selectors['input#title[name="title"]'] = [title];
    document.selectors['form#question-set-form'] = [form];
    if (mode === "organization") {
      document.selectors[
        '[role="dialog"][aria-modal="true"] h3'
      ] = [node("H3", "Select your organization")];
    } else if (mode === "challenge") {
      document.selectors[
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
      ] = [node("IFRAME", "", { src: "https://hcaptcha.com/challenge" })];
    } else if (mode === "password-overlay") {
      document.selectors['input[type="password"]'] = [node("INPUT")];
    } else if (mode === "interstitial") {
      (document as FixtureNode & { title: string }).title =
        "Just a moment...";
    } else if (mode === "missing-shell") {
      document.selectors['a[href="https://id.blooket.com/logout"]'] = [];
    }
    page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
      if (mode === "hidden-main")
        document.selectors["main"]![0]!.getBoundingClientRect =
          () => ({ width: 0, height: 0 });
      if (mode === "duplicate-main")
        document.selectors["main"]!.push(node("MAIN"));
      if (mode === "hidden-nav")
        document.selectors['nav a[href="/my-sets"]']![0]!
          .getBoundingClientRect = () => ({ width: 0, height: 0 });
      if (mode === "duplicate-nav")
        document.selectors['nav a[href="/my-sets"]']!.push(
          node("A", "My Sets"),
        );
      if (mode === "hidden-logout")
        document.selectors['a[href="https://id.blooket.com/logout"]']![0]!
          .getBoundingClientRect = () => ({ width: 0, height: 0 });
      if (mode === "duplicate-logout")
        document.selectors['a[href="https://id.blooket.com/logout"]']!
          .push(node("A", "Logout"));
      assert.equal(openBlooketDetailPanel("fixture"), false);
      assert.equal(clicks, 0);
    });
  }
});

test(
  "observed interstitial on either Blooket origin is a security stop",
  () => {
  for (const origin of [
    "https://id.blooket.com/login",
    "https://dashboard.blooket.com/my-sets",
  ]) {
    const document = node("DOCUMENT");
    (document as FixtureNode & { title: string }).title = "Just a moment...";
    document.selectors["h1, h2, h3"] = [
      node("H1", new URL(origin).hostname),
      node("H2", "Performing security verification"),
      node("H3", "Verification successful. Waiting for " +
        new URL(origin).hostname + " to respond"),
    ];
    page(document, origin, () => {
      assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
        ok: true, value: "security-challenge",
      });
      assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    });
    (document as FixtureNode & { title: string }).title = "Just a moment...";
    document.selectors["h1, h2, h3"] = [node("H1", "Ordinary page")];
    if (origin.includes("dashboard")) {
      const main = node("MAIN");
      main.selectors["h1"] = [node("H1", "My Sets")];
      main.selectors["article"] = [card()];
      document.selectors["main"] = [main];
      document.selectors['nav a[href="/my-sets"]'] = [
        node("A", "My Sets"),
      ];
      document.selectors['a[href="https://id.blooket.com/logout"]'] = [
        node("A", "Logout"),
      ];
    }
    page(document, origin, () => {
      assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
        ok: true, value: "security-challenge",
      });
      assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    });
    (document as FixtureNode & { title: string }).title = "Unknown page";
    page(document, origin, () => {
      assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
        ok: true,
        value: origin.includes("dashboard") ? "my-sets" : "unexpected-page",
      });
    });
  }
  },
);

test("injected page readers work without module lexical scope", () => {
  const inspect = Function(
    "return (" + inspectBlooketPage.toString() + ")",
  )() as typeof inspectBlooketPage;
  const open = Function(
    "return (" + openBlooketDetailPanel.toString() + ")",
  )() as typeof openBlooketDetailPanel;
  const { document, main } = base();
  main.selectors["article"] = [card()];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.equal(inspect({ kind: "sets.list" }).ok, true);
    assert.equal(open("fixture"), false);
  });
  (document as FixtureNode & { title: string }).title = "Just a moment...";
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspect({ kind: "session.observe" }), {
      ok: true, value: "security-challenge",
    });
    assert.equal(inspect({ kind: "sets.list" }).ok, false);
    assert.equal(open("fixture"), false);
  });
});


test("closed account menu retains a visible authenticated profile", () => {
  const { document, main } = base();
  main.selectors["article"] = [card()];
  const logout = document.selectors[
    'a[href="https://id.blooket.com/logout"]'
  ]![0]!;
  logout.getBoundingClientRect = () => ({ width: 0, height: 0 });
  const account = node("A", "Synthetic account");
  document.selectors['a[href="https://id.blooket.com/login"]'] = [account];
  page(document, "https://dashboard.blooket.com/my-sets", () => {
    assert.deepEqual(inspectBlooketPage({ kind: "session.observe" }), {
      ok: true, value: "my-sets",
    });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, true);
    account.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    account.getBoundingClientRect = () => ({ width: 20, height: 20 });
    account.textContent = "";
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
    account.textContent = "Synthetic account";
    document.selectors['a[href="https://id.blooket.com/login"]']!.push(account);
    assert.equal(inspectBlooketPage({ kind: "sets.list" }).ok, false);
  });
});

test("owned Edit Info cancellation closes the read-only metadata panel", () => {
  const { document, main } = base();
  const form = node("FORM");
  const identity = node("INPUT", "", { type: "hidden" });
  identity.value = "fixture";
  form.selectors['input[type="hidden"][name="setId"]'] = [identity];
  const title = node("INPUT");
  title.value = "Synthetic fixture";
  form.selectors['input#title[name="title"]'] = [title];
  const description = node("TEXTAREA");
  description.value = "Original text";
  form.selectors['textarea#desc[name="desc"]'] = [description];
  const privacy = node("INPUT", "", {
    type: "checkbox", role: "switch", "aria-checked": "false",
  });
  privacy.labels = [privacyLabel("Private (Only playable by you)")];
  form.selectors['input#private[name="private"]'] = [privacy];
  document.selectors['form#question-set-form'] = [form];
  const heading = node("P", "EDITING SET DETAILS");
  const header = node("DIV");
  heading.parentElement = header;
  main.selectors["p"] = [heading];
  main.selectors["h1"] = []; // Original sidebar unmounts while editing.
  document.selectors["main p"] = [heading];
  const cancel = node("BUTTON", "", { type: "button" });
  const edit = node("BUTTON", "Edit Info");
  document.selectors["main button"] = [edit];
  header.selectors['button[type="button"]'] = [cancel];
  let clicks = 0;
  cancel.click = () => {
    clicks++;
    title.getBoundingClientRect = () => ({ width: 0, height: 0 });
    heading.getBoundingClientRect = () => ({ width: 0, height: 0 });
  };
  const baseline = { title: "Synthetic fixture", description: "Original text" };
  const observed = { ...baseline, visibility: "private" as const };
  const close = () => closeBlooketDetailPanel("fixture", baseline, observed);
  const world = globalThis as typeof globalThis & {
    __blooketDetailEditWatch?: {
      document: Document; setId: string; dirty: boolean; dispose: () => void
    };
  };
  world.__blooketDetailEditWatch = {
    document: document as unknown as Document,
    setId: "fixture",
    dirty: false,
    dispose: () => { delete world.__blooketDetailEditWatch; },
  };
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.equal(isBlooketDetailPanelClosed("fixture"), false);
    (cancel as FixtureNode & { disabled?: boolean }).disabled = true;
    assert.equal(close(), false);
    (cancel as FixtureNode & { disabled?: boolean }).disabled = false;
    cancel.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(close(), false);
    cancel.getBoundingClientRect = () => ({ width: 20, height: 20 });
    header.selectors['button[type="button"]'] = [cancel, cancel];
    assert.equal(close(), false);
    header.selectors['button[type="button"]'] = [cancel];
    identity.value = "another-set";
    assert.equal(close(), false);
    identity.value = "fixture";
    document.selectors[
      '[role="dialog"][aria-modal="true"] h3'
    ] = [node("H3", "Select your organization")];
    assert.equal(close(), false);
    document.selectors[
      '[role="dialog"][aria-modal="true"] h3'
    ] = [];
    assert.equal(clicks, 0);
    title.value = "Unsaved teacher title";
    assert.equal(close(), false);
    assert.equal(clicks, 0);
    title.value = "Synthetic fixture";
    description.value = "Teacher draft";
    assert.equal(close(), false);
    description.value = "Original text";
    privacy.getAttribute = (name) =>
      name === "aria-checked" ? "true" :
        name === "type" ? "checkbox" :
          name === "role" ? "switch" : null;
    assert.equal(close(), false); // A changed privacy toggle is teacher-owned.
    privacy.getAttribute = (name) =>
      name === "aria-checked" ? "false" :
        name === "type" ? "checkbox" :
          name === "role" ? "switch" : null;
    const inner = privacy.labels![0]!;
    const wrapper = node("SPAN");
    wrapper.parentElement = inner.parentElement;
    inner.parentElement = wrapper;
    const outer = node("LABEL", "Privacy Setting");
    outer.parentElement = node("DIV");
    privacy.labels = [outer, inner];
    outer.parentElement.selectors[":scope > p"] = [node("P", "Private")];
    assert.equal(close(), false);
    assert.equal(clicks, 0);
    outer.parentElement.selectors[":scope > p"] = [];
    assert.equal(close(), true);
    assert.equal(clicks, 1);
    assert.equal(isBlooketDetailPanelClosed("fixture"), true);
    document.selectors[
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
    ] = [node("IFRAME")];
    assert.equal(isBlooketDetailPanelClosed("fixture"), false);
    document.selectors[
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
    ] = [];
    assert.equal(isBlooketDetailPanelClosed("wrong"), false);
    assert.equal(close(), false);
  });
  const serializedClose = Function(
    "return (" + closeBlooketDetailPanel.toString() + ")",
  )() as typeof closeBlooketDetailPanel;
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.equal(serializedClose("fixture", baseline, observed), false);
    assert.equal(clicks, 1);
  });
});

test("detail baseline requires the original visible unedited sidebar", () => {
  const { document, main } = base();
  const title = node("H1", "Synthetic fixture");
  const titleBox = node("DIV");
  const sidebar = node("DIV");
  title.parentElement = titleBox;
  titleBox.parentElement = sidebar;
  const description = node("P", "Original text");
  sidebar.selectors[":scope > p"] = [description];
  main.selectors["h1"] = [title];
  main.selectors["button"] = [node("BUTTON", "Edit Info")];
  const baseline = { ok: true, value: {
    title: "Synthetic fixture", description: "Original text",
  } };
  const serialized = Function(
    "return (" + inspectBlooketDetailSidebar.toString() + ")",
  )() as typeof inspectBlooketDetailSidebar;
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    assert.deepEqual(inspectBlooketDetailSidebar("fixture"), baseline);
    assert.deepEqual(serialized("fixture"), baseline);
    title.textContent = "  Synthetic fixture  ";
    assert.deepEqual(serialized("fixture"), {
      ok: true, value: {
        title: "  Synthetic fixture  ", description: "Original text",
      },
    });
    title.textContent = "Synthetic fixture";
    description.textContent = "Changed visible description";
    assert.equal(inspectBlooketDetailSidebar("fixture").ok, true);
    description.textContent = "Original text";
    main.selectors["h1"] = [];
    assert.equal(inspectBlooketDetailSidebar("fixture").ok, false);
    main.selectors["h1"] = [title];
    sidebar.selectors[":scope > p"] = [description, description];
    assert.equal(inspectBlooketDetailSidebar("fixture").ok, false);
    sidebar.selectors[":scope > p"] = [];
    assert.deepEqual(inspectBlooketDetailSidebar("fixture"), {
      ok: true, value: { title: "Synthetic fixture", description: "" },
    });
    title.getBoundingClientRect = () => ({ width: 0, height: 0 });
    assert.equal(inspectBlooketDetailSidebar("fixture").ok, false);
    title.getBoundingClientRect = () => ({ width: 20, height: 20 });
    document.selectors[
      '[role="dialog"][aria-modal="true"] h3'
    ] = [node("H3", "Select your organization")];
    assert.equal(inspectBlooketDetailSidebar("fixture").ok, false);
  });
  page(document, "https://dashboard.blooket.com/edit?id=other", () => {
    assert.equal(inspectBlooketDetailSidebar("fixture").ok, false);
  });
});

test("Edit Info read survives the recovered sidebar mount transition", () => {
  const { document, main } = base();
  const heading = node("H1", "Synthetic fixture");
  const headingBox = node("DIV");
  const sidebar = node("DIV");
  heading.parentElement = headingBox;
  headingBox.parentElement = sidebar;
  sidebar.selectors[":scope > p"] = [node("P", "Original text")];
  main.selectors["h1"] = [heading];
  const edit = node("BUTTON", "Edit Info");
  main.selectors["button"] = [edit];
  document.selectors["main button"] = [edit];
  const form = node("FORM");
  const id = node("INPUT", "", { type: "hidden" });
  id.value = "fixture";
  form.selectors['input[type="hidden"][name="setId"]'] = [id];
  const title = node("INPUT");
  title.value = "Synthetic fixture";
  const desc = node("TEXTAREA");
  desc.value = "Original text";
  const privacy = node("INPUT", "", {
    type: "checkbox", role: "switch", "aria-checked": "false",
  });
  privacy.labels = [privacyLabel("Private (Only playable by you)")];
  form.selectors['input#title[name="title"]'] = [title];
  form.selectors['textarea#desc[name="desc"]'] = [desc];
  form.selectors['input#private[name="private"]'] = [privacy];
  document.selectors['form#question-set-form'] = [form];
  const editing = node("P", "EDITING SET DETAILS");
  const editHeader = node("DIV");
  editing.parentElement = editHeader;
  const cancel = node("BUTTON", "", { type: "button" });
  editHeader.selectors['button[type="button"]'] = [cancel];
  let opened = 0;
  let closed = 0;
  const visible = () => ({ width: 20, height: 20 });
  const hidden = () => ({ width: 0, height: 0 });
  title.getBoundingClientRect = hidden;
  edit.click = () => {
    opened++;
    title.getBoundingClientRect = visible;
    main.selectors["h1"] = []; // The recovered sidebar unmounts.
    main.selectors["p"] = [editing];
    document.selectors["main p"] = [editing];
    document.selectors["main button"] = [];
  };
  cancel.click = () => {
    closed++;
    title.getBoundingClientRect = hidden;
    main.selectors["h1"] = [heading];
    main.selectors["p"] = [];
    document.selectors["main p"] = [];
    document.selectors["main button"] = [edit];
  };
  // Chrome separately serializes each function into one isolated world.
  const injectedOpen = Function(
    "return (" + openBlooketDetailPanel.toString() + ")",
  )() as typeof openBlooketDetailPanel;
  const injectedClose = Function(
    "return (" + closeBlooketDetailPanel.toString() + ")",
  )() as typeof closeBlooketDetailPanel;
  page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
    const sidebarResult = inspectBlooketDetailSidebar("fixture");
    assert.deepEqual(sidebarResult, { ok: true, value: {
      title: "Synthetic fixture", description: "Original text",
    } });
    assert.equal(injectedOpen("fixture"), true);
    assert.equal(opened, 1);
    assert.equal(inspectBlooketDetailSidebar("fixture").ok, false);
    const detail = inspectBlooketPage({ kind: "sets.get", setId: "fixture" });
    assert.deepEqual(detail, { ok: true, value: {
      schemaVersion: 1, id: "fixture", title: "Synthetic fixture",
      description: "Original text", visibility: "private",
    } });
    assert.equal(injectedClose("fixture",
      sidebarResult.ok ? sidebarResult.value as {
        title: string; description: string
      } : { title: "", description: "" },
      { title: "Synthetic fixture", description: "Original text",
        visibility: "private" }), true);
    assert.equal(closed, 1);
    assert.equal(isBlooketDetailPanelClosed("fixture"), true);
    // A human action after the agent reopens the panel makes even a
    // byte-for-byte unchanged form unsafe to discard.
    assert.equal(injectedOpen("fixture"), true);
    document.dispatchTrusted("pointerdown");
    assert.equal(injectedClose("fixture", {
      title: "Synthetic fixture", description: "Original text",
    }, {
      title: "Synthetic fixture", description: "Original text",
      visibility: "private",
    }), false);
    assert.equal(closed, 1);
    document.dispatchTrusted("change");
    assert.equal(injectedClose("fixture", {
      title: "Synthetic fixture", description: "Original text",
    }, {
      title: "Synthetic fixture", description: "Original text",
      visibility: "private",
    }), false);
    assert.equal(closed, 1);
  });
});
