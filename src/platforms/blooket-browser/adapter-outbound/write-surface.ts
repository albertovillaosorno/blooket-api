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
//   - Browser-surface composition for one observed text-only Create Set flow.
// - Must-Not:
//   - Retry, upload media, add questions, or infer success from submission.
// - Allows:
//   - Inputs: Lowered browser submissions and one strict browser host.
//   - Outputs: Observed Create Set success or stable stop/failure outcomes.
//   - Side effects: One navigation, preparation, and submit for Create Set.
// - Split-When:
//   - Add Question or media upload gains independently verified mechanics.
// - Merge-When:
//   - The extension directly implements the browser write surface contract.
// - Summary:
//   - Makes text Create Set executable without weakening success semantics.
// - Description:
//   - Confirmation comes only from a separately observed provider result.
// - Usage:
//   - Compose with a host that executes the verified page helpers.
// - Defaults:
//   - Unsupported media and Add Question fail before remote mutation.
//
import { decodeBlooketSetId } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";
import type {
  BlooketBrowserWriteSurfaceFailure,
  BlooketBrowserWriteSurfacePort,
} from
  "../../../api/blooket-write-execution/contract/browser-write-surface.ts";

export interface BlooketCreateSetBrowserHost {
  openCreateSet(): Promise<
    | { readonly ok: true }
    | BlooketBrowserWriteSurfaceFailure
  >;
  prepareCreateSet(input: {
    readonly title: string;
    readonly description: string;
    readonly private: boolean;
  }): Promise<
    | { readonly ok: true }
    | BlooketBrowserWriteSurfaceFailure
  >;
  submitCreateSet(expected: {
    readonly title: string;
    readonly description: string;
    readonly private: boolean;
  }): Promise<
    | { readonly ok: true }
    | BlooketBrowserWriteSurfaceFailure
  >;
  observeCreateSet(expected: {
    readonly title: string;
    readonly description: string;
  }): Promise<
    | { readonly ok: true; readonly remoteSetId: unknown }
    | BlooketBrowserWriteSurfaceFailure
  >;
}

export function createBlooketBrowserWriteSurface(
  host: BlooketCreateSetBrowserHost,
): BlooketBrowserWriteSurfacePort {
  return {
    createSet: async (submission, media) => {
      if (media.length !== 0 || submission.coverImage !== null)
        return browserFailure();
      try {
        const opened = admitHostStep(await host.openCreateSet());
        if (!opened.ok) return opened;
        const expected = {
          title: submission.title,
          description: submission.description,
          private: submission.private,
        };
        const prepared = admitHostStep(await host.prepareCreateSet(expected));
        if (!prepared.ok) return prepared;
        const submitted = admitHostStep(await host.submitCreateSet(expected));
        if (!submitted.ok) return submitted;
        const observed = await host.observeCreateSet({
          title: expected.title,
          description: expected.description,
        });
        return admitHostObservation(observed);
      } catch {
        return browserFailure();
      }
    },
    addQuestion: async () => browserFailure(),
  };
}

function exactHostKeys(value: unknown, names: string): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Reflect.ownKeys(value).sort().join() === names;
}

function admitHostStep(
  reply: unknown,
): { readonly ok: true } | BlooketBrowserWriteSurfaceFailure {
  if (!reply || typeof reply !== "object" || !("ok" in reply))
    return browserFailure();
  if (reply.ok === true && exactHostKeys(reply, "ok"))
    return { ok: true };
  if (reply.ok !== false || !("kind" in reply))
    return browserFailure();
  if (reply.kind === "browser" && exactHostKeys(reply, "code,kind,ok") &&
      "code" in reply &&
      (reply.code === "blooket-browser-failed" ||
       reply.code === "blooket-browser-unavailable"))
    return { ok: false, kind: "browser", code: reply.code };
  if (reply.kind === "navigation" && exactHostKeys(reply, "kind,ok,state") &&
      "state" in reply &&
      (reply.state === "signed-out" || reply.state === "expired-session" ||
       reply.state === "organization-prompt" ||
       reply.state === "rate-limited" ||
       reply.state === "security-challenge" ||
       reply.state === "unexpected-page"))
    return { ok: false, kind: "navigation", state: reply.state };
  return browserFailure();
}

function admitHostObservation(
  reply: unknown,
): { readonly ok: true; readonly remoteSetId: string } |
  BlooketBrowserWriteSurfaceFailure {
  if (exactHostKeys(reply, "ok,remoteSetId") &&
      reply && typeof reply === "object" &&
      "ok" in reply && reply.ok === true &&
      "remoteSetId" in reply) {
    const decoded = decodeBlooketSetId(reply.remoteSetId);
    if (decoded.ok) return { ok: true, remoteSetId: decoded.value };
  }
  const stopped = admitHostStep(reply);
  return stopped.ok ? browserFailure() : stopped;
}

function browserFailure(): BlooketBrowserWriteSurfaceFailure {
  return {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  };
}
