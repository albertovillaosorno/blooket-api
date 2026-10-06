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
//   - Exact response-decoding tests for the local browser bridge.
// - Must-Not:
//   - Launch a browser, store credentials, or accept unknown response fields.
// - Allows:
//   - Inputs: Synthetic extension response candidates.
//   - Outputs: Exact success or structured validation failures.
//   - Side effects: None.
// - Split-When:
//   - Request decoding gains an independent runtime contract.
// - Merge-When:
//   - The local browser bridge no longer uses response envelopes.
// - Summary:
//   - Proves correlation, versioning, and failure codes fail closed.
// - Description:
//   - Raw successful values remain unknown for downstream IR decoders.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Cross-request and malformed extension replies are invalid.
//
import assert from "node:assert/strict";
import test from "node:test";
import { decodeBlooketBrowserBridgeResponse } from
  "../../../../src/ir/blooket-browser-bridge/contract/message.ts";

test("bridge responses preserve unknown successful values", () => {
  const value = { privatePageValue: "opaque" };
  assert.deepEqual(
    decodeBlooketBrowserBridgeResponse({
      schemaVersion: 1,
      id: "request-a",
      ok: true,
      value,
    }, "request-a"),
    {
      ok: true,
      value: {
        schemaVersion: 1,
        id: "request-a",
        ok: true,
        value,
      },
    },
  );
});

test("bridge responses reject cross-request and unknown fields", () => {
  const result = decodeBlooketBrowserBridgeResponse({
    schemaVersion: 1,
    id: "request-b",
    ok: true,
    value: null,
    leakedCookie: "must-not-cross",
  }, "request-a");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "bridge-response-id-mismatch",
      ),
      true,
    );
    assert.equal(
      result.issues.some((issue) => issue.code === "unknown-field"),
      true,
    );
  }
});

test("bridge failures admit only stable browser codes", () => {
  assert.equal(
    decodeBlooketBrowserBridgeResponse({
      schemaVersion: 1,
      id: "request-a",
      ok: false,
      code: "raw-extension-error",
    }, "request-a").ok,
    false,
  );
});
