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
//   - Synthetic exact-route and native document identity regressions.
// - Must-Not:
//   - Launch a browser, reload account pages, or contact Blooket.
// - Allows:
//   - Inputs: Test-local document, location, and performance values.
//   - Outputs: Identity admission and fail-closed assertions.
//   - Side effects: Temporary globals restored after each fixture.
// - Split-When:
//   - Another browser requires a different identity primitive.
// - Merge-When:
//   - Native browser tests independently own these admission cases.
// - Summary:
//   - Rejects stale routes and invalid document time origins.
// - Description:
//   - A valid timestamp is document evidence, never saved quiz evidence.
// - Usage:
//   - Run through the repository Node test suite.
// - Defaults:
//   - Incomplete and malformed document observations fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { inspectBlooketDocumentOrigin } from
  "../../../../src/platforms/blooket-browser/adapter-outbound/document-page.ts";

const SETS = "https://dashboard.blooket.com/my-sets";

function withDocument(
  origin: unknown,
  href: string,
  readyState: string,
  run: () => void,
) {
  const values = {
    location: { href }, document: { readyState },
    performance: { timeOrigin: origin },
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  try {
    for (const [key, value] of Object.entries(values)) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    run();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("only the exact completed dashboard document exposes its origin", () => {
  withDocument(1234.5, SETS, "complete", () => {
    assert.equal(inspectBlooketDocumentOrigin(SETS), 1234.5);
    assert.equal(inspectBlooketDocumentOrigin(SETS + "?search=test"), null);
    assert.equal(inspectBlooketDocumentOrigin("invalid"), null);
  });
  withDocument(1234.5, "https://untrusted.invalid/", "complete", () => {
    assert.equal(inspectBlooketDocumentOrigin("https://untrusted.invalid/"),
      null);
  });
  withDocument(1234.5, SETS, "loading", () => {
    assert.equal(inspectBlooketDocumentOrigin(SETS), null);
  });
});

test("invalid native origins cannot prove a new document", () => {
  for (const origin of [0, -1, NaN, Infinity, "1234", null, undefined]) {
    withDocument(origin, SETS, "complete", () => {
      assert.equal(inspectBlooketDocumentOrigin(SETS), null);
    });
  }
});
