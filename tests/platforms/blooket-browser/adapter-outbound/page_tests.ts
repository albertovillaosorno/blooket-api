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
  selectors: Record<string, FixtureNode[]>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): FixtureNode | null;
  querySelectorAll(selector: string): FixtureNode[];
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
    selectors: {},
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
  const { document } = base();
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
  privacy.labels = [node("LABEL", "Private (Only playable by you)")];
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
    const result = inspectBlooketPage({ kind: "sets.get", setId: "fixture" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(decodeBlooketSetDetail(result.value).ok, true);
    assert.equal(
      inspectBlooketPage({ kind: "sets.get", setId: "other" }).ok,
      false,
    );
    attributes["aria-checked"] = "true";
    privacy.labels = [node("LABEL", "Public (Playable by everyone)")];
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
    privacy.labels = [node("LABEL", "Public (Playable by everyone)")];
    assert.equal(
      inspectBlooketPage({ kind: "sets.get", setId: "fixture" }).ok,
      false,
    );
    privacy.labels = [node("LABEL", "Unknown visibility")];
    assert.equal(
      inspectBlooketPage({ kind: "sets.get", setId: "fixture" }).ok,
      false,
    );
    privacy.labels = [node("LABEL", "Private (Only playable by you)")];
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

test("set detail refuses duplicate set IDs in the current route", () => {
  const { document } = base();
  const title = node("INPUT");
  title.value = "Synthetic fixture";
  const description = node("TEXTAREA");
  description.value = "Original text";
  const privacy = node("INPUT", "", {
    type: "checkbox", role: "switch", "aria-checked": "false",
  });
  privacy.labels = [node("LABEL", "Private (Only playable by you)")];
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
    identity.value = "old-set";
    assert.equal(openBlooketDetailPanel("fixture"), false);
    assert.equal(clicks, 1);
    identity.value = "fixture";
    form.selectors['input#title[name="title"]'] = [title, title];
    assert.equal(openBlooketDetailPanel("fixture"), false);
    assert.equal(clicks, 1);
    form.selectors['input#title[name="title"]'] = [title];
    title.getBoundingClientRect = () => ({ width: 20, height: 20 });
    assert.equal(openBlooketDetailPanel("fixture"), true);
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
    } else {
      document.selectors['a[href="https://id.blooket.com/logout"]'] = [];
    }
    page(document, "https://dashboard.blooket.com/edit?id=fixture", () => {
      assert.equal(openBlooketDetailPanel("fixture"), false);
      assert.equal(clicks, 0);
    });
  }
});
