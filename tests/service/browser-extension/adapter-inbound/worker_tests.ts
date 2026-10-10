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
import { libraryModelFixture } from
  "../../../ir/blooket-flight-records/contract/library-model-fixture.ts";
import { BLOOKET_LIBRARY_MODEL_BUILD } from
  "../../../../src/ir/blooket-flight-records/contract/library-model.ts";

test(
  "worker admits explicit local reads and refuses arbitrary execution",
  async () => {
  const root = "chrome-extension://synthetic/";
  const origin = "http://127.0.0.1:4567";
  let token = "a".repeat(43);
  let observedClientLabel;
  let listener;
  let onTabUpdated;
  let tabUrl = "https://dashboard.blooket.com/my-sets";
  let creates = 0;
  let documentOrigin = 1_000;
  let readReloads = 0;
  const foregroundedTabs: number[] = [];
  const focusedWindows: number[] = [];
  let closed = false;
  let validStatus = true;
  let incompatibleStatus = false;
  let incompatiblePoll = false;
  let unsafeReadSource = false;
  let detailOpenSucceeds = true;
  let detailSidebarDrifts = false;
  let detailSidebarReadCount = 0;
  let detailSidebarMalformed = false;
  let detailCancelSucceeds = true;
  let detailClosedSucceeds = true;
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
  let listModelSource: string | null = null;
  let listReloadDuringCapture = false;
  let setListReads = 0;
  let questionPanelCloses = true;
  let addQuestionPanelReady = false;
  let questionSaved = true;
  let loseCreateAck = false;
  let createSidebarMismatch = false;
  let capabilityPanelReady = false;
  let capabilityDrawerOpen = false;
  let holdWriteOpen = false;
  let expireWriteAtOpen = false;
  const realNow = Date.now;
  let holdReadScript = false;
  let reportReadScript!: () => void;
  let releaseReadScript!: () => void;
  const readScriptStarted = new Promise<void>((resolve) => {
    reportReadScript = resolve;
  });
  const readScriptRelease = new Promise<void>((resolve) => {
    releaseReadScript = resolve;
  });
  let reportWriteOpen!: () => void;
  let releaseWriteOpen!: () => void;
  const writeOpenStarted = new Promise<void>((resolve) => {
    reportWriteOpen = resolve;
  });
  const writeOpenRelease = new Promise<void>((resolve) => {
    releaseWriteOpen = resolve;
  });
  const jobs = [];
  const replies = [];
  const scripts = [];
  const requests = [];
  const stored = {};
  const persistentProfile = {};
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
      onUpdated: {
        addListener: callback => { onTabUpdated = callback; },
      },
      query: async () => [{ id: 99, url: origin + "/" }],
      create: async ({ url }) => {
        creates++;
        tabUrl = url;
        return { id: 7, url, status: "complete", windowId: 3 };
      },
      get: async (id) => {
        if (closed) throw new Error("closed-tab");
        assert.equal(id, 7);
        return { id, url: tabUrl, status: "complete", windowId: 3 };
      },
      update: async (id, { url, active }) => {
        assert.equal(id, 7);
        if (url !== undefined) {
          tabUrl = url;
          documentOrigin += 1_000;
        }
        if (active === true) foregroundedTabs.push(id);
        return { id, url: tabUrl, status: "complete", windowId: 3 };
      },
      reload: async (id, options) => {
        assert.equal(id, 7);
        assert.deepEqual(options, { bypassCache: true });
        documentOrigin += 1_000;
        readReloads++;
      },
    },
    windows: {
      update: async (id, options) => {
        assert.equal(id, 3);
        assert.deepEqual(options, { focused: true });
        focusedWindows.push(id);
        return {};
      },
    },
    storage: {
      local: {
        get: async () => ({ ...persistentProfile }),
        set: async value => Object.assign(persistentProfile, value),
      },
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
        if (func.name === "inspectBlooketDocumentOrigin") {
          assert.deepEqual(args, [tabUrl]);
          return [{ result: documentOrigin }];
        }
        if (func.name === "canLeaveBlooketPageForRead")
          return [{ result: !unsafeReadSource }];
        if (func.name === "captureBlooketLibraryModel") {
          if (listReloadDuringCapture) {
            listReloadDuringCapture = false;
            // A background navigation may replace this exact URL's document
            // between the DOM and initial-model inspections.
            documentOrigin += 1_000;
          }
          return [{ result: listModelSource === null ? null : {
            build: BLOOKET_LIBRARY_MODEL_BUILD, source: listModelSource,
          } }];
        }
        if (func.name === "runBlooketCreateSetOwnership") {
          assert.ok(args?.[0] === "claim" || args?.[0] === "check");
          return [{ result: true }];
        }
        if (func.name === "inspectBlooketDetailSidebar") {
          if (args?.[0] === "created-set-fixture")
            return [{ result: { ok: true, value: {
              title: createSidebarMismatch
                ? "Another teacher title" : "Synthetic created set",
              description: "Created through bridge fixture",
            } } }];
          assert.deepEqual(args, ["opaque id/with spaces"]);
          detailSidebarReadCount++;
          return [{ result: detailSidebarMalformed ? {
            ok: true, extra: "not-admitted",
            value: { title: "Synthetic", description: "" },
          } : {
            ok: true, value: {
              title: detailSidebarDrifts && detailSidebarReadCount % 2 === 0
                ? "Local unsaved title" : "Synthetic",
              description: "",
            },
          } }];
        }
        if (func.name === "closeBlooketDetailPanel") {
          assert.deepEqual(args, [
            "opaque id/with spaces",
            { title: "Synthetic", description: "" },
            { title: "Synthetic", description: "", visibility: "private" },
          ]);
          return [{ result: detailCancelSucceeds }];
        }
        if (func.name === "isBlooketDetailPanelClosed")
          return [{ result: detailClosedSucceeds }];
        if (func.name === "openBlooketDetailPanel") {
          assert.deepEqual(args, ["opaque id/with spaces"]);
          if (detailSwitchTabAfterOpen) {
            detailSwitchTabAfterOpen = false;
            tabUrl = "https://dashboard.blooket.com/edit?id=another-set";
          }
          return [{ result: detailOpenSucceeds }];
        }
        if (func.name === "listBlooketQuestionNumbers")
          return [{ result: { ok: true,
            value: questionSaved ? [1] : [] } }];
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
            if (expireWriteAtOpen) {
              expireWriteAtOpen = false;
              Date.now = () => realNow() + 35_000;
            }
            if (holdWriteOpen) {
              holdWriteOpen = false;
              reportWriteOpen();
              await writeOpenRelease;
            }
            return [{ result: true }];
          }
          if (args[0] === "is-ready")
            return [{ result: addQuestionPanelReady }];
          if (args[0] === "prepare") return [{ result: { ok: true } }];
          if (args[0] === "submit") {
            addQuestionPanelReady = false;
            questionSaved = true;
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
          if (loseCreateAck)
            throw new Error("context-destroyed-after-submit-click");
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
          if (holdReadScript) {
            holdReadScript = false;
            reportReadScript();
            await readScriptRelease;
          }
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
    const label = options.headers["x-blooket-browser-client"];
    assert.match(label, new RegExp(
      "^chrome-extension://synthetic/#" +
      "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$",
      "u",
    ));
    if (observedClientLabel !== undefined)
      assert.equal(label, observedClientLabel);
    observedClientLabel = label;
    assert.equal(label.split("#")[1],
      persistentProfile["blooket-browser-profile-id"]);
    requests.push(url);
    if ((url.endsWith("/status") && incompatibleStatus) ||
      (url.endsWith("/next") && incompatiblePoll)) {
      return Response.json({
        ok: false, code: "blooket-browser-incompatible",
      }, { status: 426 });
    }
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
  async function waitForMilestone(
    milestone: Promise<void>, label: string,
  ) {
    const stop = new AbortController();
    try {
      await Promise.race([
        milestone,
        pause(2_500, undefined, { signal: stop.signal }).then(() => {
          throw new Error("timed-out-worker-fixture-" + label);
        }),
      ]);
    } finally { stop.abort(); }
  }
  async function expectReply(command) {
    const request = job(command);
    jobs.push(request);
    const deadline = realNow() + 3000;
    while (!replies.some((reply) => reply.id === request.id)) {
      assert.ok(realNow() < deadline, "worker did not settle its request");
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
            { url: value.origin + "/", tab: { id: 99 } },
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
    const beforeForeignWorkspace = requests.length;
    const foreignWorkspace = await announce({
      origin: "http://127.0.0.1:9999", token: "b".repeat(43),
    });
    assert.deepEqual(foreignWorkspace, {
      ok: false, status: "workspace-already-connected",
    });
    assert.equal(requests.length, beforeForeignWorkspace);
    assert.equal(creates, 1);
    assert.equal(persistentProfile["blooket-owned-tab-id"], 7);
    const focused = await expectReply({ kind: "browser.activate" });
    assert.deepEqual(focused, {
      schemaVersion: 1, id: focused.id,
      ok: true, value: { focused: true },
    });
    assert.deepEqual(foregroundedTabs, [7]);
    assert.deepEqual(focusedWindows, [3]);
    tabUrl = "https://untrusted.invalid/unrelated";
    const foreignFocus = await expectReply({ kind: "browser.activate" });
    assert.deepEqual(foreignFocus, {
      schemaVersion: 1, id: foreignFocus.id,
      ok: false, code: "blooket-browser-failed",
    });
    assert.deepEqual(foregroundedTabs, [7]);
    assert.deepEqual(focusedWindows, [3]);
    assert.deepEqual(await message({ kind: "open-blooket" }), {
      ok: false, status: "blooket-tab-unavailable",
    });
    assert.deepEqual(foregroundedTabs, [7]);
    // The same local workspace must not adopt a tab navigated elsewhere.
    const disconnectedTab = await announce({ origin, token });
    assert.equal(disconnectedTab.ok, true);
    assert.equal(creates, 2);
    assert.equal(tabUrl, "https://dashboard.blooket.com/my-sets");
    assert.equal(persistentProfile["blooket-owned-tab-id"], 7);
    foregroundedTabs.length = 0;
    focusedWindows.length = 0;
    const firstSets = await expectReply({ kind: "sets.list" });
    assert.equal(firstSets.ok, true);
    assert.equal(firstSets.value.completeness, "unknown");
    assert.equal(setListReads, 2);
    assert.equal(readReloads, 1);
    // The assembled worker must compare a real model envelope, not just
    // exercise the pure comparator in isolation.
    listModelSource = libraryModelFixture({ props: {
      numSets: 5, numQuestions: 12,
    } });
    const matchedModel = await expectReply({ kind: "sets.list" });
    assert.equal(matchedModel.ok, true);
    assert.equal(matchedModel.value.completeness, "unknown");
    assert.equal(JSON.stringify(matchedModel).includes("allSets"), false);
    listModelSource = libraryModelFixture({ props: { allSets: [] } });
    const conflictingModel = await expectReply({ kind: "sets.list" });
    assert.equal(conflictingModel.ok, false);
    assert.equal(JSON.stringify(conflictingModel).includes("source"), false);
    listModelSource = null;
    // Never reload an active editor even when already on the target route.
    unsafeReadSource = true;
    const beforeSameRouteReload = readReloads;
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal(readReloads, beforeSameRouteReload);
    // Never leave an active teacher editor just to answer a set-list query.
    unsafeReadSource = true;
    tabUrl = "https://dashboard.blooket.com/edit?id=teacher-draft";
    const beforeUnsafeRead = scripts.length;
    for (const command of [
      { kind: "sets.list" },
      { kind: "sets.get", setId: "opaque id/with spaces" },
      { kind: "questions.list", setId: "set-fixture" },
    ]) {
      assert.equal((await expectReply(command)).ok, false);
      assert.equal(tabUrl,
        "https://dashboard.blooket.com/edit?id=teacher-draft");
    }
    assert.deepEqual(scripts.slice(beforeUnsafeRead), [
      "canLeaveBlooketPageForRead",
      "canLeaveBlooketPageForRead",
      "canLeaveBlooketPageForRead",
    ]);
    unsafeReadSource = false;
    tabUrl = "https://dashboard.blooket.com/my-sets";
    listFailuresRemaining = 2;
    setListReads = 0;
    const delayedSets = await expectReply({ kind: "sets.list" });
    assert.equal(delayedSets.ok, true);
    assert.equal(delayedSets.value.completeness, "unknown");
    assert.equal(setListReads, 4);
    assert.equal(listFailuresRemaining, 0);
    listReloadDuringCapture = true;
    setListReads = 0;
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal(setListReads, 1);
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
    // A read-owned editor must be canceled and its closure independently
    // observed before a metadata snapshot may escape the extension.
    // No Edit Info click when the source sidebar is malformed or drifts.
    detailSidebarMalformed = true;
    const beforeMalformedSidebar = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(scripts.slice(beforeMalformedSidebar).includes(
      "openBlooketDetailPanel",
    ), false);
    detailSidebarMalformed = false;
    detailSidebarDrifts = true;
    detailSidebarReadCount = 0;
    const beforeDriftingSidebar = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(detailSidebarReadCount, 2);
    assert.equal(scripts.slice(beforeDriftingSidebar).includes(
      "openBlooketDetailPanel",
    ), false);
    detailSidebarDrifts = false;
    detailCancelSucceeds = false;
    const beforeCancelFailure = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(scripts.slice(beforeCancelFailure).includes(
      "closeBlooketDetailPanel",
    ), true);
    assert.equal(scripts.slice(beforeCancelFailure).includes(
      "isBlooketDetailPanelClosed",
    ), false);
    detailCancelSucceeds = true;
    detailClosedSucceeds = false;
    const beforeClosureFailure = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(scripts.slice(beforeClosureFailure).includes(
      "isBlooketDetailPanelClosed",
    ), true);
    detailClosedSucceeds = true;
    detailOpenSucceeds = false;
    const beforeRejectedOpen = scripts.length;
    const rejectedDetail = await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    });
    assert.equal(rejectedDetail.ok, false);
    assert.equal(scripts.slice(beforeRejectedOpen).every(
      (name) => name === "openBlooketDetailPanel" ||
        name === "inspectBlooketDetailSidebar" ||
        name === "canLeaveBlooketPageForRead" ||
        name === "inspectBlooketDocumentOrigin",
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
      "canLeaveBlooketPageForRead",
      "inspectBlooketDocumentOrigin",
      "inspectBlooketDocumentOrigin",
      "inspectBlooketDetailSidebar",
      "inspectBlooketDetailSidebar",
      "openBlooketDetailPanel",
    ]);
    detailDrifts = true;
    const beforeDetailDrift = scripts.length;
    detailReadCount = 0;
    const driftedDetail = await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    });
    assert.equal(driftedDetail.ok, false);
    assert.equal(detailReadCount, 2);
    assert.equal(scripts.slice(beforeDetailDrift).includes(
      "closeBlooketDetailPanel",
    ), false);
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

    loseCreateAck = true;
    tabUrl = "https://dashboard.blooket.com/my-sets";
    const lostAck = await expectReply({
      kind: "sets.create", title: "Synthetic created set",
      description: "Created through bridge fixture", private: true,
    });
    assert.deepEqual(lostAck.value, {
      ok: true, remoteSetId: "created-set-fixture",
    });
    assert.equal(scripts.filter(name =>
      name === "submitBlooketCreateSetForm").length, 2);
    createSidebarMismatch = true;
    tabUrl = "https://dashboard.blooket.com/my-sets";
    const unrelated = await expectReply({
      kind: "sets.create", title: "Synthetic created set",
      description: "Created through bridge fixture", private: true,
    });
    assert.equal(unrelated.value.ok, false);
    assert.equal(scripts.filter(name =>
      name === "submitBlooketCreateSetForm").length, 3);
    createSidebarMismatch = false;
    loseCreateAck = false;
    // The fixture's prior read is a separate historical state. Reset its
    // synthetic cards before testing an initially empty Add Question slot.
    questionSaved = false;

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
    assert.equal(typeof onTabUpdated, "function");
    onTabUpdated(999, { title: "Just a moment..." }, {
      id: 999, url: "https://dashboard.blooket.com/my-sets",
    });
    onTabUpdated(7, { title: "Ordinary Blooket page" }, {
      id: 7, url: tabUrl,
    });
    assert.equal(foregroundedTabs.length, 0);
    onTabUpdated(7, { title: "Just a moment..." }, {
      id: 7, url: tabUrl, windowId: 3,
    });
    onTabUpdated(7, { title: "Just a moment..." }, {
      id: 7, url: tabUrl, windowId: 3,
    });
    const eventDeadline = realNow() + 1000;
    while (focusedWindows.length !== 1) {
      assert.ok(realNow() < eventDeadline,
        "owned background challenge did not open its browser window");
      await pause(10);
    }
    assert.deepEqual(foregroundedTabs, [7]);
    observedSessionOverride = "security-challenge";
    const challenged = await expectReply({ kind: "session.observe" });
    assert.equal(challenged.ok, true);
    assert.equal(challenged.value, "security-challenge");
    const focusedDeadline = realNow() + 1000;
    while (focusedWindows.length !== 1) {
      assert.ok(realNow() < focusedDeadline,
        "confirmed challenge did not surface its browser window");
      await pause(10);
    }
    assert.deepEqual(foregroundedTabs, [7]);
    assert.deepEqual(focusedWindows, [3]);
    const sameChallenge = await expectReply({ kind: "session.observe" });
    assert.equal(sameChallenge.value, "security-challenge");
    assert.deepEqual(foregroundedTabs, [7]);
    assert.equal((await message({ kind: "status" })).status,
      "blooket-attention-required");
    assert.equal((await message({ kind: "open-blooket" })).ok, true);
    assert.deepEqual(foregroundedTabs, [7, 7]);
    assert.deepEqual(focusedWindows, [3, 3]);
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
    // A workspace may reconnect while an older write host is awaiting a
    // browser reply. That retired relay must not submit the rest of the form.
    tabUrl = "https://dashboard.blooket.com/edit?id=set-fixture";
    questionSaved = false;
    holdWriteOpen = true;
    const staleJob = job({
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
    const beforeRetiredWrite = scripts.length;
    jobs.push(staleJob);
    await waitForMilestone(writeOpenStarted, "write-open");
    const nextToken = "b".repeat(43);
    token = nextToken;
    assert.equal((await announce({ origin, token: nextToken })).ok, true);
    releaseWriteOpen();
    await pause(200);
    assert.deepEqual(scripts.slice(beforeRetiredWrite).filter(
      (name) => name === "runBlooketAddQuestionPageAction",
    ), ["runBlooketAddQuestionPageAction"]);
    assert.equal(replies.some((reply) => reply.id === staleJob.id), false);
    tabUrl = "https://dashboard.blooket.com/my-sets";
    holdReadScript = true;
    const staleReadJob = job({ kind: "sets.list" });
    const beforeRetiredRead = scripts.length;
    jobs.push(staleReadJob);
    await waitForMilestone(readScriptStarted, "read-script");
    const thirdToken = "c".repeat(43);
    token = thirdToken;
    assert.equal((await announce({ origin, token: thirdToken })).ok, true);
    releaseReadScript();
    await pause(200);
    assert.deepEqual(scripts.slice(beforeRetiredRead).filter(
      (name) => name === "inspectBlooketPage",
    ), ["inspectBlooketPage"]);
    assert.equal(replies.some((reply) => reply.id === staleReadJob.id), false);

    tabUrl = "https://dashboard.blooket.com/edit?id=set-fixture";
    expireWriteAtOpen = true;
    const beforeExpiredWrite = scripts.length;
    const expiredWrite = await expectReply({
      kind: "questions.create",
      setId: "set-fixture", number: 1, question: "Type sun.",
      answers: [{ text: "sun", correct: true }], qType: "typing",
      random: true, answerTypes: ["exactly"], timeLimit: 15,
    });
    Date.now = realNow;
    assert.deepEqual(expiredWrite.value, {
      ok: false, kind: "browser", code: "blooket-browser-failed",
    });
    assert.deepEqual(scripts.slice(beforeExpiredWrite).filter(
      (name) => name === "runBlooketAddQuestionPageAction",
    ), ["runBlooketAddQuestionPageAction"]);

    const beforeCompatibilityStop = scripts.length;
    incompatiblePoll = true;
    const compatibilityDeadline = realNow() + 3000;
    while ((await message({ kind: "status" })).status !==
      "extension-update-required") {
      assert.ok(realNow() < compatibilityDeadline,
        "worker did not stop its incompatible relay");
      await pause(20);
    }
    assert.deepEqual(stored, {});
    incompatiblePoll = false;
    incompatibleStatus = true;
    assert.deepEqual(await announce({ origin, token }), {
      ok: false, status: "extension-update-required",
    });
    assert.equal(scripts.length, beforeCompatibilityStop);
    assert.deepEqual(stored, {});
  } finally {
    Date.now = realNow;
    releaseReadScript();
    releaseWriteOpen();
    closed = true;
    await pause(1100);
    assert.deepEqual(stored, {});
    globalThis.fetch = priorFetch;
    if (priorChrome) Object.defineProperty(globalThis, "chrome", priorChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});

test("worker startup rejects a stored tab moved outside Blooket",
  async () => {
  const priorChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const priorFetch = globalThis.fetch;
  const origin = "http://127.0.0.1:4567";
  const root = "chrome-extension://isolated-restore-fixture/";
  let listener;
  let removed = 0;
  let created = 0;
  const mocked = {
    runtime: {
      getURL: path => root + path,
      onMessage: { addListener: callback => { listener = callback; } },
    },
    tabs: {
      onUpdated: { addListener: () => {} },
      query: async () => [],
      get: async () => ({ id: 7, url: "https://untrusted.invalid" }),
      create: async () => { created++; throw Error("unexpected-create"); },
    },
    storage: {
      session: {
        get: async () => ({ connection: {
          origin, token: "a".repeat(43), tabId: 7,
        } }),
        remove: async key => {
          assert.equal(key, "connection");
          removed++;
        },
      },
    },
  };
  Object.defineProperty(globalThis, "chrome", {
    value: mocked, configurable: true,
  });
  globalThis.fetch = async () => {
    throw Error("stale-connection-must-not-poll");
  };
  try {
    await import(
      "../../../../src/service/browser-extension/adapter-inbound/worker.ts" +
      "?stale-stored-tab-recovery"
    );
    const result = await new Promise(resolve => {
      assert.equal(listener({ kind: "status" }, {
        url: root + "src/ui/browser-extension/adapter-inbound/popup.html",
      }, resolve), true);
    });
    assert.deepEqual(result, { ok: true, status: "waiting-for-workspace" });
    assert.equal(removed, 1);
    assert.equal(created, 0);
  } finally {
    if (priorChrome)
      Object.defineProperty(globalThis, "chrome", priorChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
    globalThis.fetch = priorFetch;
  }
  },
);

test("worker startup only restores a live, admitted Blooket tab",
  async () => {
  const priorChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const priorFetch = globalThis.fetch;
  const origin = "http://127.0.0.1:4567";
  const root = "chrome-extension://restored-fixture/";
  let listener;
  let removed = 0;
  let gets = 0;
  let creates = 0;
  let documentOrigin = 1_000;
  let readReloads = 0;
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        getURL: path => root + path,
        onMessage: { addListener: callback => { listener = callback; } },
      },
      tabs: {
        onUpdated: { addListener: () => {} },
        query: async () => [],
        get: async id => {
          gets++;
          return { id, url: "https://dashboard.blooket.com/my-sets" };
        },
        create: async () => { creates++; throw Error("unexpected-create"); },
      },
      storage: {
        session: {
          get: async () => ({ connection: {
            origin, token: "a".repeat(43), tabId: 7,
          } }),
          remove: async () => { removed++; },
        },
      },
    },
  });
  let releaseFetch!: () => void;
  const waitFetch = new Promise<void>(resolve => { releaseFetch = resolve; });
  globalThis.fetch = async () => {
    await waitFetch;
    return new Response(null, { status: 426 });
  };
  try {
    await import(
      "../../../../src/service/browser-extension/adapter-inbound/worker.ts" +
      "?valid-stored-tab-restoration"
    );
    await pause(30);
    const popup = () => new Promise(resolve => {
      assert.equal(listener({ kind: "status" }, {
        url: root + "src/ui/browser-extension/adapter-inbound/popup.html",
      }, resolve), true);
    });
    assert.deepEqual(await popup(), { ok: true, status: "connected" });
    releaseFetch();
    await pause(30);
    assert.deepEqual(await popup(),
      { ok: true, status: "extension-update-required" });
    assert.ok(gets >= 2);
    assert.equal(creates, 0);
    assert.equal(removed, 1);
  } finally {
    releaseFetch();
    if (priorChrome)
      Object.defineProperty(globalThis, "chrome", priorChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
    globalThis.fetch = priorFetch;
  }
  },
);

test("worker startup discards malformed stored connection bytes",
  async () => {
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const previousFetch = globalThis.fetch;
  const root = "chrome-extension://bad-stored-fixture/";
  let callback;
  let removed = 0;
  let gets = 0;
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        getURL: path => root + path,
        onMessage: { addListener: listener => { callback = listener; } },
      },
      tabs: {
        onUpdated: { addListener: () => {} },
        query: async () => [],
        get: async () => { gets++; throw Error("unexpected-tab-get"); },
      },
      storage: {
        session: {
          get: async () => ({ connection: {
            origin: "https://untrusted.invalid",
            token: "not-a-token", tabId: 7,
          } }),
          remove: async key => {
            assert.equal(key, "connection");
            removed++;
            throw Error("synthetic-storage-readonly");
          },
        },
      },
    },
  });
  globalThis.fetch = async () => { throw Error("unexpected-fetch"); };
  try {
    await import(
      "../../../../src/service/browser-extension/adapter-inbound/worker.ts" +
      "?invalid-stored-connection-cleanup"
    );
    const status = await new Promise(resolve => {
      assert.equal(callback({ kind: "status" }, {
        url: root + "src/ui/browser-extension/adapter-inbound/popup.html",
      }, resolve), true);
    });
    assert.deepEqual(status, { ok: true, status: "waiting-for-workspace" });
    assert.equal(removed, 1);
    assert.equal(gets, 0);
  } finally {
    if (previousChrome)
      Object.defineProperty(globalThis, "chrome", previousChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
    globalThis.fetch = previousFetch;
  }
  },
);

test("a recycled saved tab ID cannot claim a teacher editor",
  async () => {
  const priorChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const priorFetch = globalThis.fetch;
  const origin = "http://127.0.0.1:4567";
  const ext = "chrome-extension://recycled-tab-fixture/";
  let listener;
  const created: number[] = [];
  const stored: Record<string, unknown> = { "blooket-owned-tab-id": 7 };
  const sessions: Record<string, unknown> = {};
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        getURL: (part: string) => ext + part,
        onMessage: { addListener: (fn: unknown) => { listener = fn; } },
      },
      tabs: {
        onUpdated: { addListener: () => {} },
        query: async () => [],
        get: async (id: number) => ({ id, status: "complete",
          url: id === 7
            ? "https://dashboard.blooket.com/edit?id=teacher-draft"
            : "https://dashboard.blooket.com/my-sets" }),
        create: async () => {
          created.push(8);
          return { id: 8, url: "https://dashboard.blooket.com/my-sets",
            status: "complete" };
        },
      },
      storage: {
        local: {
          get: async () => ({ ...stored }),
          set: async (value: Record<string, unknown>) => {
            Object.assign(stored, value);
          },
        },
        session: {
          get: async () => ({ ...sessions }),
          set: async (value: Record<string, unknown>) => {
            Object.assign(sessions, value);
          },
          remove: async (key: string) => { delete sessions[key]; },
        },
      },
    },
  });
  globalThis.fetch = async (url: string) =>
    url.endsWith("/api/browser-bridge/status")
      ? Response.json({ ok: true, pending: 0, connected: false })
      : new Response(null, { status: 426 });
  try {
    await import(
      "../../../../src/service/browser-extension/adapter-inbound/worker.ts" +
      "?recycled-editor-tab"
    );
    const reply = await new Promise(resolve => {
      assert.equal(listener({ kind: "workspace-ready", origin,
        token: "a".repeat(43) }, {
        url: origin + "/", tab: { id: 99 },
      }, resolve), true);
    });
    assert.deepEqual(reply, { ok: true, status: "connected" });
    assert.deepEqual(created, [8]);
    assert.equal(stored["blooket-owned-tab-id"], 8);
    assert.equal((sessions.connection as { tabId: number }).tabId, 8);
    // Let the synthetic 426 retire its relay before restoring global chrome.
    for (let attempt = 0; "connection" in sessions && attempt < 50;
      attempt++) await pause(10);
    assert.equal("connection" in sessions, false);
  } finally {
    if (priorChrome)
      Object.defineProperty(globalThis, "chrome", priorChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
    globalThis.fetch = priorFetch;
  }
  },
);

test("Cloudflare landing tabs survive reload without claiming editor tabs",
  async () => {
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const previousFetch = globalThis.fetch;
  const origin = "http://127.0.0.1:4567";
  const cases = [
    ["Just a moment...",
      "https://dashboard.blooket.com/my-sets?__cf_chl_rt_tk=fake", 0],
    ["My Sets",
      "https://dashboard.blooket.com/my-sets?__cf_chl_rt_tk=fake", 1],
    ["Just a moment...",
      "https://dashboard.blooket.com/edit?id=teacher-draft", 1],
    ["Just a moment...",
      "https://dashboard.blooket.com/my-sets?filter=private", 1],
    ["Just a moment...",
      "https://dashboard.blooket.com/my-sets?__cf_chl_rt_tk=x" +
        "&__cf_chl_rt_tk=y", 1],
    ["Just a moment...",
      "https://dashboard.blooket.com/my-sets?__cf_chl_rt_tk=", 1],
    ["Just a moment...",
      "https://dashboard.blooket.com/my-sets?__cf_chl_rt_tk=" +
        "x".repeat(1_025), 1],
    ["Just a moment...",
      "https://dashboard.blooket.com/my-sets?__cf_chl_rt_tk=fake#draft", 1],
    ["Just a moment...",
      "https://id.blooket.com/login?__cf_chl_rt_tk=fake", 0],
    ["Just a moment...",
      "https://dashboard.blooket.com/create?__cf_chl_rt_tk=fake", 1],
  ] as const;
  try {
    for (const [index, scenario] of cases.entries()) {
      const [title, url, expectedCreated] = scenario;
      const extension = "chrome-extension://cf-tab-fixture/";
      let listener;
      let created = 0;
      const local: Record<string, unknown> = { "blooket-owned-tab-id": 7 };
      const session: Record<string, unknown> = {};
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: {
          runtime: {
            getURL: (path: string) => extension + path,
            onMessage: { addListener: (fn: unknown) => { listener = fn; } },
          },
          tabs: {
            onUpdated: { addListener: () => {} },
            query: async () => [],
            get: async (id: number) => ({ id, url, title }),
            create: async () => {
              created++;
              return { id: 8, url: "https://dashboard.blooket.com/my-sets",
                title: "My Sets" };
            },
          },
          storage: {
            local: {
              get: async () => ({ ...local }),
              set: async (value: Record<string, unknown>) => {
                Object.assign(local, value);
              },
            },
            session: {
              get: async () => ({ ...session }),
              set: async (value: Record<string, unknown>) => {
                Object.assign(session, value);
              },
              remove: async (key: string) => { delete session[key]; },
            },
          },
        },
      });
      globalThis.fetch = async (requestUrl: string) =>
        requestUrl.endsWith("/api/browser-bridge/status")
          ? Response.json({ ok: true, pending: 0, connected: false })
          : new Response(null, { status: 426 });
      await import(
        "../../../../src/service/browser-extension/adapter-inbound/worker.ts" +
        "?cloudflare-owned-tab-" + index
      );
      const result = await new Promise(resolve => {
        assert.equal(listener({ kind: "workspace-ready", origin,
          token: "a".repeat(43) }, { url: origin + "/", tab: { id: 99 } },
        resolve), true);
      });
      assert.deepEqual(result, { ok: true, status: "connected" });
      assert.equal(created, expectedCreated, url.split("?")[0]);
      assert.equal((session.connection as { tabId: number }).tabId,
        expectedCreated === 0 ? 7 : 8);
      for (let i = 0; "connection" in session && i < 50; i++)
        await pause(10);
      assert.equal("connection" in session, false);
    }
  } finally {
    if (previousChrome)
      Object.defineProperty(globalThis, "chrome", previousChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
    globalThis.fetch = previousFetch;
  }
  },
);
