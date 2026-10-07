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
} from "../../../../src/ir/blooket-browser-bridge/contract/message.ts";

const request = (command: unknown) => ({
  schemaVersion: 1,
  id: "fe101cf0-18c3-4f3f-84a3-b9075029e67f",
  command,
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
