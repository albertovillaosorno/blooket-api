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
//   - Synthetic initial-model capture and script framing regressions.
// - Must-Not:
//   - Launch a browser, reload account pages, or contact Blooket.
// - Allows:
//   - Inputs: Fictional DOM script packets and resource build identities.
//   - Outputs: Bounded local captures and fail-closed assertions.
//   - Side effects: Temporary globals restored after each fixture.
// - Split-When:
//   - Another browser requires a different identity primitive.
// - Merge-When:
//   - Native browser tests independently own these admission cases.
// - Summary:
//   - Admits exact observed packet framing without executing scripts.
// - Description:
//   - The captured envelope never establishes collection completeness.
// - Usage:
//   - Run through the repository Node test suite.
// - Defaults:
//   - Incomplete and malformed document observations fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { captureBlooketLibraryModel } from
  // jig-ignore-next-line: Mirrored source path is required for these tests.
  "../../../../src/platforms/blooket-browser/adapter-outbound/library-model-page.ts";

const BUILD = "349b82c80fc4a5a2001e609136cfed32747ba3f4";
const BOOTSTRAP = "(self.__next_f=self.__next_f||[]).push([0]);";
const push = (value: unknown) => "self.__next_f.push(" +
  JSON.stringify(value) + ")";

function fixture(options: {
  readonly scripts?: readonly string[];
  readonly builds?: readonly string[];
  readonly url?: string;
  readonly readyState?: string;
} = {}) {
  const values = {
    location: { href: options.url ??
      "https://dashboard.blooket.com/my-sets" },
    document: {
      readyState: options.readyState ?? "complete",
      scripts: (options.scripts ?? [
        BOOTSTRAP + push([1, "0:{}\n"]), push([1, "1:{}\n"]),
      ]).map(textContent => ({ textContent })),
      querySelectorAll: () => (options.builds ?? [BUILD]).map(build => ({
        getAttribute: (key: string) => key === "href"
          ? "https://ac.blooket.com/dashboard/" + build +
            "/_next/static/css/fixture.css" : null,
      })),
    },
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  try {
    for (const [key, value] of Object.entries(values)) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    return captureBlooketLibraryModel();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("initial combined bootstrap and later packets retain exact model text",
  () => {
  assert.deepEqual(fixture(), { build: BUILD, source: "0:{}\n1:{}\n" });
  const source = '0:"sol ☀️"\n';
  assert.deepEqual(fixture({ scripts: [BOOTSTRAP + push([1, source]) + ";"] }),
    { build: BUILD, source });
  },
);

test("unknown framing and executable suffixes are never interpreted", () => {
  for (const scripts of [
    [push([1, "0:{}\n"])],
    [BOOTSTRAP + push([1, "0:{}\n"]), BOOTSTRAP + push([1, "1:{}\n"])],
    [BOOTSTRAP + push([2, "unknown"])],
    [BOOTSTRAP + push([1, {}])],
    [BOOTSTRAP + push([1, "0:{}\n"]) + ";fictionalSideEffect()"],
    [BOOTSTRAP + "self.__next_f.push(notJson)"],
  ]) assert.equal(fixture({ scripts }), null);
});

test("incomplete, filtered, mixed-build, and excessive pages fail closed",
  () => {
  assert.equal(fixture({ readyState: "loading" }), null);
  assert.equal(fixture({ url:
    "https://dashboard.blooket.com/my-sets?search=sun" }), null);
  assert.equal(fixture({ builds: [] }), null);
  assert.equal(fixture({ builds: [BUILD, "a".repeat(40)] }), null);
  assert.equal(fixture({ scripts: Array.from({ length: 201 }, () => "") }),
    null);
  assert.equal(fixture({ scripts: [
    BOOTSTRAP + push([1, "☀️".repeat(900_000)]),
  ] }), null);
  },
);
