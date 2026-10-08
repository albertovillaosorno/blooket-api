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
//   - Anonymous bounded release-asset transport and response ownership.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Validated release URL, cancellation, and a local fetch port.
//   - Outputs: An owned response or stable transport failure.
//   - Side effects: Anonymous HTTPS with restricted redirects and
//     owned response cancellation.
// - Split-When:
//   - Bundle replacement gains a separate transactional authority.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Shares owned response transport across update metadata and archives.
// - Description:
//   - Refuses foreign redirects and cancels late responses after abort.
// - Usage:
//   - Validate the initial URL before calling; bound the consuming operation.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import type { UpdateArchiveFetch } from "./download.ts";

export async function downloadResponse(
  initial: string, fetcher: UpdateArchiveFetch, signal: AbortSignal,
): Promise<Response> {
  let url = initial;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (signal.aborted) throw new Error("cancelled");
    const pending = fetcher(url, {
      method: "GET",
      headers: { Accept: "application/octet-stream" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "manual",
      cache: "no-store",
      signal,
    });
    // A fetch implementation may ignore abort and resolve after our deadline.
    // Its response still belongs to this operation and must release its body.
    void pending.then(response => {
      if (signal.aborted)
        void response.body?.cancel().catch(() => undefined);
    }, () => undefined);
    const response = await abortable(pending, signal);
    if (response.redirected || (response.url && response.url !== url)) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("redirect");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      void response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location || location.length > 8192) throw new Error("redirect");
      let next: URL;
      try { next = new URL(location, url); }
      catch { throw new Error("redirect"); }
      if (
        next.protocol !== "https:" || next.username || next.password
        || next.port || next.hash
        || (next.href !== initial
          && next.hostname !== "release-assets.githubusercontent.com")
      ) throw new Error("redirect");
      url = next.href;
      continue;
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("http");
    }
    return response;
  }
  throw new Error("redirect");
}

export function abortable<T>(
  pending: Promise<T>, signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.then(value => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    if (signal.aborted) abort();
  });
}
