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
    "moz-extension://bbaca434-855e-4d95-94e7-1ae4924b0302/",
    "moz-extension://bbaca434-855e-4d95-94e7-1ae4924b0302/#" +
      "89aa67d6-4253-4013-9a54-68c37ce9e2af",
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
    "moz-extension://not-a-uuid/",
    "moz-extension://bbaca434-855e-4d95-94e7-1ae4924b0302/path",
    "moz-extension://bbaca434-855e-4d95-94e7-1ae4924b0302/#nope",
  ]) assert.equal(decodeBlooketBrowserClient(value).ok, false);
});

test("browser requests admit only bounded exact commands", () => {
  for (const kind of ["session.observe", "sets.list", "capabilities.inspect",
    "writes.inspect", "capabilities.inspect-text"])
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
    { ...valid, title: " \t " },
    { ...valid, title: "x".repeat(1_001) },
    { ...valid, title: "bad\nline" },
    { ...valid, description: "x".repeat(10_001) },
    { ...valid, description: "bad\u0000value" },
    { ...valid, description: "Line\rTwo" },
    { ...valid, description: "Line\r\nTwo" },
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
  assert.equal(decodeBlooketBrowserBridgeRequest(request({
    ...valid, number: 200,
  })).ok, true);
  for (const command of [
    { ...valid, setId: "" },
    { ...valid, setId: "a\nb" },
    { ...valid, number: 0 },
    { ...valid, number: 201 },
    { ...valid, question: "" },
    { ...valid, question: " \t " },
    { ...valid, question: "Math`*marker" },
    { ...valid, question: "Image`~`marker" },
    { ...valid, answers: [{ text: " \t ", correct: true }] },
    { ...valid, answers: [{ text: "sun`*moon", correct: true }] },
    { ...valid, answers: [{ text: "sun`~`moon", correct: true }] },
    { ...valid, question: "Type\rsun" },
    { ...valid, question: "Type\r\nsun" },
    { ...valid, answers: [{ text: "sun\nmoon", correct: true }] },
    { ...valid, answers: [{ text: "sun\rmoon", correct: true }] },
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

test("multiple-choice textarea line feeds survive bridge admission", () => {
  const result = decodeBlooketBrowserBridgeRequest(request({
    kind: "questions.create", setId: "set-fixture", number: 1,
    question: "Which star?\nChoose.",
    answers: [{ text: "Sun\nStar", correct: true },
      { text: "Moon", correct: false }],
    qType: "mc", random: true, answerTypes: null, timeLimit: 20,
  }));
  assert.equal(result.ok, true);
  if (result.ok && result.value.command.kind === "questions.create") {
    assert.equal(result.value.command.question, "Which star?\nChoose.");
    assert.equal(result.value.command.answers[0]?.text, "Sun\nStar");
  }
});

test("multiple-choice CR in an answer cannot reach the browser host", () => {
  for (const text of ["Sun\rStar", "Sun\r\nStar"]) {
    assert.equal(decodeBlooketBrowserBridgeRequest(request({
      kind: "questions.create", setId: "set-fixture", number: 1,
      question: "Which star?", answers: [
        { text, correct: true }, { text: "Moon", correct: false },
      ], qType: "mc", random: true, answerTypes: null, timeLimit: 20,
    })).ok, false);
  }
});

test("Add Question command rejects sparse or decorated answer arrays", () => {
  const valid = {
    kind: "questions.create", setId: "set-fixture", number: 1,
    question: "Type sun.", answers: [{ text: "sun", correct: true }],
    qType: "typing", random: true, answerTypes: ["exactly"],
    timeLimit: 15,
  };
  const sparseAnswers = new Array(2);
  sparseAnswers[0] = valid.answers[0];
  const sparseModes = new Array(1);
  const getterAnswers = [...valid.answers];
  let invoked = 0;
  Object.defineProperty(getterAnswers, "0", {
    enumerable: true, configurable: true,
    get: () => { invoked++; return valid.answers[0]; },
  });
  const hiddenModes = Object.defineProperty(["exactly"], "hidden", {
    value: "untrusted", enumerable: false,
  });
  const symbolAnswers = [...valid.answers];
  Object.defineProperty(symbolAnswers, Symbol("extra"), { value: true });
  for (const candidate of [
    { ...valid, answers: sparseAnswers },
    { ...valid, answerTypes: sparseModes },
    { ...valid, answers: getterAnswers },
    { ...valid, answerTypes: hiddenModes },
    { ...valid, answers: symbolAnswers },
  ]) assert.equal(decodeBlooketBrowserBridgeRequest(
    request(candidate)).ok, false);
  assert.equal(invoked, 0);
});

test("bridge decoder never invokes getters on command or reply fields",
  () => {
  let getterCalls = 0;
  const getter = () => { getterCalls++; throw new Error("untrusted"); };
  for (const make of [
    () => Object.defineProperty(request({ kind: "sets.list" }),
      "schemaVersion", { enumerable: true, get: getter }),
    () => request(Object.defineProperty({ kind: "sets.list" },
      "kind", { enumerable: true, get: getter })),
    () => request({ kind: "questions.create", setId: "set-fixture",
      number: 1, question: "Type sun.",
      answers: [Object.defineProperty({ text: "sun", correct: true },
        "text", { enumerable: true, get: getter })],
      qType: "typing", random: true, answerTypes: ["exactly"],
      timeLimit: 15 }),
  ]) assert.equal(decodeBlooketBrowserBridgeRequest(make()).ok, false);
  for (const field of ["ok", "id", "value"]) {
    const reply = Object.defineProperty({ schemaVersion: 1,
      id: "request-a", ok: true, value: null }, field,
    { enumerable: true, get: getter });
    assert.equal(decodeBlooketBrowserBridgeResponse(reply,
      "request-a").ok, false);
  }
  assert.equal(getterCalls, 0);
  },
);

test("Add Question bridge never invokes inherited array methods", () => {
  let intercepted = 0;
  class HostileAnswers extends Array<{ text: string; correct: boolean }> {
    override forEach(): void { intercepted++; throw new Error("untrusted"); }
  }
  class HostileModes extends Array<string> {
    override every(): boolean { intercepted++; throw new Error("untrusted"); }
    toJSON(): never { intercepted++; throw new Error("untrusted"); }
  }
  const answers = new HostileAnswers();
  answers.push({ text: "sun", correct: true });
  const answerTypes = new HostileModes();
  answerTypes.push("exactly");
  const decoded = decodeBlooketBrowserBridgeRequest(request({
    kind: "questions.create", setId: "set-fixture", number: 1,
    question: "Type sun.", answers, qType: "typing", random: true,
    answerTypes, timeLimit: 15,
  }));
  assert.equal(decoded.ok, true);
  if (decoded.ok && decoded.value.command.kind === "questions.create") {
    assert.deepEqual(decoded.value.command.answerTypes, ["exactly"]);
    assert.notEqual(decoded.value.command.answerTypes, answerTypes);
    assert.equal(JSON.stringify(decoded.value).includes("Type sun."), true);
  }
  assert.equal(intercepted, 0);
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
    { ...valid, image: Object.create(image) },
    { ...valid, image: Object.assign(Object.create({
      base64: image.base64,
    }), { format: "png" }) },
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
    ...command, description: "Line one\nLine two\n\tIndented",
  })).ok, true);
});


test("Add Question bridge owns exact arrays before reading proxy slots",
  () => {
  let indexedReads = 0;
  const wrapped = <T>(items: T[]) => new Proxy(items, {
    get(target, key, receiver) {
      if (key === "length" || key === "0") {
        indexedReads++;
        throw new Error("Untrusted bridge indexed read");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const candidate = request({
    kind: "questions.create", setId: "set-fixture", number: 1,
    question: "Type sun.",
    answers: wrapped([{ text: "sun", correct: true }]),
    qType: "typing", random: true,
    answerTypes: wrapped(["exactly"]), timeLimit: 15,
  });
  const decoded = decodeBlooketBrowserBridgeRequest(candidate);
  assert.equal(decoded.ok, true);
  assert.equal(indexedReads, 0);
  const revoked = Proxy.revocable(["exactly"], {});
  revoked.revoke();
  assert.equal(decodeBlooketBrowserBridgeRequest(request({
    kind: "questions.create", setId: "set-fixture", number: 1,
    question: "Type sun.", answers: [{ text: "sun", correct: true }],
    qType: "typing", random: true,
    answerTypes: revoked.proxy, timeLimit: 15,
  })).ok, false);
  },
);
