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
//   - Regression evidence for bounded production Flight candidate decoding.
// - Must-Not:
//   - Perform network requests or treat a decoded candidate as write success.
// - Allows:
//   - Inputs: Synthetic Flight rows and action redirect headers.
//   - Outputs: Exact decoded candidates or stable failures.
//   - Side effects: None.
// - Split-When:
//   - Another Flight protocol version needs independent fixtures.
// - Merge-When:
//   - Candidate Flight decoding is removed.
// - Summary:
//   - Proves framing, references, cycles, states, errors, and redirects.
// - Description:
//   - Fixtures contain no account or lesson data.
// - Usage:
//   - Run with the repository Node test suite.
// - Defaults:
//   - Unsupported tags and reference kinds fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFlightActionRedirect,
  decodeFlightRows,
  flightActionState,
  flightErrorRecords,
  flightObjects,
} from "../../../../src/ir/blooket-flight-records/contract/flight.ts";

const action = {
  status: "SUCCESS",
  message: "",
  fieldErrors: {},
};

test("Flight rows decode exact JSON and byte-length text", () => {
  const text = "sol ☀️";
  const length = Buffer.byteLength(text).toString(16);
  const source =
    "0:" +
    JSON.stringify({ action: "$1", repeated: "$1", literal: "$$1" }) +
    "\n1:" +
    JSON.stringify(action) +
    "\n2:T" +
    length +
    "," +
    text;
  const rows = decodeFlightRows(source);
  assert.equal(rows.get("2"), text);
  const objects = flightObjects(rows);
  const root = objects.find((value) => "action" in value)!;
  assert.deepEqual(root["action"], action);
  assert.strictEqual(root["action"], root["repeated"]);
  assert.equal(root["literal"], "$1");
});

test("Flight framing rejects malformed lengths JSON IDs and duplicates", () => {
  for (const source of [
    "0:T1g,x",
    "0:T4,abc",
    "0:{bad}\n",
    "g:{}\n",
    "0:{}\n0:{}\n",
    "0:{}",
    "0:I{}\n",
  ])
    assert.throws(() => decodeFlightRows(source));
});

test("Flight references reject missing unsupported and cyclic graphs", () => {
  assert.throws(
    () => flightObjects(decodeFlightRows('0:"$1"\n')),
    /missing-flight-reference/u,
  );
  assert.throws(
    () => flightObjects(decodeFlightRows('0:"$@1"\n1:{}\n')),
    /unsupported-flight-reference/u,
  );
  assert.throws(
    () => flightObjects(decodeFlightRows('0:"$1"\n1:"$0"\n')),
    /flight-cycle/u,
  );
});

test("action state validation is exact and never coerces primitives", () => {
  const row = (value: unknown) => "0:" + JSON.stringify(value) + "\n";
  assert.deepEqual(flightActionState(row(action)), action);
  assert.equal(
    flightActionState(row({ ...action, status: 1 })),
    undefined,
  );
  assert.equal(
    flightActionState(row({ ...action, extra: true })),
    undefined,
  );
  assert.equal(
    flightActionState(row({ ...action, fieldErrors: { title: [1] } })),
    undefined,
  );
});

test("error rows expose only a bounded digest", () => {
  assert.deepEqual(
    flightErrorRecords('0:E{"digest":"synthetic-digest"}\n'),
    [{ kind: "error", digest: "synthetic-digest" }],
  );
  for (const source of [
    '0:E{"message":"private"}\n',
    "0:E{}\n",
    "0:E{bad}\n",
  ])
    assert.throws(() => flightErrorRecords(source), /invalid-flight-error/u);
});

test("action redirects are same-origin HTTPS metadata, not Flight rows", () => {
  assert.deepEqual(decodeFlightActionRedirect("/edit?id=fixture#top"), {
    pathname: "/edit",
    search: "?id=fixture",
    hash: "#top",
  });
  assert.equal(decodeFlightActionRedirect(null), null);
  for (const value of [
    "https://example.invalid/edit",
    "http://dashboard.blooket.com/edit",
    "https://user:secret@dashboard.blooket.com/edit",
  ])
    assert.throws(
      () => decodeFlightActionRedirect(value),
      /invalid-flight-redirect/u,
    );
});
