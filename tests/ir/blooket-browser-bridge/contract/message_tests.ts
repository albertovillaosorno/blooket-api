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
import {
  decodeBlooketBrowserBridgeRequest,
  decodeBlooketBrowserBridgeResponse,
  decodeBlooketBrowserClient,
} from "../../../../src/ir/blooket-browser-bridge/contract/message.ts";

const request = (command: unknown) => ({
  schemaVersion: 1,
  id: "fe101cf0-18c3-4f3f-84a3-b9075029e67f",
  command,
});

test("browser client labels admit only canonical extension roots", () => {
  for (const value of [
    "chrome-extension://fixture-extension/",
    "chrome-extension://fixture-extension/#" +
      "89aa67d6-4253-4013-9a54-68c37ce9e2af",
    "safari-web-extension://FC730C5C-1446-42CF-A5BB-9097337A63D1/",
  ]) assert.deepEqual(decodeBlooketBrowserClient(value), { ok: true, value });
  for (const value of [
    undefined, null, [], ["chrome-extension://fixture/"],
    "chrome-extension://fixture", "chrome-extension://fixture/a",
    "chrome-extension://fixture/?extra=1", "chrome-extension://fixture/#x",
    "chrome-extension://fixture/#89AA67D6-4253-4013-9a54-68c37ce9e2af",
    "chrome-extension://fixture/#89aa67d6-4253-4013-9a54-68c37ce9e2af/x",
    "chrome-extension://fixture/?unknown=1#" +
      "89aa67d6-4253-4013-9a54-68c37ce9e2af",
    "chrome-extension://user@fixture/", "chrome-extension://fixture:12/",
    "chrome-extension://fixture/\n", "https://fixture/", "file:///",
    "chrome-extension://" + "a".repeat(201) + "/",
    "chrome-extension://fixture/, chrome-extension://other/",
  ]) assert.equal(decodeBlooketBrowserClient(value).ok, false);
});

test("browser requests admit only bounded exact commands", () => {
  for (const kind of ["session.observe", "sets.list", "capabilities.inspect"])
    assert.equal(decodeBlooketBrowserBridgeRequest(request({ kind })).ok, true);
  assert.equal(
    decodeBlooketBrowserBridgeRequest(
      request({
        kind: "sets.get",
        setId: "opaque/id with spaces",
      }),
    ).ok,
    true,
  );
  for (const command of [
    { kind: "sets.get", setId: "" },
    { kind: "sets.get", setId: "x".repeat(513) },
    { kind: "sets.get", setId: "a\0b" },
    { kind: "sets.get", setId: "a\nb" },
    { kind: "questions.list", setId: "a\tb" },
    { kind: "sets.list", script: "arbitrary code" },
    { kind: "navigate", url: "https://untrusted.invalid" },
  ])
    assert.equal(decodeBlooketBrowserBridgeRequest(request(command)).ok, false);
  assert.equal(
    decodeBlooketBrowserBridgeRequest({
      ...request({ kind: "sets.list" }),
      id: "not-a-uuid",
    }).ok,
    false,
  );
  assert.equal(
    decodeBlooketBrowserBridgeRequest({
      ...request({ kind: "sets.list" }),
      schemaVersion: 2,
    }).ok,
    false,
  );
});

test("Create Set bridge commands are exact bounded and text-only", () => {
  const valid = {
    kind: "sets.create",
    title: "Synthetic set",
    description: "Synthetic description",
    private: true,
  };
  assert.deepEqual(
    decodeBlooketBrowserBridgeRequest(request(valid)),
    {
      ok: true,
      value: {
        schemaVersion: 1,
        id: "fe101cf0-18c3-4f3f-84a3-b9075029e67f",
        command: valid,
      },
    },
  );
  for (const command of [
    { ...valid, title: "" },
    { ...valid, title: "x".repeat(1_001) },
    { ...valid, title: "bad\nline" },
    { ...valid, description: "x".repeat(10_001) },
    { ...valid, description: "bad\u0000value" },
    { ...valid, private: "true" },
    { ...valid, coverImage: "unexpected" },
    { ...valid, arbitrary: "script" },
  ])
    assert.equal(
      decodeBlooketBrowserBridgeRequest(request(command)).ok,
      false,
    );
});

test("Add Question bridge commands admit exact text-only semantics", () => {
  const valid = {
    kind: "questions.create",
    setId: "set-fixture",
    number: 1,
    question: "Type sun.",
    answers: [{ text: "sun", correct: true }],
    qType: "typing",
    random: true,
    answerTypes: ["exactly"],
    timeLimit: 15,
  };
  assert.equal(
    decodeBlooketBrowserBridgeRequest(request(valid)).ok,
    true,
  );
  for (const command of [
    { ...valid, setId: "" },
    { ...valid, setId: "a\nb" },
    { ...valid, number: 0 },
    { ...valid, question: "" },
    { ...valid, answers: [] },
    {
      ...valid,
      answers: [
        { text: "sun", correct: true },
        { text: "sun", correct: true },
      ],
      answerTypes: ["exactly", "exactly"],
    },
    {
      ...valid,
      answers: [{ text: "sun", correct: false }],
    },
    { ...valid, random: false },
    { ...valid, answerTypes: null },
    { ...valid, timeLimit: 0 },
    { ...valid, image: "not-admitted" },
    {
      ...valid,
      answers: [{ text: "sun", correct: true, image: "extra" }],
    },
  ])
    assert.equal(
      decodeBlooketBrowserBridgeRequest(request(command)).ok,
      false,
    );

  assert.equal(
    decodeBlooketBrowserBridgeRequest(request({
      ...valid,
      qType: "mc",
      random: false,
      answers: [
        { text: "Sun", correct: true },
        { text: "Moon", correct: false },
      ],
      answerTypes: null,
    })).ok,
    true,
  );
});

test("invalid authentication requests never echo secret values", () => {
  const password = "synthetic-secret-that-must-not-be-returned";
  const result = decodeBlooketBrowserBridgeRequest(
    request({
      kind: "session.authenticate",
      loginIdentifier: "",
      password,
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.equal(
    decodeBlooketBrowserBridgeRequest(
      request({
        kind: "session.authenticate",
        loginIdentifier: "teacher@example.invalid",
        password,
      }),
    ).ok,
    true,
  );
});

test("bridge responses preserve unknown successful values", () => {
  const value = { privatePageValue: "opaque" };
  assert.deepEqual(
    decodeBlooketBrowserBridgeResponse(
      {
        schemaVersion: 1,
        id: "request-a",
        ok: true,
        value,
      },
      "request-a",
    ),
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
  const result = decodeBlooketBrowserBridgeResponse(
    {
      schemaVersion: 1,
      id: "request-b",
      ok: true,
      value: null,
      leakedCookie: "must-not-cross",
    },
    "request-a",
  );
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
    decodeBlooketBrowserBridgeResponse(
      {
        schemaVersion: 1,
        id: "request-a",
        ok: false,
        code: "raw-extension-error",
      },
      "request-a",
    ).ok,
    false,
  );
});

test("Add Question image transport accepts only prepared bounded bytes", () => {
  const valid = {
    kind: "questions.create",
    setId: "synthetic-set",
    number: 1,
    question: "Synthetic image question",
    answers: [{ text: "Yes", correct: true }],
    qType: "typing",
    random: true,
    answerTypes: ["exactly"],
    timeLimit: 15,
  };
  const image = {
    format: "png",
    base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      .toString("base64"),
  };
  const admitted = decodeBlooketBrowserBridgeRequest(request({
    ...valid, image,
  }));
  assert.equal(admitted.ok, true);
  if (admitted.ok && admitted.value.command.kind === "questions.create")
    assert.deepEqual(admitted.value.command.image, image);
  for (const value of [
    { ...valid, image: null },
    { ...valid, image: { ...image, path: "/tmp/private-media" } },
    { ...valid, image: { ...image, url: "https://example.invalid/" } },
    { ...valid, image: { ...image, format: "jpeg" } },
    { ...valid, image: { ...image, base64: "A".repeat(3_333_333) } },
  ]) {
    const result = decodeBlooketBrowserBridgeRequest(request(value));
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.equal(JSON.stringify(result).includes(image.base64), false);
  }
});

test("browser tab focus is an exact, credential-free bridge command", () => {
  assert.deepEqual(decodeBlooketBrowserBridgeRequest(
    request({ kind: "browser.activate" }),
  ), { ok: true, value: request({ kind: "browser.activate" }) });
  for (const invalid of [
    { kind: "browser.activate", url: "https://untrusted.invalid" },
    { kind: "browser.activate", userAgent: "modified-browser" },
    { kind: "browser.activate", profilePath: "/tmp/profile" },
    { kind: "browser.activate", solveCaptcha: true },
    { kind: "browser.activate", cookies: [] },
  ]) assert.equal(decodeBlooketBrowserBridgeRequest(
    request(invalid),
  ).ok, false);
});

test("bridge text controls reject every forbidden literal byte", () => {
  const command = {
    kind: "sets.create", title: "Synthetic",
    description: "Prepared by teacher", private: true,
  };
  for (const codePoint of [0, 1, 8, 11, 12, 14, 31, 127]) {
    const invalid = String.fromCharCode(codePoint);
    assert.equal(decodeBlooketBrowserBridgeRequest(request({
      ...command, title: "Set" + invalid + "name",
    })).ok, false);
    assert.equal(decodeBlooketBrowserBridgeRequest(request({
      ...command, description: "Draft" + invalid + "text",
    })).ok, false);
  }
  // Preserved multiline teacher descriptions remain valid.
  assert.equal(decodeBlooketBrowserBridgeRequest(request({
    ...command, description: "Line one\nLine two\r\n\tIndented",
  })).ok, true);
});
