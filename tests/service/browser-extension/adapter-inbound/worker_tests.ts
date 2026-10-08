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
  let detailOpenSucceeds = true;
  let detailMalformedReply = false;
  let detailDrifts = false;
  let detailReadCount = 0;
  let detailSwitchTabAfterScript = false;
  let detailSwitchTabAfterOpen = false;
  let sessionSwitchAfterScript: string | null = null;
  let observedSessionOverride: string | null = null;
  let driftSessionAtSameRoute = false;
  let sessionObservations = 0;
  let listFailuresRemaining = 0;
  let listDrifts = false;
  let listEmpty = false;
  let listEmptyDrifts = false;
  let listInvalidEnvelope = false;
  let setListReads = 0;
  let questionPanelCloses = true;
  let addQuestionPanelReady = false;
  let capabilityPanelReady = false;
  let capabilityDrawerOpen = false;
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
        if (func.name === "openBlooketDetailPanel") {
          assert.deepEqual(args, ["opaque id/with spaces"]);
          if (detailSwitchTabAfterOpen) {
            detailSwitchTabAfterOpen = false;
            tabUrl = "https://dashboard.blooket.com/edit?id=another-set";
          }
          return [{ result: detailOpenSucceeds }];
        }
        if (func.name === "listBlooketQuestionNumbers")
          return [{ result: { ok: true, value: [1] } }];
        if (func.name === "openBlooketQuestionPanel")
          return [{ result: args[0] === "set-fixture" && args[1] === 1 }];
        if (func.name === "inspectOpenedBlooketQuestion") {
          assert.deepEqual(args, ["set-fixture", 1]);
          return [{
            result: {
              ok: true,
              value: {
                schemaVersion: 3,
                number: 1,
                question: "Type sun.",
                equation: null,
                qType: "typing",
                random: true,
                timeLimit: 15,
                answers: [{
                  kind: "text",
                  content: "sun",
                  correct: true,
                  match: "exactly",
                }],
                hasImage: false,
                hasAudio: false,
              },
            },
          }];
        }
        if (func.name === "closeBlooketQuestionPanel") {
          assert.deepEqual(args, ["set-fixture"]);
          return [{ result: questionPanelCloses }];
        }
        if (func.name === "isBlooketQuestionPanelClosed") {
          assert.deepEqual(args, ["set-fixture"]);
          return [{ result: questionPanelCloses }];
        }
        if (func.name === "runBlooketAddQuestionPageAction") {
          if (args[0] === "open") {
            assert.equal(args[1], "set-fixture");
            addQuestionPanelReady = true;
            return [{ result: true }];
          }
          if (args[0] === "is-ready")
            return [{ result: addQuestionPanelReady }];
          if (args[0] === "prepare") return [{ result: { ok: true } }];
          if (args[0] === "submit") {
            addQuestionPanelReady = false;
            return [{ result: { ok: true } }];
          }
          throw new Error("unexpected-add-question-action");
        }
        if (func.name === "openBlooketCapabilityQuestionPanel") {
          assert.equal(args[0], "set-fixture");
          capabilityPanelReady = true;
          return [{ result: true }];
        }
        if (func.name === "isBlooketCapabilityQuestionPanelReady")
          return [{ result: capabilityPanelReady }];
        if (func.name === "openBlooketAudioCapabilityDrawer") {
          capabilityDrawerOpen = true;
          return [{ result: true }];
        }
        if (func.name === "inspectBlooketAudioCapabilityDrawer")
          return [{ result: { ok: true, value: "unsupported" } }];
        if (func.name === "isBlooketAudioCapabilityDrawerClosed")
          return [{ result: !capabilityDrawerOpen }];
        if (func.name === "closeBlooketAudioCapabilityDrawer") {
          capabilityDrawerOpen = false;
          return [{ result: true }];
        }
        if (func.name === "isBlooketCapabilityQuestionPanelClosed")
          return [{ result: !capabilityPanelReady && !capabilityDrawerOpen }];
        if (func.name === "closeBlooketCapabilityQuestionPanel") {
          if (capabilityDrawerOpen) return [{ result: false }];
          capabilityPanelReady = false;
          return [{ result: true }];
        }
        if (func.name === "runBlooketLoginPageAction") {
          assert.deepEqual(args[1], {
            loginIdentifier: "teacher@example.invalid",
            password: "synthetic-password",
          });
          if (args[0] === "prepare") return [{ result: { ok: true } }];
          if (args[0] === "is-prepared") return [{ result: true }];
          if (args[0] === "submit") {
            tabUrl = "https://dashboard.blooket.com/my-sets";
            return [{ result: { ok: true } }];
          }
          throw new Error("unexpected-login-action");
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
        if (operation.kind === "session.observe" &&
            observedSessionOverride !== null) {
          return [{ result: { ok: true, value: observedSessionOverride } }];
        }
        if (operation.kind === "session.observe" &&
            driftSessionAtSameRoute) {
          sessionObservations++;
          return [{ result: {
            ok: true,
            value: sessionObservations === 1
              ? "my-sets" : "security-challenge",
          } }];
        }
        if (operation.kind === "session.observe" &&
            sessionSwitchAfterScript !== null) {
          const observed = tabUrl.startsWith("https://id.blooket.com/")
            ? "signed-out" : "my-sets";
          tabUrl = sessionSwitchAfterScript;
          sessionSwitchAfterScript = null;
          return [{ result: { ok: true, value: observed } }];
        }
        if (operation.kind === "sets.get") {
          detailReadCount++;
          if (detailMalformedReply) {
            detailMalformedReply = false;
            return [{ result: {
              ok: true, extra: "untrusted",
              value: {
                schemaVersion: 1, id: operation.setId,
                title: "Synthetic", description: "", visibility: "private",
              },
            } }];
          }
          if (detailSwitchTabAfterScript) {
            detailSwitchTabAfterScript = false;
            tabUrl = "https://dashboard.blooket.com/edit?id=another-set";
          }
        }
        if (operation.kind === "sets.list") {
          setListReads++;
          if (listFailuresRemaining > 0) {
            listFailuresRemaining--;
            return [{ result: {
              ok: false, code: "blooket-browser-failed",
            } }];
          }
          if (listInvalidEnvelope) return [{ result: {
            ok: true, extra: "untrusted",
            value: { items: [], completeness: "complete" },
          } }];
          return [{ result: {
            ok: true,
            value: {
              items: (listEmpty &&
                  (!listEmptyDrifts || setListReads % 2 !== 0))
                ? []
                : [{
                    schemaVersion: 1,
                    id: "set-fixture",
                    title: listDrifts && setListReads % 2 === 0
                      ? "Changed synthetic title" : "Synthetic",
                  }],
              completeness: (listEmpty &&
                  (!listEmptyDrifts || setListReads % 2 !== 0))
                ? "complete" : "unknown",
            },
          } }];
        }
        return [
          {
            result: {
              ok: true,
              value:
                operation.kind === "session.observe"
                  ? new URL(tabUrl).origin === "https://id.blooket.com"
                    ? "signed-out"
                    : new URL(tabUrl).pathname === "/create"
                      ? "create"
                      : new URL(tabUrl).pathname === "/edit"
                        ? "edit"
                        : "my-sets"
                  : operation.kind === "sets.list"
                    ? {
                        items: [
                          {
                            schemaVersion: 1,
                            id: "set-fixture",
                            title: "Synthetic",
                          },
                        ],
                        completeness: "unknown",
                      }
                    : {
                        schemaVersion: 1,
                        id: operation.setId,
                        title: detailDrifts && detailReadCount % 2 === 0
                          ? "Changed synthetic title" : "Synthetic",
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
    const firstSets = await expectReply({ kind: "sets.list" });
    assert.equal(firstSets.ok, true);
    assert.equal(firstSets.value.completeness, "unknown");
    assert.equal(setListReads, 2);
    listFailuresRemaining = 2;
    setListReads = 0;
    const delayedSets = await expectReply({ kind: "sets.list" });
    assert.equal(delayedSets.ok, true);
    assert.equal(delayedSets.value.completeness, "unknown");
    assert.equal(setListReads, 4);
    assert.equal(listFailuresRemaining, 0);
    listDrifts = true;
    setListReads = 0;
    const changedSets = await expectReply({ kind: "sets.list" });
    assert.equal(changedSets.ok, false);
    assert.equal(setListReads, 2);
    listDrifts = false;
    listInvalidEnvelope = true;
    setListReads = 0;
    const malformedSets = await expectReply({ kind: "sets.list" });
    assert.equal(malformedSets.ok, false);
    assert.equal(setListReads, 1);
    listInvalidEnvelope = false;
    listEmpty = true;
    setListReads = 0;
    const emptySets = await expectReply({ kind: "sets.list" });
    assert.equal(emptySets.ok, true);
    assert.deepEqual(emptySets.value, {
      items: [], completeness: "complete",
    });
    assert.equal(setListReads, 2);
    listEmptyDrifts = true;
    setListReads = 0;
    const changingEmptySets = await expectReply({ kind: "sets.list" });
    assert.equal(changingEmptySets.ok, false);
    assert.equal(setListReads, 2);
    listEmpty = false;
    listEmptyDrifts = false;
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
    detailOpenSucceeds = false;
    const beforeRejectedOpen = scripts.length;
    const rejectedDetail = await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    });
    assert.equal(rejectedDetail.ok, false);
    assert.equal(scripts.slice(beforeRejectedOpen).every(
      (name) => name === "openBlooketDetailPanel",
    ), true);
    detailOpenSucceeds = true;
    detailMalformedReply = true;
    const beforeMalformedDetail = scripts.length;
    const malformedDetail = await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    });
    assert.equal(malformedDetail.ok, false);
    assert.equal(scripts.slice(beforeMalformedDetail).filter(
      (name) => name === "inspectBlooketPage",
    ).length, 1);
    detailSwitchTabAfterScript = true;
    const switchedDetail = await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    });
    assert.equal(switchedDetail.ok, false);
    assert.equal(tabUrl,
      "https://dashboard.blooket.com/edit?id=another-set");
    detailSwitchTabAfterOpen = true;
    const beforeSwitchedOpen = scripts.length;
    const switchedOpen = await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    });
    assert.equal(switchedOpen.ok, false);
    assert.equal(tabUrl,
      "https://dashboard.blooket.com/edit?id=another-set");
    assert.deepEqual(scripts.slice(beforeSwitchedOpen), [
      "openBlooketDetailPanel",
    ]);
    detailDrifts = true;
    detailReadCount = 0;
    const driftedDetail = await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    });
    assert.equal(driftedDetail.ok, false);
    assert.equal(detailReadCount, 2);
    detailDrifts = false;
    const questions = await expectReply({
      kind: "questions.list",
      setId: "set-fixture",
    });
    assert.equal(questions.ok, true);
    assert.deepEqual(questions.value, [{
      schemaVersion: 3,
      number: 1,
      question: "Type sun.",
      equation: null,
      qType: "typing",
      random: true,
      timeLimit: 15,
      answers: [{
        kind: "text",
        content: "sun",
        correct: true,
        match: "exactly",
      }],
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
      scripts.filter((name) => name === "runBlooketAddQuestionPageAction")
        .length >= 4,
      true,
    );
    assert.ok(scripts.includes("runBlooketAddQuestionPageAction"));
    assert.ok(scripts.includes("inspectOpenedBlooketQuestion"));

    const beforeCapabilitiesUrl = tabUrl;
    const capabilities = await expectReply({ kind: "capabilities.inspect" });
    assert.equal(capabilities.ok, true);
    assert.equal(tabUrl, beforeCapabilitiesUrl);
    assert.equal(capabilities.value.schemaVersion, 3);
    assert.equal(capabilities.value.features.answerImages, "unsupported");
    assert.equal(capabilities.value.features.audio, "unsupported");
    assert.ok(scripts.includes("openBlooketCapabilityQuestionPanel"));
    assert.ok(scripts.includes("openBlooketAudioCapabilityDrawer"));
    assert.ok(scripts.includes("closeBlooketAudioCapabilityDrawer"));
    assert.ok(scripts.includes("closeBlooketCapabilityQuestionPanel"));

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
    assert.equal((await expectReply({ kind: "session.observe" })).ok, true);
    assert.equal((await message({ kind: "status" })).status, "connected");

    tabUrl = "https://id.blooket.com/login";
    const signedOut = await expectReply({ kind: "session.observe" });
    assert.equal(signedOut.ok, true);
    assert.equal(signedOut.value, "signed-out");
    assert.equal((await message({ kind: "status" })).status,
      "blooket-attention-required");
    const authentication = await expectReply({
      kind: "session.authenticate",
      loginIdentifier: "teacher@example.invalid",
      password: "synthetic-password",
    });
    assert.equal(authentication.ok, true);
    assert.equal(authentication.value, null);
    // A submit acknowledgment is not evidence that login completed.
    assert.equal((await message({ kind: "status" })).status,
      "blooket-attention-required");
    assert.equal(
      JSON.stringify(authentication).includes("synthetic-password"),
      false,
    );
    assert.equal(
      scripts.filter((name) => name === "runBlooketLoginPageAction").length,
      3,
    );
    assert.equal(tabUrl, "https://dashboard.blooket.com/my-sets");
    const ready = await expectReply({ kind: "session.observe" });
    assert.equal(ready.ok, true);
    assert.equal(ready.value, "my-sets");
    assert.equal((await message({ kind: "status" })).status, "connected");
    observedSessionOverride = "security-challenge";
    const challenged = await expectReply({ kind: "session.observe" });
    assert.equal(challenged.ok, true);
    assert.equal(challenged.value, "security-challenge");
    assert.equal((await message({ kind: "status" })).status,
      "blooket-attention-required");
    observedSessionOverride = null;
    assert.equal((await expectReply({ kind: "session.observe" })).ok, true);
    assert.equal((await message({ kind: "status" })).status, "connected");
    driftSessionAtSameRoute = true;
    sessionObservations = 0;
    const changingSession = await expectReply({ kind: "session.observe" });
    assert.equal(changingSession.ok, false);
    assert.equal(sessionObservations, 2);
    assert.equal(tabUrl, "https://dashboard.blooket.com/my-sets");
    driftSessionAtSameRoute = false;
    sessionSwitchAfterScript = "https://id.blooket.com/login";
    const switchedReady = await expectReply({ kind: "session.observe" });
    assert.equal(switchedReady.ok, false);
    assert.equal(tabUrl, "https://id.blooket.com/login");
    sessionSwitchAfterScript = "https://dashboard.blooket.com/my-sets";
    const switchedSignedOut = await expectReply({ kind: "session.observe" });
    assert.equal(switchedSignedOut.ok, false);
    assert.equal(tabUrl, "https://dashboard.blooket.com/my-sets");
    sessionSwitchAfterScript =
      "https://dashboard.blooket.com/edit?id=another-set";
    const switchedDashboardPage = await expectReply({
      kind: "session.observe",
    });
    assert.equal(switchedDashboardPage.ok, false);
    assert.equal(tabUrl,
      "https://dashboard.blooket.com/edit?id=another-set");

    tabUrl = "https://id.blooket.com/login";
    const before = scripts.length;
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
