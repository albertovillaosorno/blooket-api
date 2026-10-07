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
//   - Synthetic extension transport and browser admission verification.
// - Must-Not:
//   - Install an extension or contact an actual Blooket account.
// - Allows:
//   - Inputs: Synthetic browser APIs and bounded protocol fixtures.
//   - Outputs: Assertions about authentication, navigation, and read replies.
//   - Side effects: Temporary globals restored after the worker disconnects.
// - Split-When:
//   - A new browser host requires native acceptance fixtures.
// - Merge-When:
//   - Extension delivery becomes an in-process transport.
// - Summary:
//   - Exercises the actual worker without granting browser permissions.
// - Description:
//   - Confirms sender, address, job, and navigation checks before execution.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unsupported operations fail without page scripts or external requests.
//
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";

test(
  "worker admits explicit local reads and refuses arbitrary execution",
  async () => {
  const root = "chrome-extension://synthetic/";
  const origin = "http://127.0.0.1:4567";
  const token = "a".repeat(43);
  let listener;
  let tabUrl = "https://dashboard.blooket.com/my-sets";
  let creates = 0;
  let closed = false;
  let validStatus = true;
  let questionPanelCloses = true;
  let addQuestionPanelReady = false;
  const jobs = [];
  const replies = [];
  const scripts = [];
  const requests = [];
  const stored = {};
  const priorChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const priorFetch = globalThis.fetch;
  const browser = {
    runtime: {
      getURL: (path) => root + path,
      onMessage: {
        addListener: (callback) => {
          listener = callback;
        },
      },
    },
    tabs: {
      query: async () => [{ id: 99, url: origin + "/" }],
      create: async ({ url }) => {
        creates++;
        tabUrl = url;
        return { id: 7, url, status: "complete" };
      },
      get: async (id) => {
        if (closed) throw new Error("closed-tab");
        assert.equal(id, 7);
        return { id, url: tabUrl, status: "complete" };
      },
      update: async (id, { url }) => {
        assert.equal(id, 7);
        tabUrl = url;
        return { id, url, status: "complete" };
      },
    },
    storage: {
      session: {
        get: async () => ({ ...stored }),
        set: async (value) => Object.assign(stored, value),
        remove: async (key) => {
          delete stored[key];
        },
      },
    },
    scripting: {
      executeScript: async ({ target, func, args, files }) => {
        if (files) {
          assert.equal(target.tabId, 99);
          assert.deepEqual(files, [
            "src/ui/browser-extension/adapter-inbound/workspace.js",
          ]);
          return [];
        }
        assert.equal(target.tabId, 7);
        scripts.push(func.name);
        if (func.name === "openBlooketDetailPanel") return [{ result: true }];
        if (func.name === "listBlooketQuestionNumbers")
          return [{ result: { ok: true, value: [1] } }];
        if (func.name === "openBlooketQuestionPanel")
          return [{ result: args[0] === 1 }];
        if (func.name === "inspectOpenedBlooketQuestion")
          return [{
            result: {
              ok: true,
              value: {
                schemaVersion: 1,
                number: 1,
                question: "Type sun.",
                qType: "typing",
                random: true,
                timeLimit: 15,
                answers: ["sun"],
                correctAnswers: ["sun"],
                answerTypes: ["exactly"],
                hasImage: false,
                hasAudio: false,
              },
            },
          }];
        if (func.name === "closeBlooketQuestionPanel")
          return [{ result: questionPanelCloses }];
        if (func.name === "isBlooketQuestionPanelClosed")
          return [{ result: questionPanelCloses }];
        if (func.name === "openBlooketAddQuestionPanel") {
          assert.equal(args[0], "set-fixture");
          addQuestionPanelReady = true;
          return [{ result: true }];
        }
        if (func.name === "isBlooketAddQuestionPanelReady")
          return [{ result: addQuestionPanelReady }];
        if (func.name === "prepareBlooketAddQuestionForm") {
          assert.deepEqual(args[0], {
            setId: "set-fixture",
            number: 1,
            question: "Type sun.",
            answers: [{ text: "sun", correct: true }],
            qType: "typing",
            random: true,
            answerTypes: ["exactly"],
            timeLimit: 15,
          });
          return [{ result: { ok: true } }];
        }
        if (func.name === "submitBlooketAddQuestionForm") {
          assert.deepEqual(args[0], {
            setId: "set-fixture",
            number: 1,
            question: "Type sun.",
            answers: [{ text: "sun", correct: true }],
            qType: "typing",
            random: true,
            answerTypes: ["exactly"],
            timeLimit: 15,
          });
          addQuestionPanelReady = false;
          return [{ result: { ok: true } }];
        }
        if (func.name === "prepareBlooketCreateSetForm") {
          assert.deepEqual(args[0], {
            title: "Synthetic created set",
            description: "Created through bridge fixture",
            private: true,
          });
          return [{ result: { ok: true } }];
        }
        if (func.name === "submitBlooketCreateSetForm") {
          assert.deepEqual(args[0], {
            title: "Synthetic created set",
            description: "Created through bridge fixture",
            private: true,
          });
          tabUrl =
            "https://dashboard.blooket.com/edit?id=created-set-fixture";
          return [{ result: { ok: true } }];
        }
        if (func.name === "observeBlooketCreateSetSuccess")
          return [{
            result: {
              ok: true,
              remoteSetId: "created-set-fixture",
            },
          }];
        assert.equal(func.name, "inspectBlooketPage");
        const operation = args[0];
        return [
          {
            result: {
              ok: true,
              value:
                operation.kind === "session.observe"
                  ? new URL(tabUrl).pathname === "/create"
                    ? "create"
                    : new URL(tabUrl).pathname === "/edit"
                      ? "edit"
                      : "my-sets"
                  : operation.kind === "sets.list"
                    ? [
                        {
                          schemaVersion: 1,
                          id: "set-fixture",
                          title: "Synthetic",
                        },
                      ]
                    : {
                        schemaVersion: 1,
                        id: operation.setId,
                        title: "Synthetic",
                        description: "",
                        visibility: "private",
                      },
            },
          },
        ];
      },
    },
  };
  Object.defineProperty(globalThis, "chrome", {
    value: browser,
    configurable: true,
  });
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    assert.ok(url.startsWith(origin + "/api/browser-bridge/"));
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer " + token);
    requests.push(url);
    let value;
    if (url.endsWith("/status"))
      value = validStatus ? { ok: true, pending: 0, connected: false } : {};
    else if (url.endsWith("/next"))
      value = { ok: true, job: jobs.shift() ?? null };
    else {
      assert.ok(url.endsWith("/result"));
      replies.push(JSON.parse(options.body));
      value = { ok: true };
    }
    return Response.json(value);
  };
  const popup = root + "src/ui/browser-extension/adapter-inbound/popup.html";
  const message = async (value) =>
    await new Promise((resolve) => {
      assert.equal(listener(value, { url: popup }, resolve), true);
    });
  const job = (command) => ({
    schemaVersion: 1,
    id: randomUUID(),
    command,
  });
  async function expectReply(command) {
    const request = job(command);
    jobs.push(request);
    const deadline = Date.now() + 3000;
    while (!replies.some((reply) => reply.id === request.id)) {
      assert.ok(Date.now() < deadline, "worker did not settle its request");
      await pause(20);
    }
    return replies.find((reply) => reply.id === request.id);
  }
  try {
    await import(
      "../../../../src/service/browser-extension/adapter-inbound/worker.ts"
    );
    assert.equal(typeof listener, "function");
    assert.equal(
      listener(
        { kind: "connect", origin, token },
        { url: "https://untrusted.invalid" },
        () => {
          assert.fail("foreign sender received a reply");
        },
      ),
      false,
    );
    assert.equal((await message({ kind: "connect", origin, token })).ok, false);
    const announce = (value) =>
      new Promise((resolve) => {
        assert.equal(
          listener(
            { kind: "workspace-ready", ...value },
            { url: origin + "/", tab: { id: 99 } },
            resolve,
          ),
          true,
        );
      });
    assert.equal(
      listener(
        { kind: "workspace-ready", origin, token },
        { url: "http://127.0.0.1:9999/", tab: { id: 99 } },
        () => {},
      ),
      false,
    );
    assert.equal(
      listener(
        { kind: "workspace-ready", origin, token },
        { url: origin + "/", tab: undefined },
        () => {},
      ),
      false,
    );
    assert.equal(requests.length, 0);
    validStatus = false;
    assert.equal((await announce({ origin, token })).ok, false);
    assert.equal(creates, 0);
    validStatus = true;
    assert.equal((await announce({ origin, token })).ok, true);
    assert.equal((await announce({ origin, token })).ok, true);
    assert.equal(creates, 1);
    assert.equal((await expectReply({ kind: "sets.list" })).ok, true);
    assert.equal(
      (
        await expectReply({
          kind: "sets.get",
          setId: "opaque id/with spaces",
        })
      ).ok,
      true,
    );
    assert.equal(
      tabUrl,
      "https://dashboard.blooket.com/edit?id=opaque%20id%2Fwith%20spaces",
    );
    const questions = await expectReply({
      kind: "questions.list",
      setId: "set-fixture",
    });
    assert.equal(questions.ok, true);
    assert.deepEqual(questions.value, [{
      schemaVersion: 1,
      number: 1,
      question: "Type sun.",
      qType: "typing",
      random: true,
      timeLimit: 15,
      answers: ["sun"],
      correctAnswers: ["sun"],
      answerTypes: ["exactly"],
      hasImage: false,
      hasAudio: false,
    }]);
    assert.equal(
      tabUrl,
      "https://dashboard.blooket.com/edit?id=set-fixture",
    );
    assert.ok(scripts.includes("listBlooketQuestionNumbers"));
    assert.ok(scripts.includes("openBlooketQuestionPanel"));
    assert.ok(scripts.includes("inspectOpenedBlooketQuestion"));
    assert.ok(scripts.includes("closeBlooketQuestionPanel"));
    assert.ok(scripts.includes("isBlooketQuestionPanelClosed"));

    const created = await expectReply({
      kind: "sets.create",
      title: "Synthetic created set",
      description: "Created through bridge fixture",
      private: true,
    });
    assert.deepEqual(created.value, {
      ok: true,
      remoteSetId: "created-set-fixture",
    });
    assert.equal(
      tabUrl,
      "https://dashboard.blooket.com/edit?id=created-set-fixture",
    );
    assert.equal(
      scripts.filter((name) => name === "submitBlooketCreateSetForm").length,
      1,
    );
    assert.ok(scripts.includes("prepareBlooketCreateSetForm"));
    assert.ok(scripts.includes("observeBlooketCreateSetSuccess"));

    const added = await expectReply({
      kind: "questions.create",
      setId: "set-fixture",
      number: 1,
      question: "Type sun.",
      answers: [{ text: "sun", correct: true }],
      qType: "typing",
      random: true,
      answerTypes: ["exactly"],
      timeLimit: 15,
    });
    assert.deepEqual(added.value, { ok: true });
    assert.equal(
      scripts.filter((name) => name === "submitBlooketAddQuestionForm").length,
      1,
    );
    assert.ok(scripts.includes("prepareBlooketAddQuestionForm"));
    assert.ok(scripts.includes("inspectOpenedBlooketQuestion"));

    questionPanelCloses = false;
    assert.equal(
      (
        await expectReply({
          kind: "questions.list",
          setId: "set-fixture",
        })
      ).ok,
      false,
    );
    questionPanelCloses = true;

    const before = scripts.length;
    for (const unsupported of [
      {
        kind: "session.authenticate",
        loginIdentifier: "teacher@example.invalid",
        password: "synthetic-password",
      },
      { kind: "capabilities.inspect" },
    ]) {
      assert.equal((await expectReply(unsupported)).ok, false);
      assert.equal(scripts.length, before);
    }
    tabUrl = "https://id.blooket.com/login";
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal(scripts.length, before);
    assert.equal(
      (await message({ kind: "status" })).status,
      "blooket-attention-required",
    );
  } finally {
    closed = true;
    await pause(1100);
    assert.deepEqual(stored, {});
    globalThis.fetch = priorFetch;
    if (priorChrome) Object.defineProperty(globalThis, "chrome", priorChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});
