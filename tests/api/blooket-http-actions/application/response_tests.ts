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
//   - Synthetic tests for bounded HTTP action response candidate decoding.
// - Must-Not:
//   - Send requests, claim mutation confirmation, or create write receipts.
// - Allows:
//   - Inputs: Synthetic status, headers, and Flight or opaque response bodies.
//   - Outputs: Exact candidate evidence and stable failure assertions.
//   - Side effects: None.
// - Split-When:
//   - Verified provider response families require independent fixtures.
// - Merge-When:
//   - HTTP action candidates are removed.
// - Summary:
//   - Proves status and SUCCESS remain evidence rather than confirmation.
// - Description:
//   - Fixtures use only synthetic set paths and messages.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Non-RSC bodies are never interpreted as Flight.
//
import assert from "node:assert/strict";
import test from "node:test";
import { decodeBlooketHttpActionResponse } from
  "../../../../src/api/blooket-http-actions/application/response.ts";

function stateRow(status: "SUCCESS" | "ERROR" | "UNSET"): string {
  return "0:" + JSON.stringify({
    status,
    message: status === "SUCCESS" ? "" : "Synthetic message",
    fieldErrors: {},
  }) + "\n";
}

test("RSC response exposes bounded evidence without confirming a write", () => {
  const decoded = decodeBlooketHttpActionResponse({
    status: 200,
    contentType: "text/x-component",
    redirect: "/edit?id=synthetic",
    revalidated: '[["/edit"],1,0]',
    body: stateRow("SUCCESS"),
  });
  assert.deepEqual(decoded, {
    ok: true,
    value: {
      status: 200,
      metadata: {
        hasFlightBody: true,
        redirect: {
          pathname: "/edit",
          search: "?id=synthetic",
          hash: "",
        },
        revalidated: {
          paths: ["/edit"],
          tag: 1,
          cookie: 0,
        },
      },
      actionState: {
        status: "SUCCESS",
        message: "",
        fieldErrors: {},
      },
      errorDigests: [],
    },
  });
  if (!decoded.ok) return;
  assert.equal("confirmed" in decoded.value, false);
  assert.equal("receipt" in decoded.value, false);
});

test(
  "non-RSC bodies stay opaque even when they look like malformed Flight",
  () => {
  const decoded = decodeBlooketHttpActionResponse({
    status: 200,
    contentType: "application/json",
    redirect: null,
    revalidated: null,
    body: "not-flight-at-all",
  });
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.metadata.hasFlightBody, false);
  assert.equal(decoded.value.actionState, null);
  assert.deepEqual(decoded.value.errorDigests, []);
  },
);

test("RSC errors expose only bounded digests", () => {
  const decoded = decodeBlooketHttpActionResponse({
    status: 500,
    contentType: "text/x-component",
    redirect: null,
    revalidated: null,
    body: '0:E{"digest":"synthetic-digest"}\n',
  });
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.actionState, null);
  assert.deepEqual(decoded.value.errorDigests, ["synthetic-digest"]);
});

test("invalid status metadata and Flight body fail with stable codes", () => {
  assert.deepEqual(
    decodeBlooketHttpActionResponse({
      status: 99,
      contentType: null,
      redirect: null,
      revalidated: null,
      body: "",
    }),
    { ok: false, code: "invalid-http-action-status" },
  );
  assert.deepEqual(
    decodeBlooketHttpActionResponse({
      status: 200,
      contentType: "text/x-component",
      redirect: "https://example.invalid/edit",
      revalidated: null,
      body: stateRow("SUCCESS"),
    }),
    { ok: false, code: "invalid-http-action-metadata" },
  );
  assert.deepEqual(
    decodeBlooketHttpActionResponse({
      status: 200,
      contentType: "text/x-component",
      redirect: null,
      revalidated: null,
      body: "{bad",
    }),
    { ok: false, code: "invalid-http-action-body" },
  );
});
