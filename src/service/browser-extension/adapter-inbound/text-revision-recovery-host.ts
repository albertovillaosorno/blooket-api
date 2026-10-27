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
//   - Read-only recovery of an exact retained question-text Save.
// - Must-Not:
//   - Replay Save, alter media, adopt foreign editors, or invent success.
// - Allows:
//   - Inputs: Exact submitted owner, revision and bounded Chrome port.
//   - Outputs: Verified, unchanged or uncertain recovery; no Save.
//   - Side effects: One temporary read tab and confirmed source-panel cleanup.
// - Split-When:
//   - Provider media editing requires independent host mechanics.
// - Merge-When:
//   - Existing text edits share one provider mutation host.
// - Summary:
//   - Preserves the submitted form until an independent read finishes.
// - Description:
//   - A lost response permits verification only, never another Save.
// - Usage:
//   - Execute only through an admitted text.revise bridge command.
// - Defaults:
//   - Pre-submit failures refuse; post-submit failures remain uncertain.
//
import type { BlooketTextRevision } from
  "../../../ir/blooket-publication-commands/contract/text-revision.ts";
import { exactOwnData, snapshotExactDenseArray } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";
import { inspectBlooketDocumentOrigin } from
  "../../../platforms/blooket-browser/adapter-outbound/document-page.ts";
import { runBlooketTextRevisionPageAction } from
  "../../../platforms/blooket-browser/adapter-outbound/text-revision-page.ts";
import { isBlooketQuestionPanelClosed } from
  "../../../platforms/blooket-browser/adapter-outbound/question-page.ts";
import type { AddQuestionChromePort } from "./add-question-host.ts";
import type { DetachedQuestionReadChromePort } from
  "./detached-question-read-host.ts";
import { createExtensionTextRevisionHost } from "./text-revision-host.ts";
import { exactCreatedBlooketReadTabId, classifyBlooketReadTabLoad } from
  "./read-navigation.ts";

type Browser = AddQuestionChromePort & DetachedQuestionReadChromePort;
type Outcome = "verified" | "unchanged" | "uncertain";

export async function recoverRetainedTextRevision(browser: Browser,
  sourceId: number, input: BlooketTextRevision, deadline: number,
  pause: (ms: number) => Promise<void>): Promise<Outcome | undefined> {
  if (input.change.kind !== "question-text") return undefined;
  const url = "https://dashboard.blooket.com/edit?id=" +
    encodeURIComponent(input.expectedSet.id);
  const script = async (func: (...args: never[]) => unknown,
    args: unknown[] = []) => {
    if (Date.now() >= deadline) throw Error("recovery-deadline");
    const frames = snapshotExactDenseArray(
      await browser.scripting.executeScript(
        { target: { tabId: sourceId }, func, args }), 1);
    const frame = frames?.length === 1 ? frames[0] : undefined;
    if (!frame || typeof frame !== "object") throw Error("recovery-frame");
    const id = Object.getOwnPropertyDescriptor(frame, "frameId");
    const value = Object.getOwnPropertyDescriptor(frame, "result");
    if ((id && (!id.enumerable || !("value" in id) || id.value !== 0)) ||
        !value?.enumerable || !("value" in value))
      throw Error("recovery-frame");
    return value.value;
  };
  const origin = async () => {
    const tab = await browser.tabs.get(sourceId);
    if (tab.url !== url || tab.status !== "complete" ||
        tab.pendingUrl !== undefined) return undefined;
    const value = await script(inspectBlooketDocumentOrigin as
      (...args: never[]) => unknown, [url]);
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value : undefined;
  };
  const pending = async (identity?: string) => exactOwnData(await script(
    runBlooketTextRevisionPageAction as (...args: never[]) => unknown,
    ["inspect-pending", input, ...(identity ? [identity] : [])]),
    ["ok", "mediaIdentity"]);
  let readId: number | undefined;
  let removed = false;
  let outcome: Outcome = "uncertain";
  try {
    const epoch = await origin();
    const before = epoch === undefined ? undefined : await pending();
    if (before?.["ok"] !== true) return undefined;
    const identity = before["mediaIdentity"];
    if (typeof identity !== "string" || !/^[a-f0-9]{64}$/u.test(identity))
      return "uncertain";
    const created = await browser.tabs.create({ url, active: false });
    readId = exactCreatedBlooketReadTabId(created);
    if (readId === undefined) return "uncertain";
    let ready = false;
    for (let n = 0; n < 50 && Date.now() < deadline; n++) {
      const state = classifyBlooketReadTabLoad(
        await browser.tabs.get(readId), url, true);
      if (state === "changed") return "uncertain";
      if (state === "ready") { ready = true; break; }
      await pause(100);
    }
    if (!ready) return "uncertain";
    const host = createExtensionTextRevisionHost(browser, readId, pause);
    const result = await host.revise(input, true, deadline - 1_000, identity);
    if ((result !== "verified" && result !== "unchanged") ||
        await origin() !== epoch ||
        (await pending(identity))?.["ok"] !== true) return "uncertain";
    const released = exactOwnData(await script(
      runBlooketTextRevisionPageAction as (...args: never[]) => unknown,
      ["release-confirmed", input, identity]), ["ok"]);
    if (released?.["ok"] !== true) return "uncertain";
    for (let n = 0; n < 20 && Date.now() < deadline; n++) {
      if (await origin() !== epoch) return "uncertain";
      if (await script(isBlooketQuestionPanelClosed as
          (...args: never[]) => unknown, [input.expectedSet.id]) === true) {
        outcome = result; break;
      }
      await pause(100);
    }
  } catch { outcome = "uncertain"; }
  finally {
    if (readId !== undefined) {
      try { await browser.tabs.remove(readId); removed = true; }
      catch { /* Retain uncertainty when a read tab cannot be retired. */ }
    }
  }
  return removed ? outcome : "uncertain";
}
