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
//   - One native existing-text edit and independent reloaded verification.
// - Must-Not:
//   - Replay Save, alter media, adopt foreign editors, or invent success.
// - Allows:
//   - Inputs: Dedicated exact tab, decoded request and finite deadline.
//   - Outputs: Verified, explicitly not submitted, or uncertain outcome.
//   - Side effects: Native owned editor, one Save and a fresh reload.
// - Split-When:
//   - Provider media editing requires independent host mechanics.
// - Merge-When:
//   - Existing text edits share one provider mutation host.
// - Summary:
//   - Preserves media during existing title, description and question edits.
// - Description:
//   - A lost response permits verification only, never another Save.
// - Usage:
//   - Execute only through an admitted text.revise bridge command.
// - Defaults:
//   - Pre-submit failures refuse; post-submit failures remain uncertain.
//
import type { BlooketTextRevision } from
  "../../../ir/blooket-publication-commands/contract/text-revision.ts";
import type { AddQuestionChromePort } from "./add-question-host.ts";
import { decodeBlooketSetDetail } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";
import { decodeBlooketQuestionImageEvidence } from
  "../../../ir/blooket-question-reads/contract/question-read.ts";
import { snapshotExactDenseArray, exactOwnData } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";
import { inspectBlooketDocumentOrigin } from
  "../../../platforms/blooket-browser/adapter-outbound/document-page.ts";
import { inspectBlooketPage, inspectBlooketDetailSidebar,
  openBlooketDetailPanel, closeBlooketDetailPanel,
  isBlooketDetailPanelClosed } from
  "../../../platforms/blooket-browser/adapter-outbound/page.ts";
import { openBlooketQuestionPanel, closeBlooketQuestionPanel,
  isBlooketQuestionPanelClosed } from
  "../../../platforms/blooket-browser/adapter-outbound/question-page.ts";
import { inspectOpenedBlooketQuestionImage } from
  "../../../platforms/blooket-browser/adapter-outbound/question-image-page.ts";
import { runBlooketTextRevisionPageAction } from
  "../../../platforms/blooket-browser/adapter-outbound/text-revision-page.ts";

export function createExtensionTextRevisionHost(chrome: AddQuestionChromePort,
  tabId: number, pause: (ms: number) => Promise<void>,
  stage: (value: string) => void = () => {}) {
  const script = async (func: (...args: never[]) => unknown,
    args: unknown[] = []): Promise<unknown> => {
    const frames = snapshotExactDenseArray(await chrome.scripting.executeScript(
      { target: { tabId }, func, args }), 1);
    const frame = frames?.length === 1 ? frames[0] : undefined;
    if (!frame || typeof frame !== "object") throw Error("invalid-frame");
    const result = Object.getOwnPropertyDescriptor(frame, "result");
    const id = Object.getOwnPropertyDescriptor(frame, "frameId");
    if (!result?.enumerable || !("value" in result) ||
        (id && (!id.enumerable || !("value" in id) || id.value !== 0)))
      throw Error("invalid-frame");
    return result.value;
  };
  return {
    revise: async (input: BlooketTextRevision, verifyOnly: boolean,
      deadline: number, retainedMediaIdentity?: string):
      Promise<"verified" | "not-submitted" | "unchanged" | "uncertain"> => {
      const set = input.expectedSet, change = input.change;
      const url = "https://dashboard.blooket.com/edit?id=" +
        encodeURIComponent(set.id);
      const metadataChange = change.kind !== "question-text";
      let origin: number | undefined;
      let submitted = verifyOnly;
      let opened = false;
      let freshRead = false;
      let observedMetadata: { title: string; description: string;
        visibility: "private" | "public" } | undefined;
      const failure = () => submitted ? "uncertain" as const
        : "not-submitted" as const;
      const sameTab = async (fresh = false): Promise<boolean> => {
        if (Date.now() >= deadline) return false;
        const tab = await chrome.tabs.get(tabId);
        if (Date.now() >= deadline || tab.url !== url ||
            tab.status !== "complete" || tab.pendingUrl !== undefined)
          return false;
        const epoch = await script(inspectBlooketDocumentOrigin as
          (...args: never[]) => unknown, [url]);
        if (typeof epoch !== "number" || !Number.isFinite(epoch) || epoch <= 0)
          return false;
        if (fresh) {
          if (epoch === origin) return false;
          origin = epoch;
        } else if (origin === undefined) origin = epoch;
        return epoch === origin && Date.now() < deadline;
      };
      const wait = async (predicate: () => Promise<boolean>) => {
        while (Date.now() < deadline) {
          if (await predicate()) return true;
          await pause(100);
        }
        return false;
      };
      const action = async (kind: "prepare" | "submit" | "verify" |
        "verify-original" | "release",
        identity?: string) => {
        if (!await sameTab()) return undefined;
        const result = await script(runBlooketTextRevisionPageAction as
          (...args: never[]) => unknown,
          [kind, input, ...(identity === undefined ? [] : [identity])]);
        if (!await sameTab()) return undefined;
        return exactOwnData(result, ["ok", "mediaIdentity"]) ??
          exactOwnData(result, ["ok", "stage"]) ??
          exactOwnData(result, ["ok"]);
      };
      const open = async (): Promise<boolean> => {
        if (!await sameTab()) return false;
        let source: Record<string, unknown> | undefined;
        for (let n = 0; n < 30 && await sameTab(); n++) {
          const sidebar = await script(inspectBlooketDetailSidebar as
            (...args: never[]) => unknown, [set.id]);
          source = exactOwnData(sidebar, ["ok", "value"]);
          if (source?.["ok"] === true) break;
          if (exactOwnData(sidebar, ["ok", "code"])?.["ok"] !== false)
            return false;
          await pause(100);
        }
        const metadata = exactOwnData(source?.["value"],
          ["title", "description"]);
        const expectedTitle = change.kind === "set-title" &&
          (verifyOnly || freshRead) ? change.title : set.title;
        const expectedDescription = change.kind === "set-description" &&
          (verifyOnly || freshRead) ? change.description : set.description;
        if (source?.["ok"] !== true ||
            (metadata?.["title"] !== expectedTitle &&
              !(verifyOnly && metadata?.["title"] === set.title)) ||
            (metadata["description"] !== expectedDescription &&
              !(verifyOnly && metadata["description"] === set.description)))
          return false;
        if (metadataChange) {
          if (await script(openBlooketDetailPanel as
              (...args: never[]) => unknown, [set.id]) !== true) return false;
        } else if (await script(openBlooketQuestionPanel as
            (...args: never[]) => unknown,
            [set.id, change.previous.number]) !== true) return false;
        opened = true;
        if (!metadataChange) return true;
        return await wait(async () => {
          if (!await sameTab()) return false;
          const read = exactOwnData(await script(inspectBlooketPage as
            (...args: never[]) => unknown,
            [{ kind: "sets.get", setId: set.id }]), ["ok", "value"]);
          const metadata = decodeBlooketSetDetail(read?.["value"]);
          if (read?.["ok"] !== true || !metadata.ok) return false;
          observedMetadata = metadata.value;
          return true;
        });
      };
      const close = async (): Promise<boolean> => {
        // The metadata editor may briefly retain a stale React form after
        // its read-only verification. Retry only the exact guarded Cancel;
        // no Save is ever attempted by cleanup or reconciliation.
        for (let n = 0; n < 15; n++) {
          if (!await sameTab()) return false;
          const result = metadataChange
            ? observedMetadata && await script(closeBlooketDetailPanel as
                (...args: never[]) => unknown,
                [set.id, observedMetadata, observedMetadata])
            : await script(closeBlooketQuestionPanel as
                (...args: never[]) => unknown, [set.id]);
          if (result === true) { opened = false; return true; }
          // A previous guarded Cancel may have already unmounted its form
          // despite a lost scripting reply. Accept only the native, read-only
          // proof that the exact metadata editor is fully closed.
          if (metadataChange && await script(
              isBlooketDetailPanelClosed as
                (...args: never[]) => unknown, [set.id]) === true &&
              await sameTab()) { opened = false; return true; }
          if (!metadataChange) return false;
          await pause(100);
        }
        return false;
      };
      try {
        stage("open");
        if (!await sameTab() || !await open()) return failure();
        let identity: string | undefined = retainedMediaIdentity;
        if (!verifyOnly) {
          stage("prepare");
          let prepared: Record<string, unknown> | undefined;
          // React may mount its form after the native Edit click.
          // Preparation is single-use; poll only before it claims the form.
          for (let n = 0; n < 15 && Date.now() < deadline; n++) {
            prepared = await action("prepare");
            if (prepared?.["ok"] === true) break;
            if (typeof prepared?.["stage"] === "string")
              stage("prepare-" + prepared["stage"]);
            await pause(100);
          }
          if (prepared?.["ok"] !== true ||
              typeof prepared["mediaIdentity"] !== "string") return failure();
          identity = prepared["mediaIdentity"];
          if (metadataChange) await pause(5_000);
          submitted = true;
          stage("submit");
          const saved = await action("submit");
          // An exact negative reply means the guarded click was refused.
          if (saved?.["ok"] === false) submitted = false;
          if (saved?.["ok"] !== true) return failure();
          opened = false;
          stage("closure");
          const closedProbe = metadataChange
            ? isBlooketDetailPanelClosed : isBlooketQuestionPanelClosed;
          if (!await wait(async () => await sameTab() &&
              await script(closedProbe as (...args: never[]) => unknown,
                [set.id]) === true)) return failure();
          stage("reload");
          await chrome.tabs.reload(tabId, { bypassCache: true });
          if (!await wait(() => sameTab(true))) return failure();
          freshRead = true;
          if (metadataChange) await pause(5_000);
          if (!await open()) return failure();
        }
        let verified = false;
        stage("verify");
        for (let n = 0; n < 15 && Date.now() < deadline; n++) {
          const probe = await action("verify", identity);
          if (probe?.["ok"] === true) { verified = true; break; }
          await pause(100);
        }
        // Text assignment is idempotent. Re-arm only after
        // two independent documents show the exact original fields, flags,
        // timing and original media identity. This call never clicks Save;
        // the application records recovery and stops for a separate call.
        let unchanged = false;
        if (!verified && verifyOnly) {
          const original = await action("verify-original", identity);
          unchanged = original?.["ok"] === true;
          if (!unchanged) return failure();
          // Metadata recovery, like question recovery, requires a native
          // identity bound on the first freshly read document and reproduced
          // on a distinct reloaded document before a separate new Save.
          if (metadataChange && identity === undefined) {
            const observed = original?.["mediaIdentity"];
            if (typeof observed !== "string" ||
                !/^[a-f0-9]{64}$/u.test(observed)) return failure();
            identity = observed;
          }
          // If the original collection had no image byte evidence, bind the
          // current native image serialization to the first fresh document.
          // The next document must match this exact digest before rearming.
          if (change.kind === "question-text" &&
              change.previous.hasImage &&
              !change.previous.imageEvidence && identity === undefined) {
            const observed = original?.["mediaIdentity"];
            if (typeof observed !== "string" ||
                !/^[a-f0-9]{64}$/u.test(observed)) return failure();
            identity = observed;
          }
        } else if (!verified) return failure();
        const originalImage = async (): Promise<boolean> => {
          if (change.kind !== "question-text" || !change.previous.hasImage)
            return true;
          const expected = change.previous.imageEvidence;
          if (!expected) return retainedMediaIdentity !== undefined ||
            (unchanged && identity !== undefined);
          const image = exactOwnData(await script(
            inspectOpenedBlooketQuestionImage as
              (...args: never[]) => unknown,
            [set.id, change.previous.number,
              Math.min(5_000, deadline - Date.now())]), ["ok", "value"]);
          const decoded = decodeBlooketQuestionImageEvidence(image?.["value"]);
          if (image?.["ok"] !== true || !decoded.ok ||
              JSON.stringify(decoded.value) !== JSON.stringify(expected))
            return false;
          return true;
        };
        if (verifyOnly && !await originalImage()) return failure();
        if (unchanged) {
          if (!await close()) return failure();
          await chrome.tabs.reload(tabId, { bypassCache: true });
          if (!await wait(() => sameTab(true)) || !await open() ||
              (await action("verify-original", identity))?.["ok"] !== true ||
              !await originalImage()) return failure();
        }
        stage("close");
        return await close() ? unchanged ? "unchanged" : "verified"
          : failure();
      } catch { return failure(); }
      finally {
        // A failed prepare is ours to cancel. An uncertain submitted form
        // remains intact; its next request can only verify, never click Save.
        if (opened && (!submitted || freshRead || verifyOnly)) {
          if (!submitted) await action("release").catch(() => undefined);
          await close().catch(() => false);
        }
      }
    },
  };
}
