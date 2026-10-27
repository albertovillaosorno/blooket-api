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
//   - Native control preparation and one guarded existing-text Save.
// - Must-Not:
//   - Upload media, alter hidden serialization, or repeat a submitted Save.
// - Allows:
//   - Inputs: Validated text revision and exact read-owned native form.
//   - Outputs: Prepared media identity, verification or one submission.
//   - Side effects: Visible text controls, correctness toggles and one Save.
// - Split-When:
//   - Provider text editors require independently versioned controls.
// - Merge-When:
//   - All existing-question editing shares native control ownership.
// - Summary:
//   - Corrects text while retaining the provider's existing media fields.
// - Description:
//   - The original serialized non-text fields must remain exact.
// - Usage:
//   - Inject only into the dedicated admitted Blooket edit document.
// - Defaults:
//   - Foreign forms, human dialogs, drift and repeated Save refuse action.
//
import assert from "node:assert/strict";
import test from "node:test";
import { runBlooketTextRevisionPageAction as action } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/blooket-browser/adapter-outbound/text-revision-page.ts";
import type { BlooketTextRevision } from
  "../../../../src/ir/blooket-publication-commands/contract/text-revision.ts";

class Control {
  id = ""; name = ""; checked = false; form: Control | undefined;
  attributes: Record<string, string> = {};
  tagName = "INPUT"; type = "text"; value = ""; disabled = false;
  readOnly = false; maxLength = -1; isConnected = true; textContent = "";
  parent: Control | undefined;
  selectors: Record<string, Control[]> = {};
  onEvent = () => {}; onClick = () => {};
  querySelectorAll(s: string) { return this.selectors[s] ?? []; }
  querySelector(s: string) { return this.querySelectorAll(s)[0] ?? null; }
  closest() { return this.parent ?? null; }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  getBoundingClientRect() { return { width: 100, height: 25 }; }
  dispatchEvent() { this.onEvent(); return true; }
  click() { this.onClick(); }
}
const input: BlooketTextRevision = { schemaVersion: 1,
  expectedSet: { schemaVersion: 1, id: "fixture", title: "Synthetic",
    description: "", visibility: "private" },
  change: { kind: "question-text", question: "Correct spelling",
    answers: ["Girl", "Boy"], previous: { schemaVersion: 4,
      number: 1, question: "a word", equation: null, qType: "mc",
      random: true, timeLimit: 20, hasImage: true, hasAudio: false,
      imageEvidence: null,
      answers: [{ kind: "text", content: "Gril", correct: true, match: null },
        { kind: "text", content: "Boy", correct: false, match: null }],
    } } };

async function fixture(run: (state: {
  raw: Record<string, unknown>; owner: { dirty: boolean };
  document: Control; prompt: Control; saves(): number;
  throwOnSave(): void; cancellations(): number;
}) => Promise<void>, kind: "question" | "title" = "question") {
  const document = new Control() as Control & { title: string };
  document.title = "Edit Set | Blooket";
  const form = new Control(); form.tagName = "FORM";
  const hidden = new Control(); hidden.type = "hidden"; hidden.parent = form;
  const raw = { number: 1, question: "a word", answers: ["Gril", "Boy"],
    correctAnswers: ["Gril"], image: "https://example.invalid/saved.png",
    audio: "", qType: "mc", random: true, answerTypes: [], timeLimit: 20,
    providerField: "retain" };
  Object.defineProperty(hidden, "value", { get: () => JSON.stringify(raw) });
  const prompt = new Control(); prompt.tagName = "TEXTAREA";
  prompt.value = raw.question;
  prompt.onEvent = () => { raw.question = prompt.value; };
  form.selectors["textarea#question"] = [prompt];
  raw.answers.forEach((text, i) => {
    const node = new Control(); node.tagName = "TEXTAREA"; node.value = text;
    node.onEvent = () => { raw.answers[i] = node.value; };
    form.selectors["textarea#answer-" + i] = [node];
    const button = new Control(); button.tagName = "BUTTON";
    button.onClick = () => {
      const text = raw.answers[i]!;
      raw.correctAnswers = raw.correctAnswers.includes(text)
        ? raw.correctAnswers.filter(a => a !== text)
        : [...raw.correctAnswers, text];
    };
    form.selectors['button[aria-label="Mark Answer ' + (i + 1) +
      ' as Correct"]'] = [button];
  });
  let saves = 0, throwSave = false, cancellations = 0;
  const cancel = new Control(); cancel.tagName = "BUTTON";
  cancel.textContent = "Cancel";
  cancel.onClick = () => { cancellations++; };
  form.selectors['button[type="button"]'] = [cancel];
  const save = new Control(); save.tagName = "BUTTON";
  save.textContent = "Save Question";
  save.onClick = () => { saves++; if (throwSave) throw Error("lost reply"); };
  form.selectors['button[type="submit"]'] = [save];
  if (kind === "title") {
    const title = new Control(); title.id = "title"; title.name = "title";
    title.value = "Synthetic";
    const desc = new Control(); desc.tagName = "TEXTAREA";
    desc.id = "desc"; desc.name = "desc";
    const privacy = new Control(); privacy.type = "checkbox";
    privacy.id = "private"; privacy.name = "private";
    privacy.attributes["aria-checked"] = "false";
    const id = new Control(); id.type = "hidden"; id.name = "setId";
    id.value = "fixture";
    form.selectors['input[type="hidden"][name="setId"]'] = [id];
    form.selectors['input#title[name="title"]'] = [title];
    form.selectors['textarea#desc[name="desc"]'] = [desc];
    form.selectors['input#private[name="private"]'] = [privacy];
    form.selectors["input,textarea,select"] = [id, title, desc, privacy];
    document.selectors["form#question-set-form"] = [form];
    save.textContent = "Done"; save.form = form;
    document.selectors['button[type="submit"]'] = [save];
    form.selectors['button[type="submit"]'] = [];
  }
  const main = new Control(), nav = new Control(), logout = new Control();
  logout.textContent = "Logout";
  document.selectors["main"] = [main];
  document.selectors['nav a[href="/my-sets"]'] = [nav];
  document.selectors['a[href="https://id.blooket.com/logout"]'] = [logout];
  document.selectors['input#question[name="question"]'] = [hidden];
  if (kind === "question") {
    const modal = new Control(); modal.tagName = "DIV";
    form.parent = modal;
    document.selectors['[role="dialog"][aria-modal="true"]'] = [modal];
  }
  const owner = { document, setId: "fixture", number: 1, dirty: false,
    dispose() {} };
  class NativeControl {}
  Object.defineProperty(NativeControl.prototype, "value", {
    set(this: Control, value: string) { this.value = value; },
  });
  const values: Record<string, unknown> = { document,
    location: new URL("https://dashboard.blooket.com/edit?id=fixture"),
    HTMLInputElement: NativeControl, HTMLTextAreaElement: NativeControl,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    __blooketQuestionEditWatch: owner, __blooketTextRevisionWatch: undefined,
    __blooketDetailEditWatch: owner,
  };
  const before = new Map(Object.keys(values).map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true,
      writable: true, value });
  try { await run({ raw, owner, document, prompt, saves: () => saves,
    throwOnSave: () => { throwSave = true; },
    cancellations: () => cancellations }); }
  finally {
    for (const [name, descriptor] of before)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
  }
}

test("image-preserving correction uses native text and only one Save",
  async () => fixture(async page => {
    const before = page.raw["image"];
    const prepared = await action("prepare", input);
    assert.equal(prepared.ok, true);
    assert.equal(page.saves(), 0);
    assert.equal(page.raw["image"], before);
    assert.equal(page.raw["providerField"], "retain");
    assert.deepEqual(page.raw["correctAnswers"], ["Girl"]);
    assert.deepEqual(await action("submit", input), { ok: true });
    assert.deepEqual(await action("submit", input), { ok: false });
    assert.equal(page.saves(), 1);
  }));

test("media changes, human prompts and trusted input stop before Save",
  async () => {
    await fixture(async page => {
      assert.equal((await action("prepare", input)).ok, true);
      page.raw["image"] = "https://example.invalid/other.png";
      assert.deepEqual(await action("submit", input), { ok: false });
      assert.equal(page.saves(), 0);
    });
    await fixture(async page => {
      page.owner.dirty = true;
      assert.equal((await action("prepare", input)).ok, false);
      assert.equal(page.raw["question"], "a word");
    });
    await fixture(async page => {
      page.document.selectors['[role="alertdialog"]'] = [new Control()];
      assert.equal((await action("prepare", input)).ok, false);
      assert.equal(page.saves(), 0);
    });
    await fixture(async page => {
      page.document.selectors['[role="dialog"][aria-modal="true"]']!
        .push(new Control());
      assert.equal((await action("prepare", input)).ok, false);
      assert.equal(page.saves(), 0);
    });
  });

test("an exception from Save remains an uncertain single attempt",
  async () => fixture(async page => {
    assert.equal((await action("prepare", input)).ok, true);
    page.throwOnSave();
    await assert.rejects(action("submit", input), /lost reply/u);
    assert.deepEqual(await action("submit", input), { ok: false });
    assert.equal(page.saves(), 1);
  }));

test("title correction uses Done's explicit external form association",
  async () => fixture(async page => {
    const request: BlooketTextRevision = { ...input,
      change: { kind: "set-title", title: "B.1.01 - Vocabulary of Lesson 1" } };
    assert.equal((await action("prepare", request)).ok, true);
    assert.deepEqual(await action("submit", request), { ok: true });
    assert.equal(page.saves(), 1);
    assert.deepEqual(await action("submit", request), { ok: false });
  }, "title"));

test("an externally associated foreign Done cannot receive Save",
  async () => fixture(async page => {
    const request: BlooketTextRevision = { ...input,
      change: { kind: "set-title", title: "B.1.01 - Vocabulary of Lesson 1" } };
    assert.equal((await action("prepare", request)).ok, true);
    page.document.selectors['button[type="submit"]']![0]!.form = new Control();
    assert.deepEqual(await action("submit", request), { ok: false });
    assert.equal(page.saves(), 0);
  }, "title"));


test("retained form cleanup requires its exact media identity and clean owner",
  async () => fixture(async page => {
    const prepared = await action("prepare", input);
    assert.equal(prepared.ok, true);
    assert.equal((await action("inspect-pending", input)).ok, false);
    assert.equal((await action("submit", input)).ok, true);
    const pending = await action("inspect-pending", input);
    assert.equal(pending.ok, true);
    assert.equal((await action("release-confirmed", input)).ok, false);
    assert.equal((await action("release-confirmed", input,
      "b".repeat(64))).ok, false);
    assert.equal(page.cancellations(), 0);
    if (!pending.ok) throw Error("missing pending identity");
    page.owner.dirty = true;
    assert.equal((await action("release-confirmed", input,
      pending.mediaIdentity)).ok, false);
    page.owner.dirty = false;
    assert.equal((await action("release-confirmed", input,
      pending.mediaIdentity)).ok, true);
    assert.equal(page.cancellations(), 1);
    assert.equal(page.saves(), 1);
  }));
