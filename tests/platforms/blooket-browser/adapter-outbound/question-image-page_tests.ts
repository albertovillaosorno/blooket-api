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
//   - Synthetic regressions for bounded saved-question image identity reads.
// - Must-Not:
//   - Contact Blooket, use account media, or submit forms.
// - Allows:
//   - Inputs: Owned synthetic forms and controlled response streams.
//   - Outputs: Exact digest, unknown evidence, and ownership-stop assertions.
//   - Side effects: Restored test-local browser and fetch globals.
// - Split-When:
//   - Another media family needs separate authority fixtures.
// - Merge-When:
//   - Question image reads no longer use an injected helper.
// - Summary:
//   - Exercises the actual serialized browser helper without a network.
// - Description:
//   - Covers streaming bounds, route drift, and human-interaction ownership.
// - Usage:
//   - Run with the repository Node test runner.
// - Defaults:
//   - Any unproven authority or content remains unconfirmed.
//
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inspectOpenedBlooketQuestionImage } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/blooket-browser/adapter-outbound/question-image-page.ts";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const failed = { ok: false, code: "blooket-browser-failed" };
const unknown = { ok: true, value: null };
const serialized = (0, eval)("(" +
  inspectOpenedBlooketQuestionImage.toString() + ")") as
  typeof inspectOpenedBlooketQuestionImage;

function node(tagName: string, textContent = "", type = "") {
  return {
    tagName, textContent, disabled: false, value: "",
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    getAttribute: (name: string) => name === "type" ? type : null,
  };
}

async function fixture(
  run: (state: ReturnType<typeof setup>) => Promise<void>,
): Promise<void> {
  const state = setup();
  const names = ["document", "location", "fetch", "__blooketQuestionEditWatch"];
  const previous = names.map(name =>
    Object.getOwnPropertyDescriptor(globalThis, name));
  const values = [state.document, state.location,
    state.fetch, state.watch];
  for (const [i, name] of names.entries()) Object.defineProperty(
    globalThis, name, { configurable: true, writable: true, value: values[i] },
  );
  try { await run(state); }
  finally {
    for (const [i, name] of names.entries()) {
      if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

function setup() {
  const raw = () => JSON.stringify({
    number: 1, image: "https://media.blooket.com/synthetic.png",
  });
  const identity = { ...node("INPUT", "", "hidden"), value: "fixture" };
  const save = node("BUTTON", "Save Question", "submit");
  const cancel = node("BUTTON", "Cancel", "button");
  const form = {
    tagName: "FORM",
    querySelectorAll: (selector: string) => {
      if (selector === 'input#setId[name="setId"]') return [identity];
      if (selector === 'button[type="submit"]') return [save];
      if (selector === 'button[type="button"]') return [cancel];
      return [];
    },
  };
  const hidden = {
    ...node("INPUT", "", "hidden"), value: raw(), closest: () => form,
  };
  const main = node("MAIN");
  const nav = node("A", "My Sets");
  const logout = node("A", "Logout");
  const extra: Record<string, ReturnType<typeof node>[]> = {};
  const document = {
    title: "Blooket",
    querySelectorAll: (selector: string): unknown[] => {
      if (selector in extra) return extra[selector]!;
      if (selector === 'input#question[name="question"]') return [hidden];
      if (selector === "main") return [main];
      if (selector === 'nav a[href="/my-sets"]') return [nav];
      if (selector === 'a[href="https://id.blooket.com/logout"]')
        return [logout];
      return [];
    },
    querySelector: (selector: string): unknown =>
      document.querySelectorAll(selector)[0] ?? null,
  };
  const watch = { document, setId: "fixture", number: 1, dirty: false };
  const calls: { url: string; init: RequestInit }[] = [];
  const state = {
    document, watch, hidden, identity, extra, save, logout, calls,
    location: new URL("https://dashboard.blooket.com/edit?id=fixture"),
    response: async () => new Response(png),
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return state.response();
    },
  };
  return state;
}

test("serialized helper hashes bounded bytes with no credential or referrer",
  async () => fixture(async state => {
    assert.deepEqual(await serialized("fixture", 1, 1_000), {
      ok: true, value: {
        byteLength: png.length,
        sha256: createHash("sha256").update(png).digest("hex"),
      },
    });
    assert.equal(state.calls.length, 1);
    const init = state.calls[0]!.init;
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal?.aborted); // Fetch ownership ended in finally.
  }),
);

test("untrusted URLs remain unknown without a request", async () => {
  for (const image of [
    "https://evil.invalid/test.png", "http://media.blooket.com/test.png",
    "https://media.blooket.com:444/test.png",
    "https://user:password@media.blooket.com/test.png",
    "https://media.blooket.com/test.png#fragment", "blob:synthetic", "bad-url",
  ]) await fixture(async state => {
    state.hidden.value = JSON.stringify({ number: 1, image });
    assert.deepEqual(await serialized("fixture", 1, 1_000), unknown);
    assert.equal(state.calls.length, 0);
  });
});

test("unowned, challenged, ambiguous, or edited forms never start fetching",
  async () => {
    const variants = [
      (state: ReturnType<typeof setup>) => { state.watch.dirty = true; },
      (state: ReturnType<typeof setup>) => { state.watch.number = 2; },
      (state: ReturnType<typeof setup>) => { state.identity.value = "other"; },
      (state: ReturnType<typeof setup>) => { state.save.disabled = true; },
      (state: ReturnType<typeof setup>) => {
        state.document.title = "Just a moment...";
      },
      (state: ReturnType<typeof setup>) => {
        state.extra['input[type="password"]'] = [node("INPUT")];
      },
      (state: ReturnType<typeof setup>) => {
        state.extra['input#question[name="question"]'] = [];
      },
      (state: ReturnType<typeof setup>) => {
        state.extra[
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
        ] = [node("IFRAME")];
      },
      (state: ReturnType<typeof setup>) => {
        state.extra['[role="dialog"][aria-modal="true"] h3'] = [
          node("H3", "Select your organization"),
        ];
      },
    ];
    for (const mutate of variants) await fixture(async state => {
      mutate(state);
      assert.deepEqual(await serialized("fixture", 1, 1_000), failed);
      assert.equal(state.calls.length, 0);
    });
  },
);

test("tiny or endless chunks cannot accumulate unbounded stream metadata",
  async () => {
    for (const size of [0, 1]) await fixture(async state => {
      let canceled = 0;
      state.response = async () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(size)); },
        cancel() { canceled++; },
      }));
      assert.deepEqual(await serialized("fixture", 1, 1_000), unknown);
      assert.equal(canceled, 1);
    });
  },
);

test("route, watch, or raw form drift during fetch discards the digest",
  async () => {
    for (const mutate of [
      (state: ReturnType<typeof setup>) => { state.watch.dirty = true; },
      (state: ReturnType<typeof setup>) => {
        state.hidden.value = JSON.stringify({ number: 1, image: "changed" });
      },
      (state: ReturnType<typeof setup>) => {
        state.location.pathname = "/my-sets";
      },
      () => {
        Reflect.deleteProperty(globalThis, "__blooketQuestionEditWatch");
      },
    ]) await fixture(async state => {
      state.response = async () => { mutate(state); return new Response(png); };
      assert.deepEqual(await serialized("fixture", 1, 1_000), failed);
      assert.equal(state.calls.length, 1);
    });
  },
);

test("streamed body overflow, bad lengths, and non-images remain unknown",
  async () => {
    for (const response of [
      () => new Response(new Uint8Array(2_500_000)),
      () => new Response(png, { headers: { "content-length": "2500000" } }),
      () => new Response(png, { headers: { "content-length": "1" } }),
      () => new Response(png, { headers: { "content-length": "oops" } }),
      () => new Response("not an image"),
      () => new Response(null),
      () => new Response(png, { status: 403 }),
    ]) await fixture(async state => {
      state.response = async () => response();
      assert.deepEqual(await serialized("fixture", 1, 1_000), unknown);
      assert.equal(state.calls.length, 1);
    });
  },
);

test("response stream interaction stops evidence and cancels the stream",
  async () => fixture(async state => {
    let canceled = 0;
    state.response = async () => new Response(new ReadableStream({
      pull(controller) { state.watch.dirty = true; controller.enqueue(png); },
      cancel() { canceled++; },
    }));
    assert.deepEqual(await serialized("fixture", 1, 1_000), failed);
    assert.equal(canceled, 1);
  }),
);

test("a timed-out image remains unknown and never extends its budget",
  async () => fixture(async state => {
    state.response = async () => await new Promise((_, reject) => {
      state.calls[0]!.init.signal!.addEventListener("abort", () =>
        reject(new Error("synthetic-abort")), { once: true });
    });
    assert.deepEqual(await serialized("fixture", 1, 5), unknown);
    assert.equal(state.calls.length, 1);
  }),
);
