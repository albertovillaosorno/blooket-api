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
  let onTabRemoved;
  let tabUrl = "https://dashboard.blooket.com/my-sets";
  let creates = 0;
  let documentOrigin = 1_000;
  let readReloads = 0;
  const foregroundedTabs: number[] = [];
  const focusedWindows: number[] = [];
  let closed = false;
  let switchAfterActivate = false;
  let humanTabGetter: "url" | "windowId" | "pendingUrl" | null = null;
  let humanActivationGetter = false;
  let humanTabGetterReads = 0;
  let validStatus = true;
  let partialJobResponse: false | "partial" | "ranged-200" = false;
  let partialJobDelivered = false;
  let reuseBridgeResponseChunks = false;
  let recycledBridgeChunks = 0;
  let incompatibleStatus = false;
  let incompatiblePoll = false;
  let unsafeReadSource = false;
  let interruptedReadPanel = false;
  let submittedReadOwner = false;
  let submittedReadDirty = false;
  let submittedBoundSet = "set-fixture";
  let detachedSourceOwnerLost = false;
  let detachedSourceChallenge = false;
  let detachedSourceReload = false;
  let pendingSourceRedirect = false;
  let pendingAfterActivate = false;
  let pendingSourceAfterRead = false;
  let pendingAfterSetObservation = false;
  let pendingAfterDetailSidebar = false;
  let pendingDuringSessionScript = false;
  let detachedTabNavigatedByUser = false;
  let detachedTabActivatedByUser = false;
  let detachedTabActiveGetter = false;
  let detachedTabGetterReads = 0;
  let detachedCreated = 0;
  let detachedClosed = 0;
  let capabilityTabsCreated = 0;
  let capabilityTabsClosed = 0;
  let detachedCapabilityUrl = "";
  let detachedCapabilityDocumentOrigin = 90_000;
  let detachedCapabilityDrift = false;
  let detachedCapabilitySourceReload = false;
  let detachedCapabilityChallenge = false;
  let capabilityPendingGets = 0;
  let capabilityBlankGets = 0;
  let detachedBlankGets = 0;
  let capabilityNeverCommits = false;
  let capabilityPendingRedirect = false;
  let detachedUrl = "";
  let denyFinalReadGuard = false;
  let readGuardChecks = 0;
  let reloadDuringLeave = false;
  let detailOpenSucceeds = true;
  let detailSidebarDrifts = false;
  let detailSidebarAfterCancelDrifts = false;
  let detailSecondAfterCancelDrifts = false;
  let detailCancelObserved = false;
  let detailSidebarReadCount = 0;
  let detailSidebarFailuresRemaining = 0;
  let detailSidebarFailureAtRead = 0;
  let detailSidebarMalformed = false;
  let detailSidebarProxy = false;
  let detailSidebarProxyReads = 0;
  let detailCancelSucceeds = true;
  let detailCancelReplyLost = false;
  let detailReadWatchCanRelease = false;
  let detailReleaseReplacesDocument = false;
  let detailClosedSucceeds = true;
  let detailPendingRecoverySafe = false;
  let detailPendingRecoveryChecks = 0;
  let detailPanelMountsAfterFirstProbe = false;
  let detailMalformedReply = false;
  let detailPanelProxy = false;
  let detailPanelProxyReads = 0;
  let detailDrifts = false;
  let detailReadCount = 0;
  let detailPanelFailuresRemaining = 0;
  let expireDetailRead = false;
  let detailSecondReadHasHiddenField = false;
  let detailReadWrongId = false;
  let detailSwitchTabAfterScript = false;
  let detailSwitchTabAfterOpen = false;
  let detailReloadDuringSidebar = false;
  let detailReloadAfterOpen = false;
  let detailReloadDuringInspection = false;
  let sessionSwitchAfterScript: string | null = null;
  let observedSessionOverride: string | null = null;
  let automaticVerificationReads = 0;
  let verificationRouteAfter: string | null = null;
  let verificationTabReads = 0;
  let currentChallengeTitle: string | undefined;
  let sessionSecondHasHiddenField = false;
  let sessionReadProbeCount = 0;
  let driftSessionAtSameRoute = false;
  let reloadSessionAtSameRoute = false;
  let sessionObservations = 0;
  let listFailuresRemaining = 0;
  let listDrifts = false;
  let listEmpty = false;
  let listEmptyDrifts = false;
  let listInvalidEnvelope = false;
  let listSecondHiddenEnvelope = false;
  let listSecondAccessorEnvelope = false;
  let listSecondNonEnumerableField = false;
  let listSecondHiddenRow = false;
  let listPrototypeSerialization = false;
  let listProxyCompleteness = false;
  let listProxyReads = 0;
  let detailPrototypeSerialization = false;
  let sessionPrototypeSerialization = false;
  let sessionProxyState = false;
  let sessionProxyReads = 0;
  let inheritedSerializerCalls = 0;
  let listFirstInvalidRow = false;
  let listModelSource: string | null = null;
  let listModelNestedFrame = false;
  let listModelFrameAccessor = false;
  let listModelFrameAccessorReads = 0;
  let listReloadDuringCapture = false;
  let setListReads = 0;
  let questionPanelCloses = true;
  let addQuestionPanelReady = false;
  let questionSaved = true;
  let loseCreateAck = false;
  let createSidebarMismatch = false;
  let createdSetVisibility: "private" | "public" = "private";
  let capabilityPanelReady = false;
  let capabilityDrawerOpen = false;
  let holdWriteOpen = false;
  let expireWriteAtOpen = false;
  let slowWriteAtOpen = false;
  const realNow = Date.now;
  const priorPerformanceNow =
    Object.getOwnPropertyDescriptor(performance, "now");
  let readClock = 0;
  let providerClockUnavailable = false;
  // The pacing policy has deterministic deadline tests of its own. Keep this
  // transport fixture fast while preserving its real relay/deadline timers.
  Object.defineProperty(performance, "now", {
    configurable: true, value: () => {
      if (providerClockUnavailable) return Number.NaN;
      readClock += 5_000;
      return readClock;
    },
  });
  let holdReadScript = false;
  let reportReadScript!: () => void;
  let releaseReadScript!: () => void;
  const readScriptStarted = new Promise<void>((resolve) => {
    reportReadScript = resolve;
  });
  const readScriptRelease = new Promise<void>((resolve) => {
    releaseReadScript = resolve;
  });
  let holdDetachedCreate = false;
  let loseDetachedCreateAck = false;
  let signalDetachedCreate!: () => void;
  let releaseDetachedCreate!: () => void;
  const detachedCreateStarted = new Promise<void>(resolve => {
    signalDetachedCreate = resolve;
  });
  const detachedCreateRelease = new Promise<void>(resolve => {
    releaseDetachedCreate = resolve;
  });
  let holdDetachedRead = false;
  let signalDetachedRead!: () => void;
  let releaseDetachedRead!: () => void;
  const detachedReadStarted = new Promise<void>(resolve => {
    signalDetachedRead = resolve;
  });
  const detachedReadRelease = new Promise<void>(resolve => {
    releaseDetachedRead = resolve;
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
      onRemoved: { addListener: callback => { onTabRemoved = callback; } },
      onUpdated: {
        addListener: callback => { onTabUpdated = callback; },
      },
      query: async () => [{ id: 99, url: origin + "/" }],
      create: async ({ url, active }) => {
        if (active === false && url.startsWith(
          "https://dashboard.blooket.com/edit?id=")) {
          detachedCreated++;
          detachedUrl = url;
          if (loseDetachedCreateAck) {
            loseDetachedCreateAck = false;
            throw Error("lost-temporary-create-ack");
          }
          if (holdDetachedCreate) {
            holdDetachedCreate = false;
            signalDetachedCreate();
            await detachedCreateRelease;
          }
          return { id: 83, url, status: "complete", windowId: 3 };
        }
        if (active === false &&
            tabUrl === "https://dashboard.blooket.com/edit?id=set-fixture" &&
            (url === "https://dashboard.blooket.com/my-sets" ||
             url === "https://dashboard.blooket.com/my-sets?filter=recent")) {
          capabilityTabsCreated++;
          detachedCapabilityUrl = url;
          return { id: 84, url, status: "complete", windowId: 3 };
        }
        creates++;
        tabUrl = url;
        return { id: 7, url, status: "complete", windowId: 3 };
      },
      remove: async (id) => {
        if (id === 84) {
          capabilityTabsClosed++;
          detachedCapabilityUrl = "";
          return;
        }
        assert.equal(id, 83);
        detachedClosed++;
        detachedUrl = "";
      },
      get: async (id) => {
        if (id === 84) {
          if (!detachedCapabilityUrl) throw Error("closed-capability-tab");
          if (pendingSourceAfterRead) pendingSourceRedirect = true;
          if (capabilityPendingRedirect)
            return { id, url: detachedCapabilityUrl,
              pendingUrl: "https://foreign.invalid/teacher-navigation",
              status: "loading", active: false, windowId: 3 };
          if (capabilityBlankGets-- > 0)
            return { id, url: "about:blank", status: "complete",
              active: false, windowId: 3 };
          if (capabilityNeverCommits || capabilityPendingGets-- > 0)
            return { id, pendingUrl: detachedCapabilityUrl,
              status: "loading", active: false, windowId: 3 };
          return { id, url: detachedCapabilityUrl,
            status: "complete", windowId: 3 };
        }
        if (id === 83) {
          if (!detachedUrl) throw Error("closed-detached-tab");
          if (pendingSourceAfterRead) pendingSourceRedirect = true;
          if (detachedBlankGets-- > 0)
            return { id, url: "about:blank", status: "complete",
              active: false, windowId: 3 };
          const tab = { id, url: detachedUrl, status: "complete", windowId: 3,
            active: detachedTabActivatedByUser };
          if (detachedTabActiveGetter) Object.defineProperty(tab, "active", {
            enumerable: true, get() {
              detachedTabGetterReads++;
              return false;
            },
          });
          return tab;
        }
        if (closed) throw new Error("closed-tab");
        assert.equal(id, 7);
        if (humanTabGetter) {
          const tab = { id, url: tabUrl, status: "complete", windowId: 3 };
          Object.defineProperty(tab, humanTabGetter, { enumerable: true,
            get() {
              humanTabGetterReads++;
              return humanTabGetter === "url" ? tabUrl
                : humanTabGetter === "windowId" ? 3 : undefined;
            },
          });
          return tab;
        }
        if (verificationTabReads > 0 && --verificationTabReads === 0) {
          tabUrl = verificationRouteAfter!;
          documentOrigin += 1_000;
        }
        return { id, url: tabUrl, status: "complete", windowId: 3,
          ...(currentChallengeTitle ? { title: currentChallengeTitle } : {}),
          ...(pendingSourceRedirect ||
              (pendingAfterSetObservation && setListReads > 0) ||
              (pendingAfterDetailSidebar && detailSidebarReadCount > 0) ? {
            pendingUrl: "https://foreign.invalid/teacher-navigation",
          } : {}) };
      },
      update: async (id, { url, active }) => {
        if (id === 84) {
          if (url !== undefined) {
            detachedCapabilityUrl = url;
            detachedCapabilityDocumentOrigin += 1_000;
          }
          return { id, url: detachedCapabilityUrl,
            status: "complete", windowId: 3 };
        }
        assert.equal(id, 7);
        if (url !== undefined) {
          tabUrl = url;
          documentOrigin += 1_000;
        }
        if (active === true) {
          foregroundedTabs.push(id);
          if (pendingAfterActivate) {
            pendingAfterActivate = false;
            pendingSourceRedirect = true;
          }
          if (switchAfterActivate) {
            switchAfterActivate = false;
            tabUrl = "https://untrusted.invalid/after-activation";
          }
        }
        if (humanActivationGetter && active === true) {
          humanActivationGetter = false;
          const result = { id, url: tabUrl, status: "complete", windowId: 3 };
          Object.defineProperty(result, "windowId", { enumerable: true,
            get() { humanTabGetterReads++; return 3; },
          });
          return result;
        }
        return { id, url: tabUrl, status: "complete", windowId: 3 };
      },
      reload: async (id, options) => {
        if (id === 84) {
          detachedCapabilityDocumentOrigin += 1_000;
          return;
        }
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
        if (target.tabId === 84) {
          scripts.push(func.name + ":capabilities-detached");
          if (func.name === "inspectBlooketDocumentOrigin")
            return [{ result: detachedCapabilityDocumentOrigin }];
          if (func.name === "canLeaveBlooketPageForRead")
            return [{ result: true }];
          if (func.name === "captureBlooketLibraryModel")
            return [{ result: null }];
          if (func.name === "inspectBlooketPage") {
            const op = args?.[0];
            if (op?.kind === "session.observe")
              return [{ result: { ok: true, value: "my-sets" } }];
            if (op?.kind === "sets.list") {
              if (detachedCapabilitySourceReload) {
                detachedCapabilitySourceReload = false;
                documentOrigin += 1_000;
              }
              if (detachedCapabilityChallenge) {
                detachedCapabilityChallenge = false;
                observedSessionOverride = "security-challenge";
              }
              return [{ result: { ok: true, value: {
                items: [{ schemaVersion: 1, id: detachedCapabilityDrift
                  ? "different-set" : "set-fixture",
                  title: "Synthetic capability fixture" }],
                completeness: "unknown",
              } } }];
            }
          }
          throw Error("unexpected-capability-read-script");
        }
        if (target.tabId === 83) {
          scripts.push(func.name + ":detached");
          if (func.name === "inspectBlooketDocumentOrigin")
            return [{ result: 50_000 }];
          if (func.name === "inspectBlooketPage")
            return [{ result: { ok: true, value: "edit" } }];
          if (func.name === "listBlooketQuestionNumbers") {
            if (detachedTabNavigatedByUser) {
              detachedTabNavigatedByUser = false;
              detachedUrl = "https://untrusted.invalid/owner-navigation";
            }
            if (holdDetachedRead) {
              holdDetachedRead = false;
              signalDetachedRead();
              await detachedReadRelease;
            }
            if (detachedSourceReload) {
              detachedSourceReload = false;
              documentOrigin += 1_000;
            }
            if (detachedSourceOwnerLost) {
              detachedSourceOwnerLost = false;
              submittedReadOwner = false;
            }
            if (detachedSourceChallenge) {
              detachedSourceChallenge = false;
              observedSessionOverride = "security-challenge";
            }
            return [{ result: { ok: true, value: [] } }];
          }
          throw Error("unexpected-detached-question-script");
        }
        assert.equal(target.tabId, 7);
        scripts.push(func.name);
        if (func.name === "inspectBlooketQuestionWriteStage")
          return [{ result: { kind: "blooket-question-write-stage",
            stage: submittedReadDirty && submittedReadOwner
              ? "post-submit-interrupted"
              : submittedReadOwner ? "submit-attempted" : "no-owner" } }];
        if (func.name === "inspectBlooketSubmittedQuestionOwner") {
          assert.equal(args.length, 1);
          return [{ result: submittedReadOwner && !submittedReadDirty &&
            args[0] === submittedBoundSet }];
        }
        if (func.name === "inspectBlooketSessionDocumentOrigin") {
          assert.deepEqual(args, [tabUrl]);
          return [{ result: documentOrigin }];
        }
        if (func.name === "inspectBlooketDocumentOrigin") {
          assert.deepEqual(args, [tabUrl]);
          return [{ result: documentOrigin }];
        }
        if (func.name === "releaseClosedBlooketDetailReadWatch") {
          const released = detailReadWatchCanRelease &&
            detailCancelObserved;
          if (detailReleaseReplacesDocument) {
            detailReleaseReplacesDocument = false;
            documentOrigin += 1_000;
          }
          return [{ result: released }];
        }
        if (func.name === "canLeaveBlooketPageForRead") {
          readGuardChecks++;
          if (reloadDuringLeave) {
            reloadDuringLeave = false;
            documentOrigin += 1_000;
          }
          return [{ result: !unsafeReadSource &&
            !(denyFinalReadGuard && readGuardChecks >= 2) }];
        }
        if (func.name === "captureBlooketLibraryModel") {
          if (listReloadDuringCapture) {
            listReloadDuringCapture = false;
            // A background navigation may replace this exact URL's document
            // between the DOM and initial-model inspections.
            documentOrigin += 1_000;
          }
          const result = { result: listModelSource === null ? null : {
            build: BLOOKET_LIBRARY_MODEL_BUILD, source: listModelSource,
          } } as { result: unknown; frameId?: number };
          if (listModelNestedFrame) {
            listModelNestedFrame = false;
            result.frameId = 2;
          }
          if (listModelFrameAccessor) {
            listModelFrameAccessor = false;
            Object.defineProperty(result, "frameId", {
              enumerable: true,
              get() { listModelFrameAccessorReads++;
                throw new Error("frame getter must not run"); },
            });
          }
          return [result];
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
          if (detailSidebarFailuresRemaining > 0 ||
              detailSidebarReadCount === detailSidebarFailureAtRead) {
            detailSidebarFailuresRemaining = Math.max(0,
              detailSidebarFailuresRemaining - 1);
            return [{ result: {
              ok: false, code: "blooket-browser-failed",
            } }];
          }
          if (detailReloadDuringSidebar) {
            detailReloadDuringSidebar = false;
            documentOrigin += 1_000;
          }
          const sidebar = detailSidebarMalformed ? {
            ok: true, extra: "not-admitted",
            value: { title: "Synthetic", description: "" },
          } : {
            ok: true, value: {
              title: (detailSidebarAfterCancelDrifts &&
                  detailCancelObserved) ||
                  (detailSecondAfterCancelDrifts && detailCancelObserved &&
                    detailSidebarReadCount % 2 === 0)
                ? "Changed after Cancel"
                : detailSidebarDrifts && detailSidebarReadCount % 2 === 0
                  ? "Local unsaved title" : "Synthetic",
              description: "",
            },
          };
          if (detailPrototypeSerialization) Object.setPrototypeOf(
            sidebar.value, { toJSON() {
              inheritedSerializerCalls++;
              throw new Error("untrusted-sidebar-serializer");
            } },
          );
          if (detailSidebarProxy) {
            return [{ result: new Proxy({ ok: false,
              value: sidebar.value }, { get(target, key) {
              if (key === "ok") { detailSidebarProxyReads++; return true; }
              return Reflect.get(target, key);
            } }) }];
          }
          return [{ result: sidebar }];
        }
        if (func.name === "closeBlooketDetailPanel") {
          if (args?.[0] === "created-set-fixture") {
            assert.deepEqual(args, ["created-set-fixture", {
              title: "Synthetic created set",
              description: "Created through bridge fixture",
            }, {
              title: "Synthetic created set",
              description: "Created through bridge fixture",
              visibility: createdSetVisibility,
            }]);
            return [{ result: true }];
          }
          assert.deepEqual(args, [
            "opaque id/with spaces",
            { title: "Synthetic", description: "" },
            { title: "Synthetic", description: "", visibility: "private" },
          ]);
          if (detailCancelSucceeds || detailCancelReplyLost)
            detailCancelObserved = true;
          return [{ result: detailCancelSucceeds }];
        }
        if (func.name === "isBlooketDetailPanelClosed") {
          if (unsafeReadSource) return [{ result: false }];
          if (args?.[1] === true) {
            detailPendingRecoveryChecks++;
            if (detailPanelMountsAfterFirstProbe &&
                detailPendingRecoveryChecks === 1) {
              detailPanelMountsAfterFirstProbe = false;
              setTimeout(() => { detailPendingRecoverySafe = false; }, 10);
            }
            return [{ result: detailPendingRecoverySafe }];
          }
          return [{ result: detailClosedSucceeds }];
        }
        if (func.name === "openBlooketDetailPanel") {
          if (args?.[0] === "created-set-fixture")
            return [{ result: true }];
          assert.deepEqual(args, ["opaque id/with spaces"]);
          detailCancelObserved = false;
          if (detailSwitchTabAfterOpen) {
            detailSwitchTabAfterOpen = false;
            tabUrl = "https://dashboard.blooket.com/edit?id=another-set";
          }
          if (detailReloadAfterOpen) {
            detailReloadAfterOpen = false;
            documentOrigin += 1_000;
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
          if (unsafeReadSource) {
            if (!interruptedReadPanel || args[0] !== "set-fixture")
              return [{ result: false }];
            interruptedReadPanel = false;
            unsafeReadSource = false;
          }
          assert.deepEqual(args, ["set-fixture"]);
          return [{ result: questionPanelCloses }];
        }
        if (func.name === "isBlooketQuestionPanelClosed") {
          assert.deepEqual(args, ["set-fixture"]);
          return [{ result: questionPanelCloses }];
        }
        if (func.name === "prepareBlooketQuestionControls") {
          assert.equal(typeof args?.[0], "string");
          assert.equal(JSON.parse(args[0]).setId, "set-fixture");
          return [{ result: true }];
        }
        if (func.name === "inspectBlooketPreparedQuestionEcho") {
          assert.equal(typeof args?.[0], "string");
          assert.equal(JSON.parse(args[0]).setId, "set-fixture");
          return [{ result: true }];
        }
        if (func.name === "runBlooketAddQuestionPageAction") {
          if (args[0] === "open") {
            assert.equal(args[1], "set-fixture");
            addQuestionPanelReady = true;
            if (expireWriteAtOpen) {
              expireWriteAtOpen = false;
              Date.now = () => realNow() + 65_000;
            }
            if (slowWriteAtOpen) {
              slowWriteAtOpen = false;
              Date.now = () => realNow() + 40_000;
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
          if (args[0] === "prepare") {
            assert.equal(typeof args[1], "string");
            assert.equal(JSON.parse(args[1]).setId, "set-fixture");
            return [{ result: { ok: true } }];
          }
          if (args[0] === "submit") {
            assert.equal(typeof args[1], "string");
            assert.equal(JSON.parse(args[1]).setId, "set-fixture");
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
            pendingDuringSessionScript) {
          pendingDuringSessionScript = false;
          pendingSourceRedirect = true;
        }
        if (operation.kind === "session.observe" && sessionProxyState) {
          const state = { ok: true, value: "signed-out" };
          return [{ result: new Proxy(state, { get(target, key) {
            if (key === "value") {
              sessionProxyReads++;
              return "my-sets";
            }
            return Reflect.get(target, key);
          } }) }];
        }
        if (operation.kind === "session.observe" &&
            sessionSecondHasHiddenField) {
          sessionReadProbeCount++;
          if (sessionReadProbeCount === 2) {
            const reply = { ok: true, value: "my-sets" };
            Object.defineProperty(reply, "hidden", {
              value: "untrusted", enumerable: false,
            });
            return [{ result: reply }];
          }
        }
        if (operation.kind === "session.observe" &&
            automaticVerificationReads > 0) {
          automaticVerificationReads--;
          if (automaticVerificationReads === 0 && verificationRouteAfter)
            verificationTabReads = 2;
          return [{ result: { ok: true, value: "security-challenge" } }];
        }
        if (operation.kind === "session.observe" &&
            observedSessionOverride !== null) {
          return [{ result: { ok: true, value: observedSessionOverride } }];
        }
        if (operation.kind === "session.observe" &&
            reloadSessionAtSameRoute) {
          reloadSessionAtSameRoute = false;
          documentOrigin += 1_000;
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
        if (operation.kind === "sets.get" &&
            operation.setId === "created-set-fixture") {
          return [{ result: { ok: true, value: {
            schemaVersion: 1, id: "created-set-fixture",
            title: "Synthetic created set",
            description: "Created through bridge fixture",
            visibility: createdSetVisibility,
          } } }];
        }
        if (operation.kind === "sets.get") {
          if (detailPanelFailuresRemaining > 0) {
            detailPanelFailuresRemaining--;
            if (expireDetailRead) {
              expireDetailRead = false;
              // Cross the polling cutoff without expiring the reserved
              // cleanup window, which must still re-check tab ownership.
              Date.now = () => realNow() + 22_500;
            }
            return [{ result: {
              ok: false, code: "blooket-browser-failed",
            } }];
          }
          detailReadCount++;
          if (detailReloadDuringInspection) {
            detailReloadDuringInspection = false;
            documentOrigin += 1_000;
          }
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
          const reply = { ok: true, value: {
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
            } };
          if (listProxyCompleteness) {
            reply.value.completeness = "complete";
            reply.value = new Proxy(reply.value, { get(target, key) {
              if (key === "completeness") {
                listProxyReads++;
                return "unknown";
              }
              return Reflect.get(target, key);
            } });
          }
          if (listPrototypeSerialization) {
            const unexpected = { toJSON() {
              inheritedSerializerCalls++;
              throw new Error("untrusted-list-serializer");
            } };
            Object.setPrototypeOf(reply, unexpected);
            Object.setPrototypeOf(reply.value, unexpected);
            if (reply.value.items.length > 0) {
              Object.setPrototypeOf(reply.value.items[0], unexpected);
              Object.setPrototypeOf(reply.value.items,
                Object.assign(Object.create(Array.prototype), unexpected));
            }
          }
          if (setListReads === 2 && listSecondHiddenEnvelope)
            Object.defineProperty(reply, "hidden", {
              value: "untrusted", enumerable: false,
            });
          if (setListReads === 2 && listSecondAccessorEnvelope)
            Object.defineProperty(reply, "value", {
              enumerable: true,
              get() { throw new Error("untrusted worker getter"); },
            });
          if (setListReads === 2 && listSecondNonEnumerableField)
            Object.defineProperty(reply, "value", {
              enumerable: false, value: reply.value,
            });
          if (setListReads === 2 && listSecondHiddenRow)
            Object.defineProperty(reply.value.items[0], "hidden", {
              value: "untrusted", enumerable: false,
            });
          if (setListReads === 1 && listFirstInvalidRow)
            reply.value.items[0].title = "";
          return [{ result: reply }];
        }
        const reply = [
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
                        id: detailReadWrongId ? "unrelated-set" :
                          operation.setId,
                        title: detailDrifts && detailReadCount % 2 === 0
                          ? "Changed synthetic title" : "Synthetic",
                        description: "",
                        visibility: "private",
                      },
            },
          },
        ];
        if (operation.kind === "session.observe" &&
            sessionPrototypeSerialization)
          Object.setPrototypeOf(reply[0]!.result, { toJSON() {
            inheritedSerializerCalls++;
            throw new Error("untrusted-session-serializer");
          } });
        if (operation.kind === "sets.get" && detailPanelProxy) {
          const original = reply[0]!.result;
          reply[0]!.result = new Proxy({ ...original, ok: false }, {
            get(target, key) {
              if (key === "ok") { detailPanelProxyReads++; return true; }
              return Reflect.get(target, key);
            },
          });
        }
        if (operation.kind === "sets.get" &&
            detailPrototypeSerialization)
          Object.setPrototypeOf(reply[0]!.result.value, { toJSON() {
            inheritedSerializerCalls++;
            throw new Error("untrusted-detail-serializer");
          } });
        if (operation.kind === "sets.get" && detailReadCount === 2 &&
            detailSecondReadHasHiddenField)
          Object.defineProperty(reply[0]!.result, "hidden", {
            enumerable: false, value: "untrusted",
          });
        return reply;
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
    if (reuseBridgeResponseChunks && url.endsWith("/next") &&
        value.job !== null) {
      reuseBridgeResponseChunks = false;
      const encoded = new TextEncoder().encode(JSON.stringify(value));
      const shared = new Uint8Array(Math.ceil(encoded.length / 2));
      let offset = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          if (offset >= encoded.length) { controller.close(); return; }
          const size = Math.min(shared.length, encoded.length - offset);
          shared.set(encoded.subarray(offset, offset + size));
          controller.enqueue(shared.subarray(0, size));
          offset += size;
          recycledBridgeChunks++;
        },
      }, { highWaterMark: 0 }));
    }
    if (partialJobResponse && url.endsWith("/next") && value.job) {
      const statusCode = partialJobResponse === "partial" ? 206 : 200;
      partialJobResponse = false;
      partialJobDelivered = true;
      return new Response(JSON.stringify(value), { status: statusCode,
        headers: { "Content-Range": "bytes 0-100/300" } });
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
    // Detached capability reads have their own bounded eight-second tab
    // deadline. Concurrent test-file scheduling may delay a reply beyond
    // the ordinary three-second synthetic worker request budget.
    const deadline = realNow() +
      (command.kind === "capabilities.inspect-text" ? 12_000 :
        command.kind === "session.observe" ? 8_000 : 3_000);
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
    let workspaceOriginReads = 0;
    const spoofedWorkspace = new Proxy({ kind: "workspace-ready",
      origin: "http://127.0.0.2:4567", token }, {
      get(target, key, receiver) {
        if (key === "origin") {
          workspaceOriginReads++;
          return origin;
        }
        return Reflect.get(target, key, receiver);
      },
    });
    assert.equal(listener(spoofedWorkspace, {
      url: origin + "/", tab: { id: 99 },
    }, () => { assert.fail("spoofed workspace paired"); }), false);
    assert.equal(workspaceOriginReads, 0);
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
    const scriptsBeforeConfirmation = scripts.length;
    const contract = await expectReply({ kind: "writes.inspect" });
    assert.deepEqual(contract, {
      schemaVersion: 1, id: contract.id, ok: true,
      value: { createSetConfirmation: "reload-and-privacy-v1",
        textCapabilityScope: "stable-my-sets-v1" },
    });
    assert.equal(scripts.length, scriptsBeforeConfirmation);
    assert.equal(foregroundedTabs.length, 0);
    onTabUpdated(7, { title: "Just a moment..." }, {
      id: 7, url: tabUrl, windowId: 3,
    });
    automaticVerificationReads = 2;
    verificationRouteAfter = tabUrl;
    const beforeAutomaticVerification = scripts.length;
    const beforeVerificationReloads = readReloads;
    const automaticallyVerified = await expectReply({
      kind: "session.observe",
    });
    assert.equal(automaticallyVerified.ok, true);
    assert.equal(automaticallyVerified.value, "my-sets",
      "a provider-completed verification must receive a fresh session proof");
    assert.equal(readReloads, beforeVerificationReloads);
    assert.equal(foregroundedTabs.length, 0);
    assert.ok(scripts.slice(beforeAutomaticVerification).every(name =>
      name === "inspectBlooketPage" ||
      name === "inspectBlooketSessionDocumentOrigin" ||
      name === "inspectBlooketDocumentOrigin"));
    automaticVerificationReads = 2;
    verificationRouteAfter = "https://foreign.invalid/after-verification";
    assert.equal((await expectReply({ kind: "session.observe" })).ok, false);
    verificationRouteAfter = null;
    tabUrl = "https://dashboard.blooket.com/my-sets";
    documentOrigin += 1_000;
    assert.equal(foregroundedTabs.length, 0);
    pendingSourceRedirect = true;
    const beforePendingAnnouncement = creates;
    assert.deepEqual(await announce({ origin, token }), {
      ok: false, status: "blooket-attention-required",
    });
    assert.equal(creates, beforePendingAnnouncement,
      "workspace discovery must not replace a live navigating backend");
    assert.equal(stored.connection.tabId, 7);
    pendingSourceRedirect = false;
    assert.equal((await expectReply({ kind: "session.observe" })).value,
      "my-sets");

    for (const field of ["url", "windowId", "pendingUrl"] as const) {
      humanTabGetter = field;
      const beforeGetterFocus = focusedWindows.length;
      const beforeGetterActivation = foregroundedTabs.length;
      assert.equal((await expectReply({ kind: "browser.activate" })).ok,
        false, field);
      assert.equal(humanTabGetterReads, 0);
      assert.equal(foregroundedTabs.length, beforeGetterActivation);
      assert.equal(focusedWindows.length, beforeGetterFocus);
    }
    humanTabGetter = null;
    humanActivationGetter = true;
    assert.equal((await expectReply({ kind: "browser.activate" })).ok,
      false);
    assert.equal(humanTabGetterReads, 0);
    assert.deepEqual(focusedWindows, []);
    foregroundedTabs.length = 0;
    const focused = await expectReply({ kind: "browser.activate" });
    assert.deepEqual(focused, {
      schemaVersion: 1, id: focused.id,
      ok: true, value: { focused: true },
    });
    assert.deepEqual(foregroundedTabs, [7]);
    assert.deepEqual(focusedWindows, [3]);
    // A late route replacement after activating the Blooket tab must not
    // additionally focus a foreign destination as a human challenge.
    switchAfterActivate = true;
    const switchedFocus = await expectReply({ kind: "browser.activate" });
    assert.equal(switchedFocus.ok, false);
    assert.deepEqual(foregroundedTabs, [7, 7]);
    assert.deepEqual(focusedWindows, [3]);
    tabUrl = "https://untrusted.invalid/unrelated";
    const foreignFocus = await expectReply({ kind: "browser.activate" });
    assert.deepEqual(foreignFocus, {
      schemaVersion: 1, id: foreignFocus.id,
      ok: false, code: "blooket-browser-failed",
    });
    assert.deepEqual(foregroundedTabs, [7, 7]);
    assert.deepEqual(focusedWindows, [3]);
    assert.deepEqual(await message({ kind: "open-blooket" }), {
      ok: false, status: "blooket-tab-unavailable",
    });
    assert.deepEqual(foregroundedTabs, [7, 7]);
    // The same local workspace must not adopt a tab navigated elsewhere.
    const disconnectedTab = await announce({ origin, token });
    assert.equal(disconnectedTab.ok, true);
    assert.equal(creates, 2);
    assert.equal(tabUrl, "https://dashboard.blooket.com/my-sets");
    assert.equal(persistentProfile["blooket-owned-tab-id"], 7);
    foregroundedTabs.length = 0;
    focusedWindows.length = 0;
    reuseBridgeResponseChunks = true;
    const fromReusedChunks = await expectReply({ kind: "session.observe" });
    assert.equal(fromReusedChunks.ok, true);
    assert.ok(recycledBridgeChunks >= 2);
    for (const mode of ["partial", "ranged-200"] as const) {
      partialJobResponse = mode;
      partialJobDelivered = false;
      const partialJob = job({ kind: "session.observe" });
      const scriptsBeforePartial = scripts.length;
      jobs.push(partialJob);
      const partialDeadline = realNow() + 2500;
      while (!partialJobDelivered) {
        assert.ok(realNow() < partialDeadline,
          "ranged browser job was not fetched");
        await pause(20);
      }
      await pause(250);
      assert.equal(replies.some(reply => reply.id === partialJob.id), false);
      assert.equal(scripts.length, scriptsBeforePartial,
        "ranged response must never enter native browser scripts");
    }
    // The observed provider navigation canonicalizes My Sets to recent.
    tabUrl = "https://dashboard.blooket.com/my-sets?filter=recent";
    const firstSets = await expectReply({ kind: "sets.list" });
    assert.equal(firstSets.ok, true);
    assert.equal(firstSets.value.completeness, "unknown");
    assert.equal(setListReads, 2);
    assert.equal(readReloads, 1);
    // A teacher starts editing after the early permission-to-leave check.
    // The final guard must refuse a same-route reload without displacing it.
    denyFinalReadGuard = true;
    readGuardChecks = 0;
    const beforeNewEditor = readReloads;
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal(readGuardChecks, 2);
    assert.equal(readReloads, beforeNewEditor);
    denyFinalReadGuard = false;
    for (const frameIssue of ["nested", "accessor"] as const) {
      listModelNestedFrame = frameIssue === "nested";
      listModelFrameAccessor = frameIssue === "accessor";
      assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
      assert.equal(listModelFrameAccessorReads, 0);
    }
    listProxyCompleteness = true;
    setListReads = 0;
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal(listProxyReads, 0);
    listProxyCompleteness = false;
    listPrototypeSerialization = true;
    setListReads = 0;
    const inheritedList = await expectReply({ kind: "sets.list" });
    assert.equal(inheritedList.ok, true);
    assert.equal(inheritedList.value.items[0].title, "Synthetic");
    assert.equal(inheritedSerializerCalls, 0);
    listPrototypeSerialization = false;
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
    // The user can reload the same URL during permission-to-leave. The old
    // document's answer cannot authorize a reload of the replacement.
    reloadDuringLeave = true;
    const reloadBeforeGuard = readReloads;
    const beforeGuardSwitch = scripts.length;
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal(readReloads, reloadBeforeGuard);
    assert.equal(tabUrl, "https://dashboard.blooket.com/my-sets?filter=recent");
    assert.deepEqual(scripts.slice(beforeGuardSwitch), [
      "inspectBlooketDocumentOrigin", "canLeaveBlooketPageForRead",
      "inspectBlooketDocumentOrigin",
    ]);
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
      "inspectBlooketDocumentOrigin", "isBlooketDetailPanelClosed",
      "closeBlooketQuestionPanel",
      "inspectBlooketDocumentOrigin", "inspectBlooketQuestionWriteStage",
      "inspectBlooketSubmittedQuestionOwner", "inspectBlooketPage",
      "inspectBlooketDocumentOrigin", "canLeaveBlooketPageForRead",
      "inspectBlooketDocumentOrigin", "isBlooketDetailPanelClosed",
      "closeBlooketQuestionPanel",
      "inspectBlooketDocumentOrigin", "canLeaveBlooketPageForRead",
      "inspectBlooketDocumentOrigin", "isBlooketDetailPanelClosed",
      "closeBlooketQuestionPanel",
    ]);
    // A new CLI read reclaims its own interrupted inspection panel without
    // foregrounding the browser, submitting a form or acquiring a new tab.
    tabUrl = "https://dashboard.blooket.com/edit?id=set-fixture";
    interruptedReadPanel = true;
    const beforeRecovery = scripts.length;
    const focusBeforeRecovery = foregroundedTabs.length;
    const createsBeforeRecovery = creates;
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, true);
    assert.equal(interruptedReadPanel, false);
    assert.equal(unsafeReadSource, false);
    assert.equal(foregroundedTabs.length, focusBeforeRecovery);
    assert.equal(creates, createsBeforeRecovery);
    assert.ok(!scripts.slice(beforeRecovery).includes(
      "runBlooketAddQuestionPageAction"));
    unsafeReadSource = true;
    // One exact submitted owner may inspect in a separate background tab.
    // The original teacher editor must not be navigated or reloaded.
    tabUrl = "https://dashboard.blooket.com/edit?id=set-fixture";
    submittedReadOwner = true;
    questionSaved = false;
    const beforeDetachedReloads = readReloads;
    detachedBlankGets = 2;
    const detachedQuestions = await expectReply({
      kind: "questions.list", setId: "set-fixture",
    });
    assert.deepEqual(detachedQuestions.value, []);
    assert.equal(detachedQuestions.ok, true);
    assert.equal(detachedCreated, 1);
    assert.equal(detachedClosed, 1);
    assert.equal(readReloads, beforeDetachedReloads);
    assert.equal(tabUrl,
      "https://dashboard.blooket.com/edit?id=set-fixture");
    // The exact source latch remains submitted after a later trusted edit.
    // It no longer owns a stable snapshot or a detachable read capability.
    submittedReadDirty = true;
    const beforeDirtyRead = detachedCreated;
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, beforeDirtyRead);
    const beforeDirtyCapability = capabilityTabsCreated;
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    assert.equal(capabilityTabsCreated, beforeDirtyCapability);
    assert.equal(readReloads, beforeDetachedReloads);
    assert.equal(tabUrl,
      "https://dashboard.blooket.com/edit?id=set-fixture");
    submittedReadDirty = false;
    // Text capability admission is also non-mutating, but must inspect in
    // a temporary tab rather than navigating away from a submitted editor.
    const beforeDetachedCapabilities = readReloads;
    capabilityBlankGets = 2;
    const sourceListing = await expectReply({ kind: "sets.list" });
    assert.equal(sourceListing.ok, true);
    assert.equal(sourceListing.value.items.length, 1);
    assert.equal(capabilityTabsCreated, 1);
    assert.equal(capabilityTabsClosed, 1);
    assert.equal(readReloads, beforeDetachedCapabilities);
    assert.equal(tabUrl,
      "https://dashboard.blooket.com/edit?id=set-fixture");
    const capability = await expectReply({ kind: "capabilities.inspect-text" });
    assert.equal(capability.ok, true);
    assert.equal(capability.value.features.audio, "account-dependent");
    assert.equal(capabilityTabsCreated, 2);
    assert.equal(capabilityTabsClosed, 2);
    assert.equal(readReloads, beforeDetachedCapabilities);
    assert.equal(tabUrl,
      "https://dashboard.blooket.com/edit?id=set-fixture");
    // A committed Edit URL does not authorize a detached read while Chrome
    // has already queued a foreign navigation in that same source tab.
    pendingSourceRedirect = true;
    const beforePendingSourceQuestions = detachedCreated;
    const beforePendingSourceCapabilities = capabilityTabsCreated;
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    assert.equal(detachedCreated, beforePendingSourceQuestions);
    assert.equal(capabilityTabsCreated, beforePendingSourceCapabilities);
    pendingSourceRedirect = false;
    // No extra tab or navigation under changed account identity, a human
    // challenge, or a stale submitted owner bound to another set.
    observedSessionOverride = "security-challenge";
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    observedSessionOverride = null;
    submittedBoundSet = "unrelated-set";
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    submittedBoundSet = "set-fixture";
    submittedReadOwner = false;
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    submittedReadOwner = true;
    assert.equal(capabilityTabsCreated, 2);
    detachedCapabilitySourceReload = true;
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    assert.equal(capabilityTabsCreated, 3);
    assert.equal(capabilityTabsClosed, 3);
    detachedCapabilityChallenge = true;
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    assert.equal(capabilityTabsCreated, 4);
    assert.equal(capabilityTabsClosed, 4);
    observedSessionOverride = null;
    // A changed source document cannot launder two correct My Sets snapshots
    // into a positive read from the old submitted attempt.
    const beforeStaleSetList = capabilityTabsCreated;
    detachedCapabilitySourceReload = true;
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal(capabilityTabsCreated, beforeStaleSetList + 1);
    assert.equal(capabilityTabsClosed, beforeStaleSetList + 1);
    submittedBoundSet = "other-set";
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal(capabilityTabsCreated, beforeStaleSetList + 1);
    submittedBoundSet = "set-fixture";
    // A real security challenge still blocks detached reads, even if a
    // submit latch survives the original page's React transition.
    observedSessionOverride = "security-challenge";
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, 1);
    observedSessionOverride = null;
    // The owner tab can reload during an independent read. Neither its old
    // result nor its new origin may confirm the original attempted write.
    detachedSourceReload = true;
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, 2);
    assert.equal(detachedClosed, 2);
    // An old submit latch from another same-document set is not authority
    // to inspect this route, even if its stage still says submitted.
    submittedBoundSet = "other-set";
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, 2);
    submittedBoundSet = "set-fixture";
    // A teacher edit during the detached read invalidates final ownership.
    detachedSourceOwnerLost = true;
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, 3);
    assert.equal(detachedClosed, 3);
    submittedReadOwner = true;
    // The provider may present a security challenge after a detached scan.
    // Identical source URL, document, and latch are not enough to accept it.
    detachedSourceChallenge = true;
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, 4);
    assert.equal(detachedClosed, 4);
    observedSessionOverride = null;
    // Never delete a temporary tab after its route changes outside the
    // owned read. The tab now belongs to the person controlling Chrome.
    detachedTabNavigatedByUser = true;
    const displacedTemporary = await expectReply({
      kind: "questions.list", setId: "set-fixture",
    });
    assert.equal(displacedTemporary.ok, false);
    assert.equal(detachedCreated, 5);
    assert.equal(detachedClosed, 4);
    assert.equal(detachedUrl,
      "https://untrusted.invalid/owner-navigation");
    const beforeRetainedSlot = detachedCreated;
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, beforeRetainedSlot,
      "a retained auxiliary tab must prevent opening a third browser tab");
    onTabRemoved(83);
    detachedUrl = "";
    // If the teacher takes focus of the temporary tab, do not close it
    // under them, even if its URL and window identity are unchanged.
    detachedTabActivatedByUser = true;
    detachedTabActiveGetter = true;
    const forgedTemporary = await expectReply({
      kind: "questions.list", setId: "set-fixture",
    });
    assert.equal(forgedTemporary.ok, false);
    assert.equal(detachedTabGetterReads, 0);
    assert.equal(detachedCreated, 6);
    assert.equal(detachedClosed, 4,
      "a getter cannot authorize closing an adopted background tab");
    onTabRemoved(83);
    detachedTabActiveGetter = false;
    detachedUrl = "";
    const focusedTemporary = await expectReply({
      kind: "questions.list", setId: "set-fixture",
    });
    assert.equal(focusedTemporary.ok, false);
    assert.equal(detachedCreated, 7);
    assert.equal(detachedClosed, 4);
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    assert.equal(detachedCreated, 7);
    assert.equal(capabilityTabsCreated, beforeStaleSetList + 1,
      "question and capability readers share the same auxiliary reservation");
    onTabRemoved(83);
    detachedUrl = "";
    detachedTabActivatedByUser = false;
    submittedReadOwner = false;
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, 7);
    detachedTabNavigatedByUser = false;
    submittedReadOwner = true;
    // The original submitted owner can begin a foreign navigation during
    // the separate page scan. A correct detached result is not authority to
    // claim that the original attempted form is still the same document.
    pendingSourceAfterRead = true;
    const priorLateQuestionTabs = detachedCreated;
    const lateQuestion = await expectReply({
      kind: "questions.list", setId: "set-fixture",
    });
    assert.equal(lateQuestion.ok, false);
    assert.equal(detachedCreated, priorLateQuestionTabs + 1);
    pendingSourceAfterRead = false;
    pendingSourceRedirect = false;
    pendingSourceAfterRead = true;
    const priorLateCapabilityTabs = capabilityTabsCreated;
    const lateCapability = await expectReply({
      kind: "capabilities.inspect-text",
    });
    assert.equal(lateCapability.ok, false);
    assert.equal(capabilityTabsCreated, priorLateCapabilityTabs + 1);
    pendingSourceAfterRead = false;
    pendingSourceRedirect = false;
    submittedReadOwner = false;
    questionSaved = true;
    unsafeReadSource = false;
    tabUrl = "https://dashboard.blooket.com/my-sets";
    listFailuresRemaining = 2;
    setListReads = 0;
    const delayedSets = await expectReply({ kind: "sets.list" });
    assert.equal(delayedSets.ok, true);
    assert.equal(delayedSets.value.completeness, "unknown");
    assert.equal(setListReads, 4);
    assert.equal(listFailuresRemaining, 0);
    // Pending navigation after the first My Sets script invalidates the
    // apparent stable collection, even when the old URL never changes.
    pendingAfterSetObservation = true;
    setListReads = 0;
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    pendingAfterSetObservation = false;
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
    // Chrome owns additional frame metadata on injection replies. An
    // accessor or concealed result field must not reach the read decoder.
    const scriptBeforeBadWrapper = browser.scripting.executeScript;
    let wrapperGetterCalls = 0;
    for (const mode of ["getter", "hidden", "missing",
      "array-accessor", "array-extra"] as const) {
      browser.scripting.executeScript = async options => {
        if (options.func.name !== "inspectBlooketPage" ||
            options.args?.[0]?.kind !== "sets.list")
          return await scriptBeforeBadWrapper(options);
        if (mode === "array-accessor" || mode === "array-extra") {
          const indexed = [{ result: { ok: true } }];
          if (mode === "array-accessor")
            Object.defineProperty(indexed, "0", {
              enumerable: true, get() {
                wrapperGetterCalls++;
                return { result: { ok: true } };
              },
            });
          else Object.defineProperty(indexed, "hidden", {
            enumerable: false, value: "untrusted",
          });
          return indexed;
        }
        const bad = {};
        if (mode === "getter") Object.defineProperty(bad, "result", {
          enumerable: true,
          get: () => { wrapperGetterCalls++; return { ok: true }; },
        });
        if (mode === "hidden") Object.defineProperty(bad, "result", {
          enumerable: false, value: { ok: true },
        });
        return [bad];
      };
      assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
      assert.equal(tabUrl,
        "https://dashboard.blooket.com/my-sets?filter=recent");
    }
    browser.scripting.executeScript = scriptBeforeBadWrapper;
    assert.equal(wrapperGetterCalls, 0);
    for (const kind of ["first-invalid-row", "second-hidden-envelope",
      "second-accessor-envelope", "second-nonenumerable-value",
      "second-hidden-row"]) {
      setListReads = 0;
      listFirstInvalidRow = kind === "first-invalid-row";
      listSecondHiddenEnvelope = kind === "second-hidden-envelope";
      listSecondAccessorEnvelope = kind === "second-accessor-envelope";
      listSecondNonEnumerableField = kind === "second-nonenumerable-value";
      listSecondHiddenRow = kind === "second-hidden-row";
      const rejected = await expectReply({ kind: "sets.list" });
      assert.equal(rejected.ok, false, kind);
      assert.equal(setListReads,
        kind === "first-invalid-row" ? 1 : 2, kind);
    }
    listFirstInvalidRow = false;
    listSecondHiddenEnvelope = false;
    listSecondAccessorEnvelope = false;
    listSecondNonEnumerableField = false;
    listSecondHiddenRow = false;
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
    detailPanelFailuresRemaining = 20;
    const beforeSlowPanel = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, true, "a slow metadata action must use its remaining read budget");
    assert.equal(detailPanelFailuresRemaining, 0);
    assert.equal(scripts.slice(beforeSlowPanel).filter(name =>
      name === "openBlooketDetailPanel").length, 1);
    assert.equal(scripts.slice(beforeSlowPanel).includes(
      "closeBlooketDetailPanel"), true);
    // An Edit Info read that never mounts the panel can reclaim only an
    // unchanged, exact owner. A mismatched or dirty owner cannot reload.
    detailPanelFailuresRemaining = 500;
    expireDetailRead = true;
    detailPendingRecoverySafe = true;
    detailPendingRecoveryChecks = 0;
    const beforeRecoveryReload = readReloads;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    Date.now = realNow;
    assert.equal(detailPendingRecoveryChecks, 2);
    // The normal fresh-document navigation reload still occurs once.
    // The second reload is the independently guarded orphan cleanup.
    assert.equal(readReloads, beforeRecoveryReload + 2);
    detailPanelFailuresRemaining = 500;
    expireDetailRead = true;
    detailPendingRecoverySafe = false;
    const beforeDeniedReload = readReloads;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    Date.now = realNow;
    assert.equal(detailPendingRecoveryChecks, 3);
    // Denied cleanup does not add a second reload to the initial read.
    assert.equal(readReloads, beforeDeniedReload + 1);
    detailPanelFailuresRemaining = 500;
    expireDetailRead = true;
    detailPendingRecoverySafe = true;
    detailPendingRecoveryChecks = 0;
    detailPanelMountsAfterFirstProbe = true;
    const beforeHydratedPanel = readReloads;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    Date.now = realNow;
    // A pending panel that mounts on the next browser task is never
    // discarded after only an immediately repeated DOM observation.
    assert.equal(detailPendingRecoveryChecks, 2);
    assert.equal(readReloads, beforeHydratedPanel + 1);
    detailPanelFailuresRemaining = 0;
    detailPendingRecoveryChecks = 0;
    detailSidebarProxy = true;
    const beforeProxyPanel = scripts.length;
    assert.equal((await expectReply({ kind: "sets.get",
      setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(detailSidebarProxyReads, 0);
    assert.equal(scripts.slice(beforeProxyPanel).includes(
      "openBlooketDetailPanel"), false);
    detailSidebarProxy = false;
    detailPanelProxy = true;
    const falsePanel = await expectReply({ kind: "sets.get",
      setId: "opaque id/with spaces",
    });
    assert.equal(falsePanel.ok, false);
    assert.equal(detailPanelProxyReads, 0);
    detailPanelProxy = false;
    // A pending redirect after a saved sidebar observation is not proof
    // of the old exact Edit route, and cannot authorize the next click.
    pendingAfterDetailSidebar = true;
    detailSidebarReadCount = 0;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    pendingAfterDetailSidebar = false;
    detailSidebarReadCount = 0;
    detailSidebarFailuresRemaining = 1;
    const beforeHydration = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, true, "fresh sidebar must hydrate before its first saved read");
    assert.equal(detailSidebarFailuresRemaining, 0);
    assert.equal(scripts.slice(beforeHydration).filter(name =>
      name === "openBlooketDetailPanel").length, 1);
    assert.equal(scripts.slice(beforeHydration).includes(
      "closeBlooketDetailPanel"), true);

    detailSidebarReadCount = 0;
    detailSidebarFailuresRemaining = 20;
    const beforeMissingSidebar = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.ok(detailSidebarReadCount > 0 && detailSidebarReadCount <= 15);
    assert.equal(scripts.slice(beforeMissingSidebar).includes(
      "openBlooketDetailPanel"), false);
    detailSidebarFailuresRemaining = 0;

    detailSidebarReadCount = 0;
    detailSidebarFailureAtRead = 2;
    const beforeLostConfirmation = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(detailSidebarReadCount, 2);
    assert.equal(scripts.slice(beforeLostConfirmation).includes(
      "openBlooketDetailPanel"), false);
    detailSidebarFailureAtRead = 0;
    // Saved set metadata can change while a read-owned panel is canceled.
    // Such a result must not leave the browser as a confirmed remote read.
    detailCancelObserved = false;
    detailSidebarAfterCancelDrifts = true;
    const beforeCancelDrift = scripts.length;
    const changedAfterCancel = await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    });
    assert.equal(changedAfterCancel.ok, false);
    assert.equal(scripts.slice(beforeCancelDrift).includes(
      "closeBlooketDetailPanel"), true);
    assert.equal(scripts.slice(beforeCancelDrift).filter(name =>
      name === "inspectBlooketDetailSidebar").length, 4);
    detailSidebarAfterCancelDrifts = false;
    detailSecondAfterCancelDrifts = true;
    detailCancelObserved = false;
    detailSidebarReadCount = 0;
    const beforeSecondDrift = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(scripts.slice(beforeSecondDrift).filter(name =>
      name === "inspectBlooketDetailSidebar").length, 4);
    assert.equal(scripts.slice(beforeSecondDrift).includes(
      "closeBlooketDetailPanel"), true);
    detailSecondAfterCancelDrifts = false;
    detailSecondReadHasHiddenField = true;
    detailReadCount = 0;
    const beforeHiddenDetail = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(scripts.slice(beforeHiddenDetail).filter(name =>
      name === "inspectBlooketPage").length, 2);
    assert.equal(scripts.slice(beforeHiddenDetail).includes(
      "closeBlooketDetailPanel"), true);
    detailSecondReadHasHiddenField = false;
    detailReadWrongId = true;
    detailReadCount = 0;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    detailReadWrongId = false;
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
    detailReloadDuringSidebar = true;
    const beforeSidebarReload = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(scripts.slice(beforeSidebarReload).includes(
      "openBlooketDetailPanel"), false);
    detailReloadAfterOpen = true;
    const beforeOpenReload = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(scripts.slice(beforeOpenReload).includes(
      "closeBlooketDetailPanel"), false);
    detailReloadDuringInspection = true;
    const beforeInspectReload = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(scripts.slice(beforeInspectReload).includes(
      "closeBlooketDetailPanel"), false);
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
    ), true);
    assert.equal(scripts.slice(beforeCancelFailure).includes(
      "releaseClosedBlooketDetailReadWatch",
    ), true);
    // Cancel may have completed even if its scripting reply was lost.
    // Recovery needs the native closed proof and exact idle-watch release;
    // neither a failed click alone nor a closure assertion is sufficient.
    detailCancelReplyLost = true;
    detailReadWatchCanRelease = true;
    detailReleaseReplacesDocument = true;
    const beforeReplacedDocument = scripts.length;
    assert.equal((await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    })).ok, false);
    assert.equal(scripts.slice(beforeReplacedDocument).filter(name =>
      name === "releaseClosedBlooketDetailReadWatch").length, 1);
    // A new native document cannot reuse an earlier closure proof.
    const beforeLostReply = scripts.length;
    const recoveredCancel = await expectReply({
      kind: "sets.get", setId: "opaque id/with spaces",
    });
    assert.equal(recoveredCancel.ok, true);
    assert.equal(scripts.slice(beforeLostReply).filter(name =>
      name === "closeBlooketDetailPanel").length, 1);
    assert.equal(scripts.slice(beforeLostReply).filter(name =>
      name === "releaseClosedBlooketDetailReadWatch").length, 1);
    detailCancelReplyLost = false;
    detailReadWatchCanRelease = false;
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
    assert.deepEqual(scripts.slice(beforeSwitchedOpen).filter(
      name => name !== "inspectBlooketDocumentOrigin",
    ), [
      "canLeaveBlooketPageForRead",
      "canLeaveBlooketPageForRead",
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
    ), true);
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

    // Native Edit Info reads and writes share the same provider action
    // cooldown. Failed admission must stop before opening any write form.
    const beforeDeniedCreate = scripts.length;
    providerClockUnavailable = true;
    const deniedCreate = await expectReply({
      kind: "sets.create", title: "Synthetic created set",
      description: "Created through bridge fixture", private: true,
    });
    providerClockUnavailable = false;
    assert.equal(deniedCreate.ok, false);
    assert.equal(scripts.length, beforeDeniedCreate);
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
    createdSetVisibility = "public";
    tabUrl = "https://dashboard.blooket.com/my-sets";
    const wrongPrivacy = await expectReply({
      kind: "sets.create", title: "Synthetic created set",
      description: "Created through bridge fixture", private: true,
    });
    assert.equal(wrongPrivacy.value.ok, false);
    assert.equal(scripts.filter(name =>
      name === "closeBlooketDetailPanel").length >= 1, true);
    createdSetVisibility = "private";
    createSidebarMismatch = true;
    tabUrl = "https://dashboard.blooket.com/my-sets";
    const unrelated = await expectReply({
      kind: "sets.create", title: "Synthetic created set",
      description: "Created through bridge fixture", private: true,
    });
    assert.equal(unrelated.value.ok, false);
    assert.equal(scripts.filter(name =>
      name === "submitBlooketCreateSetForm").length, 4);
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
    assert.ok(scripts.includes("prepareBlooketQuestionControls"));
    assert.ok(scripts.includes("inspectBlooketPreparedQuestionEcho"));
    assert.ok(scripts.includes("inspectOpenedBlooketQuestion"));

    // A slow, but still leased, browser write must be able to finish its
    // guarded fresh-document observation after the old 27-second ceiling.
    tabUrl = "https://dashboard.blooket.com/edit?id=set-fixture";
    questionSaved = false;
    slowWriteAtOpen = true;
    const slow = await expectReply({
      kind: "questions.create", setId: "set-fixture", number: 1,
      question: "Type sun.",
      answers: [{ text: "sun", correct: true }],
      qType: "typing", random: true,
      answerTypes: ["exactly"], timeLimit: 15,
    });
    Date.now = realNow;
    assert.deepEqual(slow.value, { ok: true });
    assert.equal(questionSaved, true);

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

    const beforeText = scripts.length;
    const beforeTextTabs = capabilityTabsCreated;
    const beforeTextReloads = readReloads;
    const beforeTextUrl = tabUrl;
    capabilityPendingGets = 2;
    const textCapability = await expectReply({
      kind: "capabilities.inspect-text",
    });
    assert.equal(textCapability.ok, true);
    assert.equal(textCapability.value.schemaVersion, 3);
    assert.equal(textCapability.value.features.audio, "account-dependent");
    assert.equal(capabilityTabsCreated, beforeTextTabs + 1,
      "scoped capability checks must not navigate the saved quiz editor");
    assert.equal(readReloads, beforeTextReloads);
    assert.equal(tabUrl, beforeTextUrl);
    assert.deepEqual(scripts.slice(beforeText).filter(name =>
      name === "openBlooketCapabilityQuestionPanel" ||
      name === "openBlooketAudioCapabilityDrawer"), []);

    capabilityNeverCommits = true;
    const beforePendingCleanup = capabilityTabsClosed;
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    assert.equal(capabilityTabsClosed, beforePendingCleanup + 1,
      "a still-pending owned tab must be cleaned up after its load deadline");
    capabilityNeverCommits = false;
    capabilityPendingRedirect = true;
    const beforeAdoptedCleanup = capabilityTabsClosed;
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    assert.equal(capabilityTabsClosed, beforeAdoptedCleanup,
      "a teacher's pending navigation must preserve the old matching tab");
    const beforeRetainedCapability = capabilityTabsCreated;
    assert.equal((await expectReply({
      kind: "capabilities.inspect-text",
    })).ok, false);
    assert.equal(capabilityTabsCreated, beforeRetainedCapability);
    onTabRemoved(84);
    detachedCapabilityUrl = "";
    capabilityPendingRedirect = false;

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
    // The session script may run before Chrome exposes an in-flight foreign
    // navigation. Its earlier observed value must not certify authentication.
    pendingDuringSessionScript = true;
    assert.equal((await expectReply({ kind: "session.observe" })).ok, false);
    pendingSourceRedirect = false;
    sessionPrototypeSerialization = true;
    assert.equal((await expectReply({ kind: "session.observe" })).ok, true);
    assert.equal(inheritedSerializerCalls, 0);
    sessionPrototypeSerialization = false;
    sessionProxyState = true;
    const proxiedSession = await expectReply({ kind: "session.observe" });
    assert.equal(proxiedSession.ok, true);
    assert.equal(proxiedSession.value, "signed-out");
    assert.equal(sessionProxyReads, 0);
    sessionProxyState = false;
    sessionSecondHasHiddenField = true;
    sessionReadProbeCount = 0;
    assert.equal((await expectReply({ kind: "session.observe" })).ok, false);
    assert.equal(sessionReadProbeCount, 2);
    sessionSecondHasHiddenField = false;
    observedSessionOverride = "untrusted-navigation-state";
    assert.equal((await expectReply({ kind: "session.observe" })).ok, false);
    observedSessionOverride = null;
    assert.equal(typeof onTabUpdated, "function");
    onTabUpdated(999, { title: "Just a moment..." }, {
      id: 999, url: "https://dashboard.blooket.com/my-sets",
    });
    onTabUpdated(7, { title: "Ordinary Blooket page" }, {
      id: 7, url: tabUrl,
    });
    assert.equal(foregroundedTabs.length, 0);
    let challengeTitleGetterReads = 0;
    const fakeChallenge = Object.defineProperty({}, "title", {
      enumerable: true, get() {
        challengeTitleGetterReads++;
        return "Just a moment...";
      },
    });
    onTabUpdated(7, fakeChallenge, { id: 7, url: tabUrl, windowId: 3 });
    await pause(20);
    assert.equal(challengeTitleGetterReads, 0);
    assert.deepEqual(foregroundedTabs, []);
    currentChallengeTitle = "Just a moment...";
    onTabUpdated(7, { title: "Just a moment..." }, {
      id: 7, url: tabUrl, windowId: 3,
    });
    onTabUpdated(7, { title: "Just a moment..." }, {
      id: 7, url: tabUrl, windowId: 3,
    });
    // Concurrent provider suites can delay Node's event loop before the
    // owned focus request resolves. Keep the actual foreground proof; allow
    // scheduling headroom without ever focusing a foreign tab.
    const eventDeadline = realNow() + 18_000;
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
    pendingSourceRedirect = true;
    const beforePendingFocus = foregroundedTabs.length;
    assert.equal((await message({ kind: "open-blooket" })).ok, false);
    assert.equal(foregroundedTabs.length, beforePendingFocus);
    pendingSourceRedirect = false;
    assert.equal((await message({ kind: "open-blooket" })).ok, true);
    assert.deepEqual(foregroundedTabs, [7, 7]);
    assert.deepEqual(focusedWindows, [3, 3]);
    pendingAfterActivate = true;
    const priorFocus = focusedWindows.length;
    assert.equal((await message({ kind: "open-blooket" })).ok, false);
    assert.equal(focusedWindows.length, priorFocus);
    pendingSourceRedirect = false;
    observedSessionOverride = null;
    assert.equal((await expectReply({ kind: "session.observe" })).ok, true);
    assert.equal((await message({ kind: "status" })).status, "connected");
    reloadSessionAtSameRoute = true;
    const afterSameRouteReload = await expectReply({
      kind: "session.observe",
    });
    assert.equal(afterSameRouteReload.ok, false);
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

    // A retiring browser connection must stop the read while still removing
    // its own temporary tab. Never grant a retired owner further scripts.
    tabUrl = "https://dashboard.blooket.com/edit?id=set-fixture";
    unsafeReadSource = true;
    submittedReadOwner = true;
    submittedBoundSet = "set-fixture";
    holdDetachedRead = true;
    const temporaryBefore = detachedCreated;
    const closedBefore = detachedClosed;
    const retiredDetachedJob = job({
      kind: "questions.list", setId: "set-fixture",
    });
    jobs.push(retiredDetachedJob);
    await waitForMilestone(detachedReadStarted, "detached-read");
    const fourthToken = "d".repeat(43);
    token = fourthToken;
    assert.equal((await announce({ origin, token: fourthToken })).ok,
      true);
    releaseDetachedRead();
    await pause(200);
    assert.equal(detachedCreated, temporaryBefore + 1);
    assert.equal(detachedClosed, closedBefore + 1,
      "retired detached read leaked a temporary Chrome tab");
    assert.equal(replies.some((reply) =>
      reply.id === retiredDetachedJob.id), false);
    // An in-flight tabs.create can finish after the old connection retires.
    // Its exact newly opened ID must still be removed, without a read reply.
    tabUrl = "https://dashboard.blooket.com/edit?id=set-fixture";
    holdDetachedCreate = true;
    const openingBefore = detachedCreated;
    const openingClosedBefore = detachedClosed;
    const retiredCreateJob = job({
      kind: "questions.list", setId: "set-fixture",
    });
    jobs.push(retiredCreateJob);
    await waitForMilestone(detachedCreateStarted, "detached-create");
    const fifthToken = "e".repeat(43);
    token = fifthToken;
    assert.equal((await announce({ origin, token: fifthToken })).ok,
      true);
    releaseDetachedCreate();
    await pause(200);
    assert.equal(detachedCreated, openingBefore + 1);
    assert.equal(detachedClosed, openingClosedBefore + 1);
    assert.equal(replies.some((reply) =>
      reply.id === retiredCreateJob.id), false);
    unsafeReadSource = false;
    submittedReadOwner = false;

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

    unsafeReadSource = true;
    submittedReadOwner = true;
    loseDetachedCreateAck = true;
    const beforeLostCreate = detachedCreated;
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, beforeLostCreate + 1);
    assert.equal((await expectReply({
      kind: "questions.list", setId: "set-fixture",
    })).ok, false);
    assert.equal(detachedCreated, beforeLostCreate + 1,
      "a lost tab-create reply cannot authorize another allocation");

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
    if (priorPerformanceNow)
      Object.defineProperty(performance, "now", priorPerformanceNow);
    else Reflect.deleteProperty(performance, "now");
    Date.now = realNow;
    releaseReadScript();
    releaseDetachedCreate();
    releaseDetachedRead();
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
  let inspectedTab = { id: 7, url: "https://untrusted.invalid" };
  let tabGetterReads = 0;
  const spoofedTab = new Proxy({ id: 7, url: "https://untrusted.invalid" }, {
    get(target, key, receiver) {
      if (key === "url") {
        tabGetterReads++;
        return "https://dashboard.blooket.com/my-sets";
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const mocked = {
    runtime: {
      getURL: path => root + path,
      onMessage: { addListener: callback => { listener = callback; } },
    },
    tabs: {
      onUpdated: { addListener: () => {} },
      query: async () => [],
      get: async () => inspectedTab,
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
    for (const [index, tab] of [
      { id: 7, url: "https://untrusted.invalid" },
      { id: 7, url: "https://dashboard.blooket.com/my-sets",
        pendingUrl: "https://untrusted.invalid/teacher-navigation" },
      spoofedTab,
    ].entries()) {
      inspectedTab = tab;
      await import(
        "../../../../src/service/browser-extension/adapter-inbound/worker.ts" +
        "?stale-stored-tab-recovery-" + index
      );
      const result = await new Promise(resolve => {
        assert.equal(listener({ kind: "status" }, {
          url: root + "src/ui/browser-extension/adapter-inbound/popup.html",
        }, resolve), true);
      });
      assert.deepEqual(result, { ok: true, status: "waiting-for-workspace" });
      assert.equal(removed, index + 1);
      assert.equal(created, 0);
    }
    assert.equal(tabGetterReads, 0);
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
  let connectionGetterReads = 0;
  const saved = new Proxy({ origin, token: "a".repeat(43), tabId: 7 }, {
    get(target, key, receiver) {
      if (key === "origin") {
        connectionGetterReads++;
        return "http://127.0.0.2:4567";
      }
      return Reflect.get(target, key, receiver);
    },
  });
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
          get: async () => ({ connection: saved }),
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
    assert.equal(connectionGetterReads, 0,
      "restored connection must not consult property-read traps");
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

test("extension reload preserves an editor without creating replacement tabs",
  async () => {
  const priorChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const priorFetch = globalThis.fetch;
  const origin = "http://127.0.0.1:4567";
  const ext = "chrome-extension://recycled-tab-fixture/";
  let listener;
  let pendingReload = false;
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
            : "https://dashboard.blooket.com/my-sets",
          ...(pendingReload ? {
            pendingUrl: "https://dashboard.blooket.com/edit?id=teacher-draft",
            status: "loading",
          } : {}) }),
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
    assert.deepEqual(reply, { ok: false,
      status: "blooket-tab-retained" });
    assert.deepEqual(created, []);
    assert.equal(stored["blooket-owned-tab-id"], 7);
    pendingReload = true;
    const again = await new Promise(resolve => {
      listener({ kind: "workspace-ready", origin,
        token: "a".repeat(43) }, {
        url: origin + "/", tab: { id: 99 },
      }, resolve);
    });
    assert.deepEqual(again, reply);
    assert.deepEqual(created, []);
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
      const [title, url, expectedBlocked] = scenario;
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
      assert.deepEqual(result, expectedBlocked === 0
        ? { ok: true, status: "connected" }
        : { ok: false, status: "blooket-tab-retained" });
      assert.equal(created, 0, url.split("?")[0]);
      if (expectedBlocked === 0)
        assert.equal((session.connection as { tabId: number }).tabId, 7);
      else assert.equal("connection" in session, false);
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

test("reloaded extension reclaims only an idle recorded Edit Set tab",
  async () => {
    const previousChrome = Object.getOwnPropertyDescriptor(globalThis,
      "chrome");
    const previousFetch = globalThis.fetch;
    const origin = "http://127.0.0.1:4567";
    const url = "https://dashboard.blooket.com/edit?id=" + "a".repeat(24);
    try {
      for (const idle of [true, false]) {
        let listener: ((message: unknown, sender: unknown,
          reply: (value: unknown) => void) => boolean) | undefined;
        let created = 0;
        const session: Record<string, unknown> = {};
        const local: Record<string, unknown> = { "blooket-owned-tab-id": 7 };
        Object.defineProperty(globalThis, "chrome", {
          configurable: true,
          value: {
            runtime: { getURL: (path: string) =>
              "chrome-extension://idle-reclaim-test/" + path,
              onMessage: { addListener: (fn: typeof listener) => {
                listener = fn;
              } } },
            tabs: {
              onUpdated: { addListener: () => {} },
              query: async () => [],
              get: async (id: number) => ({ id, url, title: "Edit Set",
                status: "complete" }),
              create: async () => { created++; throw Error("no second tab"); },
            },
            scripting: { executeScript: async ({func}: {func: Function}) => {
              assert.equal(func.name, "canLeaveBlooketPageForRead");
              return [{ frameId: 0, result: idle }];
            } },
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
        globalThis.fetch = async (requested: string) =>
          requested.endsWith("/api/browser-bridge/status")
            ? Response.json({ ok: true, pending: 0, connected: false })
            : new Response(null, { status: 426 });
        const modulePath =
          "../../../../src/service/browser-extension/adapter-inbound/" +
          "worker.ts?idle-editor-reclaim-" + idle;
        await import(modulePath);
        const reply = await new Promise(resolve => {
          assert.equal(listener!({ kind: "workspace-ready", origin,
            token: "a".repeat(43) }, { url: origin + "/",
              tab: { id: 99 } }, resolve), true);
        });
        assert.deepEqual(reply, idle
          ? { ok: true, status: "connected" }
          : { ok: false, status: "blooket-tab-retained" });
        assert.equal(created, 0);
        assert.equal(idle && "connection" in session, idle);
      }
    } finally {
      if (previousChrome)
        Object.defineProperty(globalThis, "chrome", previousChrome);
      else Reflect.deleteProperty(globalThis, "chrome");
      globalThis.fetch = previousFetch;
    }
  });
