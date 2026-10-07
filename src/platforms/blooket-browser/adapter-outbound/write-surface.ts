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
  submitCreateSet(): Promise<
    | { readonly ok: true }
    | BlooketBrowserWriteSurfaceFailure
  >;
  observeCreateSet(): Promise<
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
        const opened = await host.openCreateSet();
        if (!opened.ok) return opened;
        const prepared = await host.prepareCreateSet({
          title: submission.title,
          description: submission.description,
          private: submission.private,
        });
        if (!prepared.ok) return prepared;
        const submitted = await host.submitCreateSet();
        if (!submitted.ok) return submitted;
        return await host.observeCreateSet();
      } catch {
        return browserFailure();
      }
    },
    addQuestion: async () => browserFailure(),
  };
}

function browserFailure(): BlooketBrowserWriteSurfaceFailure {
  return {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  };
}
