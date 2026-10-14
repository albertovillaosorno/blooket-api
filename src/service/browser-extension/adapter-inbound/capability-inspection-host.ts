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
//   - Chrome orchestration for one non-mutating Blooket capability inspection.
// - Must-Not:
//   - Submit forms, create sets, upload media, retain IDs, or expose account
//     data.
// - Allows:
//   - Inputs: One dedicated authenticated Blooket tab and Chrome subset.
//   - Outputs: One untrusted capability snapshot candidate or stable failure.
//   - Side effects: Navigate, open/cancel capability UI, then restore prior
//     URL.
// - Split-When:
//   - Safari capability inspection requires materially different mechanics.
// - Merge-When:
//   - Browser capability inspection no longer crosses extension orchestration.
// - Summary:
//   - Resolves the shared Plus media gate only when an existing set exists.
// - Description:
//   - Empty accounts stay account-dependent and never create probe content.
// - Usage:
//   - Invoke only for the admitted capabilities.inspect bridge command.
// - Defaults:
//   - Cleanup, navigation, or malformed page evidence fails closed.
//
import {
  blooketCapabilitySnapshotCandidate,
  canLeaveBlooketPageForRead,
  closeBlooketAudioCapabilityDrawer,
  closeBlooketCapabilityQuestionPanel,
  inspectBlooketAudioCapabilityDrawer,
  isBlooketAudioCapabilityDrawerClosed,
  isBlooketCapabilityQuestionPanelClosed,
  isBlooketCapabilityQuestionPanelReady,
  openBlooketAudioCapabilityDrawer,
  openBlooketCapabilityQuestionPanel,
  type BlooketAccountMediaAvailability,
} from
  "../../../platforms/blooket-browser/adapter-outbound/capability-page.ts";
import { inspectBlooketPage } from
  "../../../platforms/blooket-browser/adapter-outbound/page.ts";
import { inspectBlooketDocumentOrigin } from
  "../../../platforms/blooket-browser/adapter-outbound/document-page.ts";
import { exactOwnData, snapshotExactDenseArray } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";

import { decodeBlooketSetList } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";

interface BrowserTab {
  readonly url?: string;
  readonly status?: string;
}

export interface CapabilityInspectionChromePort {
  readonly tabs: {
    get(tabId: number): Promise<BrowserTab>;
    update(
      tabId: number,
      options: { readonly url: string },
    ): Promise<BrowserTab>;
  };
  readonly scripting: {
    executeScript(options: {
      readonly target: { readonly tabId: number };
      readonly func: (...args: never[]) => unknown;
      readonly args?: unknown[];
    }): Promise<readonly { readonly result?: unknown }[]>;
  };
}

export type ExtensionCapabilityInspectionResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly code:
        | "blooket-browser-unavailable"
        | "blooket-browser-failed";
    };

function exactCapabilityFields<const K extends string>(
  value: unknown,
  expected: readonly K[],
): value is Record<K, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const own = Reflect.ownKeys(value);
  return own.length === expected.length && expected.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable &&
      "value" in descriptor;
  }) && own.every(key => typeof key === "string" &&
    expected.some(field => field === key));
}

const DASHBOARD_ORIGIN = "https://dashboard.blooket.com";
const MY_SETS_URL = DASHBOARD_ORIGIN + "/my-sets";
const MAX_POLLS = 50;
const POLL_MS = 100;
// Reserve three seconds for modal cleanup and navigation restoration.
const PROBE_BUDGET_MS = 6_000;
const TOTAL_BUDGET_MS = 9_000;

export function createExtensionCapabilityInspectionHost(
  chrome: CapabilityInspectionChromePort,
  tabId: number,
  pause: (ms: number) => Promise<void> = async (ms) =>
    await new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = Date.now,
) {
  const script = async (
    func: (...args: never[]) => unknown,
    args: unknown[] = [],
  ): Promise<unknown> => {
    const replies = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
    });
    const frames = snapshotExactDenseArray(replies, 1);
    const frame = frames?.length === 1 ? frames[0] : undefined;
    if (!frame || typeof frame !== "object")
      throw new Error("browser-capability-script-failed");
    // InjectionResult also contains Chrome-owned frame metadata. Trust only
    // its directly owned result data field, never an accessor getter.
    // Chrome script results belong to the main document (frameId zero).
    // A nested frame or accessor-owned frame identity cannot authorize a
    // saved-state read or a write step even when its result looks plausible.
    const frameId = Object.getOwnPropertyDescriptor(frame, "frameId");
    if (frameId && (!frameId.enumerable ||
        !Object.hasOwn(frameId, "value") || frameId.value !== 0))
      throw new Error("browser-capability-script-failed");
    const descriptor = Object.getOwnPropertyDescriptor(frame, "result");
    if (!descriptor || !descriptor.enumerable ||
        !("value" in descriptor) || descriptor.value === undefined)
      throw new Error("browser-capability-script-failed");
    return descriptor.value;
  };

  return {
    inspect: async (): Promise<ExtensionCapabilityInspectionResult> => {
      const startedAt = now();
      const probeDeadline = startedAt + PROBE_BUDGET_MS;
      const finishDeadline = startedAt + TOTAL_BUDGET_MS;
      let expectedReadUrl = MY_SETS_URL;
      const origins = new Map<string, number>();
      const ownsDocument = async (
        url: string, deadline: number, first = false,
      ): Promise<boolean> => {
        if (now() >= deadline) return false;
        const before = await chrome.tabs.get(tabId);
        if (before.status !== "complete" || before.url !== url ||
            now() >= deadline) return false;
        const observed = await script(
          inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
          [url],
        );
        const after = await chrome.tabs.get(tabId);
        if (after.status !== "complete" || after.url !== url ||
            now() >= deadline || typeof observed !== "number" ||
            !Number.isFinite(observed) || observed <= 0) return false;
        const prior = origins.get(url);
        if (prior === undefined) {
          if (!first) return false;
          origins.set(url, observed);
          return true;
        }
        return observed === prior;
      };
      const readScript = async (
        func: (...args: never[]) => unknown,
        args: unknown[] = [],
      ): Promise<unknown> => {
        if (now() >= probeDeadline)
          throw new Error("browser-capability-deadline");
        const beforeScript = await chrome.tabs.get(tabId);
        if (
          now() >= probeDeadline || beforeScript.status !== "complete" ||
          beforeScript.url !== expectedReadUrl
        ) throw new Error("browser-capability-tab-changed");
        if (!await ownsDocument(expectedReadUrl, probeDeadline, true))
          throw new Error("browser-capability-document-changed");
        const result = await script(func, args);
        if (now() >= probeDeadline ||
            !await ownsDocument(expectedReadUrl, probeDeadline))
          throw new Error("browser-capability-document-changed");
        const afterScript = await chrome.tabs.get(tabId);
        if (
          now() >= probeDeadline || afterScript.status !== "complete" ||
          afterScript.url !== expectedReadUrl
        ) throw new Error("browser-capability-tab-changed");
        return result;
      };
      const nativeDocument = async (url: string): Promise<unknown> =>
        await script(
          inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
          [url],
        );
      const editorReady = async (url: string): Promise<boolean> => {
        if (now() >= probeDeadline) return false;
        const tab = await chrome.tabs.get(tabId);
        return now() < probeDeadline && tab.status === "complete" &&
          tab.url === url && await ownsDocument(url, probeDeadline);
      };
      let originalUrl: string | undefined;
      let setId: string | undefined;
      let panelOpened = false;
      let drawerOpened = false;
      // A browser-script failure can occur after the page was clicked but
      // before Chrome delivered its acknowledgement. Without that receipt,
      // never navigate away or click through an unconfirmed overlay.
      let questionOpenUnconfirmed = false;
      let audioOpenUnconfirmed = false;
      let outcome: ExtensionCapabilityInspectionResult = browserFailure();
      try {
        const before = await chrome.tabs.get(tabId);
        if (!before.url || !dashboardTab(before)) return browserFailure();
        originalUrl = before.url;
        const sourceUrl = before.url;
        // Before navigating to My Sets, reject a teacher-owned editor or
        // modal on the current tab. The guard runs in the page itself.
        if (before.status !== "complete" ||
            !await ownsDocument(originalUrl, probeDeadline, true))
          return browserFailure();
        const safe = await script(
          canLeaveBlooketPageForRead as
            (...args: never[]) => unknown,
        );
        const checked = await chrome.tabs.get(tabId);
        if (safe !== true || checked.status !== "complete" ||
            checked.url !== originalUrl ||
            !await ownsDocument(originalUrl, probeDeadline))
          return browserFailure();

        if (!await navigate(
          chrome, tabId, MY_SETS_URL, originalUrl, pause,
          probeDeadline, now,
          async () => await ownsDocument(sourceUrl, probeDeadline),
          nativeDocument,
        ))
          return browserFailure();
        const observed = await readScript(
          inspectBlooketPage as (...args: never[]) => unknown,
          [{ kind: "session.observe" }],
        );
        if (!exactObservedState(observed, "my-sets")) return browserFailure();
        const listed = await readScript(
          inspectBlooketPage as (...args: never[]) => unknown,
          [{ kind: "sets.list" }],
        );
        const selected = firstSetId(listed);
        if (selected === undefined) return browserFailure();
        // Compare two My Sets views before selecting a probe set or
        // accepting the recovered empty-account state.
        await pause(Math.min(POLL_MS, probeDeadline - now()));
        if (now() >= probeDeadline) return browserFailure();
        const beforeListConfirmation = await chrome.tabs.get(tabId);
        if (
          now() >= probeDeadline ||
          beforeListConfirmation.status !== "complete" ||
          beforeListConfirmation.url !== MY_SETS_URL
        ) return browserFailure();
        const listedAgain = await readScript(
          inspectBlooketPage as (...args: never[]) => unknown,
          [{ kind: "sets.list" }],
        );
        // Both snapshots are descriptor-validated before comparing their
        // own numeric slots. Never run browser-owned toJSON or iterators.
        const confirmedSelection = firstSetId(listedAgain);
        if (confirmedSelection === undefined ||
            confirmedSelection !== selected ||
            !sameAdmittedSetLists(listed, listedAgain))
          return browserFailure();
        const afterListConfirmation = await chrome.tabs.get(tabId);
        if (
          now() >= probeDeadline ||
          afterListConfirmation.status !== "complete" ||
          afterListConfirmation.url !== MY_SETS_URL
        ) return browserFailure();

        let accountMedia: BlooketAccountMediaAvailability = "account-dependent";
        if (selected !== null) {
          setId = selected;
          const editUrl = DASHBOARD_ORIGIN + "/edit?id=" +
            encodeURIComponent(setId);
          if (!await navigate(
            chrome, tabId, editUrl, MY_SETS_URL, pause,
            probeDeadline, now,
            async () => await ownsDocument(MY_SETS_URL, probeDeadline),
            nativeDocument,
          ))
            return browserFailure();
          // The selected edit route may equal the original teacher tab URL.
          // Our explicit My Sets-to-Edit navigation must create a new native
          // document; retire the old identity only after confirming that.
          const priorEditOrigin = origins.get(editUrl);
          const entered = await chrome.tabs.get(tabId);
          if (entered.status !== "complete" || entered.url !== editUrl ||
              now() >= probeDeadline) return browserFailure();
          const enteredOrigin = await script(
            inspectBlooketDocumentOrigin as (...args: never[]) => unknown,
            [editUrl],
          );
          const afterEnter = await chrome.tabs.get(tabId);
          if (afterEnter.status !== "complete" || afterEnter.url !== editUrl ||
              now() >= probeDeadline ||
              typeof enteredOrigin !== "number" ||
              !Number.isFinite(enteredOrigin) || enteredOrigin <= 0 ||
              enteredOrigin === priorEditOrigin ||
              enteredOrigin === origins.get(MY_SETS_URL))
            return browserFailure();
          origins.set(editUrl, enteredOrigin);
          expectedReadUrl = editUrl;
          const editState = await readScript(
            inspectBlooketPage as (...args: never[]) => unknown,
            [{ kind: "session.observe" }],
          );
          if (!exactObservedState(editState, "edit")) return browserFailure();

          if (!await editorReady(editUrl)) return browserFailure();
          questionOpenUnconfirmed = true;
          const opened = await script(
            openBlooketCapabilityQuestionPanel as (...args: never[]) => unknown,
            [setId],
          );
          if (opened === true || opened === false)
            questionOpenUnconfirmed = false;
          panelOpened = opened === true;
          if (!panelOpened || !await editorReady(editUrl))
            return browserFailure();
          if (!await pollTrue(
            readScript,
            isBlooketCapabilityQuestionPanelReady,
            [setId],
            pause,
            probeDeadline,
            now,
          ))
            return browserFailure();

          if (!await editorReady(editUrl)) return browserFailure();
          audioOpenUnconfirmed = true;
          const drawer = await script(
            openBlooketAudioCapabilityDrawer as (...args: never[]) => unknown,
            [setId],
          );
          if (drawer === true || drawer === false)
            audioOpenUnconfirmed = false;
          drawerOpened = drawer === true;
          if (!drawerOpened || !await editorReady(editUrl))
            return browserFailure();
          const inspected = await pollCapability(
            readScript, setId, pause, probeDeadline, now,
          );
          if (inspected === undefined) return browserFailure();
          // A Plus gate can change while the Audio drawer is open. Require
          // two exact observations, without retrying a contradictory reply.
          await pause(Math.min(POLL_MS, probeDeadline - now()));
          if (now() >= probeDeadline) return browserFailure();
          const tabBeforeConfirmation = await chrome.tabs.get(tabId);
          if (
            now() >= probeDeadline ||
            tabBeforeConfirmation.status !== "complete" ||
            tabBeforeConfirmation.url !== editUrl
          ) return browserFailure();
          const again = await readScript(
            inspectBlooketAudioCapabilityDrawer as
              (...args: never[]) => unknown,
            [setId],
          );
          if (
            !exactCapabilityFields(again, ["ok", "value"]) ||
            again.ok !== true || again.value !== inspected
          ) return browserFailure();
          const tabAfterConfirmation = await chrome.tabs.get(tabId);
          if (
            now() >= probeDeadline ||
            tabAfterConfirmation.status !== "complete" ||
            tabAfterConfirmation.url !== editUrl
          ) return browserFailure();
          accountMedia = inspected;
        }

        if (now() >= probeDeadline) return browserFailure();
        outcome = {
          ok: true,
          value: blooketCapabilitySnapshotCandidate(
            new Date().toISOString().slice(0, 10),
            accountMedia,
          ),
        };
      } catch {
        outcome = browserFailure();
      } finally {
        // If the user navigated away, this probe no longer owns the editor
        // DOM and must not inject cleanup actions into their new page.
        const cleanupUrl = setId === undefined ? undefined :
          DASHBOARD_ORIGIN + "/edit?id=" + encodeURIComponent(setId);
        const tabBeforeCleanup = await chrome.tabs.get(tabId)
          .catch(() => undefined);
        const canClean = cleanupUrl !== undefined &&
          tabBeforeCleanup?.status === "complete" &&
          tabBeforeCleanup.url === cleanupUrl &&
          await ownsDocument(cleanupUrl, finishDeadline).catch(() => false);
        // Chrome serializes each cleanup helper independently. The initial
        // route check does not own later scripts if the user navigates during
        // Cancel or a closure poll, so recheck around every helper.
        const cleanupScript = async (
          func: (...args: never[]) => unknown,
          args: unknown[] = [],
        ): Promise<unknown> => {
          const before = await chrome.tabs.get(tabId);
          if (before.status !== "complete" || before.url !== cleanupUrl)
            throw new Error("browser-capability-tab-changed");
          if (!await ownsDocument(cleanupUrl!, finishDeadline))
            throw new Error("browser-capability-document-changed");
          const result = await script(func, args);
          const after = await chrome.tabs.get(tabId);
          if (after.status !== "complete" || after.url !== cleanupUrl ||
              !await ownsDocument(cleanupUrl!, finishDeadline))
            throw new Error("browser-capability-tab-changed");
          return result;
        };
        if (!canClean && (panelOpened || drawerOpened))
          outcome = browserFailure();
        if (questionOpenUnconfirmed || audioOpenUnconfirmed)
          outcome = browserFailure();
        let drawerCleaned = !drawerOpened && !audioOpenUnconfirmed;
        if (canClean && !questionOpenUnconfirmed &&
            !audioOpenUnconfirmed && setId !== undefined && drawerOpened) {
          drawerCleaned = await closeDrawer(
            cleanupScript, setId, pause, finishDeadline, now,
          );
          if (!drawerCleaned) outcome = browserFailure();
        }
        // A still-open Audio drawer may obscure the parent's Cancel button.
        // Never interact with the underlying question form unless the child
        // has been independently confirmed closed.
        let questionCleaned = !panelOpened && !questionOpenUnconfirmed;
        if (canClean && drawerCleaned && !audioOpenUnconfirmed &&
            setId !== undefined && panelOpened) {
          questionCleaned = await closeQuestionPanel(
            cleanupScript, setId, pause, finishDeadline, now,
          );
          if (!questionCleaned) outcome = browserFailure();
        }
        // A failed Cancel or unconfirmed closure can mean that a teacher
        // started editing the modal. Never navigate away and discard it.
        // Only fully closed owned UI allows restoration of the old route.
        if (!drawerCleaned || !questionCleaned)
          outcome = browserFailure();
        if (originalUrl !== undefined && drawerCleaned && questionCleaned) {
          const current = await chrome.tabs.get(tabId).catch(() => undefined);
          // An unhydrated My Sets page that this probe navigated to may
          // safely be left before any question editor or document was claimed.
          // Once evidence is collected, an unexpected reload is not ours.
          const unclaimedListing = current?.url === MY_SETS_URL &&
            setId === undefined && !origins.has(MY_SETS_URL);
          const ownedRestoration = typeof current?.url === "string" &&
            await ownsDocument(current.url, finishDeadline)
              .catch(() => false);
          const canRestore = unclaimedListing || ownedRestoration;
          const restored = canRestore && await restore(
            chrome,
            tabId,
            originalUrl,
            [MY_SETS_URL, ...(setId === undefined ? [] : [
              DASHBOARD_ORIGIN + "/edit?id=" + encodeURIComponent(setId),
            ])],
            pause,
            finishDeadline,
            now,
            unclaimedListing ? undefined : async () =>
              await ownsDocument(current!.url!, finishDeadline),
            nativeDocument,
          ).catch(() => false);
          if (!restored) outcome = browserFailure();
        }
        if (now() >= finishDeadline) outcome = browserFailure();
      }
      return outcome;
    },
  };
}

async function navigate(
  chrome: CapabilityInspectionChromePort,
  tabId: number,
  url: string,
  allowedPreviousUrl: string,
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
  sourceDocument: (() => Promise<boolean>) | undefined,
  nativeDocument: (url: string) => Promise<unknown>,
): Promise<boolean> {
  if (now() >= deadline) return false;
  const current = await chrome.tabs.get(tabId);
  if (now() >= deadline ||
      (current.url !== url && current.url !== allowedPreviousUrl))
    return false;
  if (sourceDocument && !await sourceDocument()) return false;
  const checked = await chrome.tabs.get(tabId);
  if (now() >= deadline || checked.url !== current.url ||
      (sourceDocument && checked.status !== "complete")) return false;
  const changingDocument = current.url !== url;
  const sourceOrigin = changingDocument && current.url
    ? await nativeDocument(current.url) : undefined;
  if (changingDocument &&
      (typeof sourceOrigin !== "number" ||
       !Number.isFinite(sourceOrigin) || sourceOrigin <= 0)) return false;
  if (now() >= deadline ||
      (sourceDocument && !await sourceDocument())) return false;
  if (changingDocument) await chrome.tabs.update(tabId, { url });
  for (let attempt = 0; attempt < MAX_POLLS && now() < deadline;
    attempt++) {
    const tab = await chrome.tabs.get(tabId);
    if (now() >= deadline) return false;
    if (tab.status === "complete" && tab.url === url) {
      // tabs.update/get may expose the destination URL while its previous
      // document is still complete. Wait for the actual destination document,
      // rather than failing the capability probe on that transitional reply.
      const origin = await nativeDocument(url);
      if (typeof origin === "number" &&
          Number.isFinite(origin) && origin > 0 &&
          (!changingDocument || origin !== sourceOrigin)) {
        const after = await chrome.tabs.get(tabId);
        return now() < deadline && after.status === "complete" &&
          after.url === url;
      }
      if (origin !== null && origin !== sourceOrigin) return false;
    } else if (tab.url !== url && tab.url !== current.url) return false;
    await pause(Math.min(POLL_MS, deadline - now()));
  }
  return false;
}

async function restore(
  chrome: CapabilityInspectionChromePort,
  tabId: number,
  url: string,
  ownedRoutes: readonly string[],
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
  sourceDocument: (() => Promise<boolean>) | undefined,
  nativeDocument: (url: string) => Promise<unknown>,
): Promise<boolean> {
  if (new URL(url).origin !== DASHBOARD_ORIGIN) return false;
  // The user may have navigated the tab independently. An unfamiliar route,
  // even on the same provider origin, is no longer ours to overwrite.
  const current = await chrome.tabs.get(tabId);
  if (current.url !== url && !ownedRoutes.includes(current.url ?? ""))
    return false;
  if (now() >= deadline) {
    // Only an unclaimed My Sets route can be restored after the deadline.
    // A previously claimed document cannot be checked at this point.
    if (sourceDocument) return false;
    if (current.url !== url) await chrome.tabs.update(tabId, { url });
    return false;
  }
  return await navigate(
    chrome, tabId, url, current.url ?? url, pause, deadline, now,
    sourceDocument,
    nativeDocument,
  );
}

async function pollTrue(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  func: (...args: never[]) => unknown,
  args: unknown[],
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 15 && now() < deadline; attempt++) {
    const observed = await script(func, args);
    if (now() >= deadline) return false;
    if (observed === true) return true;
    // A pending panel is exactly false, never a string or missing result.
    if (observed !== false) return false;
    await pause(Math.min(POLL_MS, deadline - now()));
  }
  return false;
}

async function pollCapability(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  setId: string,
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
): Promise<"supported" | "unsupported" | undefined> {
  for (let attempt = 0; attempt < 15 && now() < deadline; attempt++) {
    const result = await script(
      inspectBlooketAudioCapabilityDrawer as (...args: never[]) => unknown,
      [setId],
    );
    if (now() >= deadline || !result || typeof result !== "object" ||
        Array.isArray(result)) return undefined;
    if (exactCapabilityFields(result, ["ok", "value"]) &&
        result.ok === true &&
        (result.value === "supported" || result.value === "unsupported"))
      return result.value;
    // A genuine page-unavailable state can mean drawer hydration. Invalid
    // success or diagnostic envelopes must not become true after a later poll.
    if (!exactCapabilityFields(result, ["ok", "code"]) ||
        result.ok !== false || result.code !== "blooket-browser-failed")
      return undefined;
    await pause(Math.min(POLL_MS, deadline - now()));
  }
  return undefined;
}

async function stableClosure(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  func: (...args: never[]) => unknown,
  setId: string,
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
  initiallyClosed: boolean,
): Promise<boolean> {
  if (!initiallyClosed && !await pollTrue(
    script, func, [setId], pause, deadline, now,
  )) return false;
  if (now() >= deadline) return false;
  // A single missing drawer/form can be a transient React detach. Require
  // an independently checked next turn before restoring the teacher route.
  await pause(0);
  if (now() >= deadline) return false;
  return await script(func, [setId]) === true && now() < deadline;
}

async function closeDrawer(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  setId: string,
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
): Promise<boolean> {
  const alreadyClosed = await script(
    isBlooketAudioCapabilityDrawerClosed as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (alreadyClosed === true) return await stableClosure(
    script, isBlooketAudioCapabilityDrawerClosed, setId,
    pause, deadline, now, true,
  );
  if (alreadyClosed !== false) return false;
  const closed = await script(
    closeBlooketAudioCapabilityDrawer as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (closed !== true) return false;
  return await stableClosure(
    script, isBlooketAudioCapabilityDrawerClosed,
    setId, pause, deadline, now, false,
  ).catch(() => false);
}

async function closeQuestionPanel(
  script: (
    func: (...args: never[]) => unknown,
    args?: unknown[],
  ) => Promise<unknown>,
  setId: string,
  pause: (ms: number) => Promise<void>,
  deadline: number,
  now: () => number,
): Promise<boolean> {
  const alreadyClosed = await script(
    isBlooketCapabilityQuestionPanelClosed as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (alreadyClosed === true) return await stableClosure(
    script, isBlooketCapabilityQuestionPanelClosed, setId,
    pause, deadline, now, true,
  );
  if (alreadyClosed !== false) return false;
  const closed = await script(
    closeBlooketCapabilityQuestionPanel as (...args: never[]) => unknown,
    [setId],
  ).catch(() => false);
  if (closed !== true) return false;
  return await stableClosure(
    script, isBlooketCapabilityQuestionPanelClosed,
    setId, pause, deadline, now, false,
  ).catch(() => false);
}

function admittedSetList(value: unknown): {
  readonly completeness: "complete" | "unknown";
  readonly items: readonly { readonly schemaVersion: 1;
    readonly id: string; readonly title: string }[];
} | undefined {
  const envelope = exactOwnData(value, ["ok", "value"]);
  if (!envelope || envelope["ok"] !== true) return undefined;
  const list = exactOwnData(envelope["value"], ["completeness", "items"]);
  if (!list) return undefined;
  const completeness = list["completeness"];
  if (completeness !== "complete" && completeness !== "unknown")
    return undefined;
  const decoded = decodeBlooketSetList(list["items"]);
  if (!decoded.ok ||
      (completeness === "complete" && decoded.value.length !== 0) ||
      (decoded.value.length === 0 && completeness !== "complete"))
    return undefined;
  return { completeness, items: decoded.value };
}

function firstSetId(value: unknown): string | null | undefined {
  const admitted = admittedSetList(value);
  if (!admitted) return undefined;
  return admitted.items[0]?.id ?? null;
}

function sameAdmittedSetLists(first: unknown, second: unknown): boolean {
  const a = admittedSetList(first);
  const b = admittedSetList(second);
  if (!a || !b || a.completeness !== b.completeness ||
      a.items.length !== b.items.length) return false;
  for (let index = 0; index < a.items.length; index++) {
    const left = a.items[index]!;
    const right = b.items[index]!;
    if (left.id !== right.id || left.title !== right.title)
      return false;
  }
  return true;
}

function exactObservedState(value: unknown, state: string): boolean {
  return (
    exactCapabilityFields(value, ["ok", "value"]) &&
    value.ok === true && value.value === state
  );
}

function dashboardTab(tab: BrowserTab): boolean {
  if (!tab.url) return false;
  try {
    return new URL(tab.url).origin === DASHBOARD_ORIGIN;
  } catch {
    return false;
  }
}

function browserFailure(): ExtensionCapabilityInspectionResult {
  return { ok: false, code: "blooket-browser-failed" };
}
