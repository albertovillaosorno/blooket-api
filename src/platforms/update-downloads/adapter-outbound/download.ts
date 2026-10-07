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
//   - Bounded download staging of publisher-authenticated update archives.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Signed metadata, archive bytes, and admitted local public keys.
//   - Outputs: Verified metadata or bounded verification failures.
//   - Side effects: Anonymous HTTPS and owned temporary staging files.
// - Split-When:
//   - Bundle replacement gains a separate transactional authority.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Stages signed archives without granting installation authority.
// - Description:
//   - Rejects malformed metadata, foreign assets, and future releases.
// - Usage:
//   - Verify signed metadata before bounded streaming and final publication.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  verifySignedUpdateManifest,
  type ManifestVerification,
} from "../../update-signatures/adapter-outbound/verify.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";

export type UpdateArchiveFetch = (
  url: string, init: RequestInit,
) => Promise<Response>;
type VerificationFailure = Extract<ManifestVerification, { ok: false }>;
export type UpdateDownloadResult =
  | {
      readonly status: "downloaded";
      readonly archivePath: string;
      readonly version: string;
      readonly requiresAppleVerification: true;
    }
  | {
      readonly status: "verification-failed";
      readonly reason: VerificationFailure["reason"]
        | "size-mismatch" | "hash-mismatch";
    }
  | {
      readonly status: "download-failed";
      readonly reason: "timeout" | "cancelled" | "http" | "redirect"
        | "unavailable" | "storage" | "busy" | "cleanup";
    };
export interface UpdateDownloadOptions {
  readonly directory: string;
  readonly verification: Parameters<typeof verifySignedUpdateManifest>[0];
  readonly signal?: AbortSignal;
  readonly fetch?: UpdateArchiveFetch;
  readonly timeoutMs?: number;
}

// Directory and publisher keys are local authority, never MCP input.
// The signature decoder owns the initial repository/tag/asset URL constraint.
export async function downloadSignedUpdate(
  options: UpdateDownloadOptions,
): Promise<UpdateDownloadResult> {
  const verified = verifySignedUpdateManifest(options.verification);
  if (!verified.ok)
    return { status: "verification-failed", reason: verified.reason };
  const deadline = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(deadline) || deadline < 1 || deadline > 120_000)
    throw new Error("invalid-update-download-timeout");
  if (options.signal?.aborted)
    return { status: "download-failed", reason: "cancelled" };
  const acquired = await tryAcquireFileLock(
    join(options.directory, ".download.lock"),
  );
  if (!acquired.ok)
    return {
      status: "download-failed",
      reason: acquired.reason === "busy" ? "busy" : "storage",
    };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadline);
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  let temporary: string | undefined;
  let published = false;
  try {
    const response = await downloadResponse(
      verified.asset.url, options.fetch ?? fetch, controller.signal,
    );
    const length = response.headers.get("content-length");
    if (
      length !== null
      && (!/^[0-9]{1,12}$/u.test(length)
        || Number(length) !== verified.asset.size)
    ) throw new Error("size-mismatch");
    if (!response.body) throw new Error("size-mismatch");
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    temporary = await mkdtemp(join(options.directory, "download-"));
    const partial = join(temporary, verified.asset.name + ".partial");
    const destination = join(temporary, verified.asset.name);
    const file = await open(partial, "wx", 0o600);
    const reader = response.body.getReader();
    let count = 0;
    const hash = createHash("sha256");
    try {
      for (;;) {
        const chunk = await abortable(reader.read(), controller.signal);
        if (chunk.done) break;
        count += chunk.value.byteLength;
        if (count > verified.asset.size) throw new Error("size-mismatch");
        hash.update(chunk.value);
        await file.writeFile(chunk.value);
      }
      if (count !== verified.asset.size) throw new Error("size-mismatch");
      if (hash.digest("hex") !== verified.asset.sha256)
        throw new Error("hash-mismatch");
      if (controller.signal.aborted) throw new Error("cancelled");
      await file.sync();
    } finally {
      void reader.cancel().catch(() => undefined);
      await file.close();
    }
    if (controller.signal.aborted) throw new Error("cancelled");
    await rename(partial, destination);
    const folder = await open(temporary, "r");
    try { await folder.sync(); }
    finally { await folder.close(); }
    if (controller.signal.aborted) throw new Error("cancelled");
    published = true;
    return {
      status: "downloaded",
      archivePath: destination,
      version: verified.manifest.version,
      requiresAppleVerification: true,
    };
  } catch (error) {
    if (controller.signal.aborted)
      return {
        status: "download-failed", reason: timedOut ? "timeout" : "cancelled",
      };
    const code = error instanceof Error ? error.message : "unavailable";
    if (code === "size-mismatch" || code === "hash-mismatch")
      return { status: "verification-failed", reason: code };
    return {
      status: "download-failed",
      reason: code === "http" || code === "redirect"
        ? code
        : error instanceof Error && "code" in error
          ? "storage" : "unavailable",
    };
  } finally {
    controller.abort();
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    let cleanupFailed = false;
    try {
      if (temporary && !published)
        await rm(temporary, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    try { await acquired.lock.release(); }
    catch { cleanupFailed = true; }
    if (cleanupFailed)
      return { status: "download-failed", reason: "cleanup" };
  }
}

async function downloadResponse(
  initial: string, fetcher: UpdateArchiveFetch, signal: AbortSignal,
): Promise<Response> {
  let url = initial;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await abortable(fetcher(url, {
      method: "GET",
      headers: { Accept: "application/octet-stream" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "manual",
      cache: "no-store",
      signal,
    }), signal);
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

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
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
