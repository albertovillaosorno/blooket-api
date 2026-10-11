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
  decodeFlightActionRevalidated,
  decodeFlightActionResponseMetadata,
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
    "0:{}\n00:{}\n",
    "00:{}\n",
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

test("direct cyclic object graphs cannot bypass Flight cycle checks", () => {
  const object: { self?: unknown } = {};
  object.self = object;
  const array: unknown[] = [];
  array.push(array);
  const mixed: { children: unknown[] } = { children: [] };
  mixed.children.push(mixed);
  for (const value of [object, array, mixed]) {
    assert.throws(() => flightObjects(new Map([["0", value]])),
      /flight-cycle/u);
  }
  // Reusing a fully resolved object is not a cycle and preserves identity.
  const shared = { title: "Fictional" };
  const resolved = flightObjects(new Map([["0", [shared, shared]]]));
  assert.deepEqual(resolved, [{ title: "Fictional" }]);
});

test("ordinary JSON cannot impersonate a tagged Flight error row", () => {
  const ordinary = '0:{"kind":"error","digest":"fixture-digest"}\n';
  const extended =
    '0:{"kind":"error","digest":"fixture-digest","extra":"hidden"}\n';
  for (const source of [ordinary, extended]) {
    assert.deepEqual(flightErrorRecords(source), []);
    assert.equal(flightObjects(decodeFlightRows(source)).length, 1);
  }
  const forged = { kind: "error", digest: "direct" };
  assert.deepEqual(flightObjects(new Map([["0", forged]])), [forged]);
});

test("Flight object copying preserves dangerous keys as own data", () => {
  const source = '0:{"title":"Fictional","__proto__":' +
    '{"polluted":true}}\n';
  const rows = decodeFlightRows(source);
  const values = flightObjects(rows);
  const object = values.find(value => value["title"] === "Fictional")!;
  assert.equal(Object.getPrototypeOf(object), Object.prototype);
  assert.equal(Object.hasOwn(object, "__proto__"), true);
  assert.deepEqual(object["__proto__"], { polluted: true });
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
  const forged = '0:{"status":"SUCCESS","message":"",' +
    '"fieldErrors":{},"__proto__":{"hidden":true}}\n';
  assert.equal(flightActionState(forged), undefined);
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

test("action field-error keys remain owned instead of changing prototypes",
  () => {
  const source = '0:{"status":"ERROR","message":"Fixture",' +
    '"fieldErrors":{"__proto__":["Fictional issue"]}}\n';
  const state = flightActionState(source);
  assert.ok(state);
  assert.equal(Object.getPrototypeOf(state.fieldErrors), Object.prototype);
  assert.equal(Object.hasOwn(state.fieldErrors, "__proto__"), true);
  assert.deepEqual(state.fieldErrors["__proto__"], ["Fictional issue"]);
  assert.deepEqual(Object.keys(state.fieldErrors), ["__proto__"]);
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

test("action revalidation metadata preserves exact zero-or-one wire flags",
  () => {
  assert.deepEqual(decodeFlightActionRevalidated(null), {
    paths: [],
    tag: 0,
    cookie: 0,
  });
  assert.deepEqual(
    decodeFlightActionRevalidated('[["/sets","/edit"],1,0]'),
    { paths: ["/sets", "/edit"], tag: 1, cookie: 0 },
  );
  for (const value of [
    "{}",
    "[[],0]",
    "[[],true,0]",
    "[[],0,false]",
    "[[1],0,0]",
    '[[""],0,0]',
    "[[],2,0]",
    "[[],0,-1]",
  ])
    assert.throws(
      () => decodeFlightActionRevalidated(value),
      /invalid-flight-revalidated/u,
    );
});

test("action response metadata keeps exact RSC content-type semantics", () => {
  assert.deepEqual(
    decodeFlightActionResponseMetadata({
      contentType: "text/x-component",
      redirect: "/edit?id=fixture",
      revalidated: '[["/sets"],1,0]',
    }),
    {
      hasFlightBody: true,
      redirect: { pathname: "/edit", search: "?id=fixture", hash: "" },
      revalidated: { paths: ["/sets"], tag: 1, cookie: 0 },
    },
  );
  assert.deepEqual(
    decodeFlightActionResponseMetadata({
      contentType: null,
      redirect: null,
      revalidated: null,
    }),
    {
      hasFlightBody: false,
      redirect: null,
      revalidated: { paths: [], tag: 0, cookie: 0 },
    },
  );
  assert.equal(
    decodeFlightActionResponseMetadata({
      contentType: "text/x-component; charset=utf-8",
      redirect: null,
      revalidated: null,
    }).hasFlightBody,
    false,
  );
  assert.throws(
    () =>
      decodeFlightActionResponseMetadata({
        contentType: "text/x-component\r\nset-cookie: nope",
        redirect: null,
        revalidated: null,
      }),
    /invalid-flight-content-type/u,
  );
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
