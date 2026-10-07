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
//   - Bounded anonymous HTTPS reads of the public release catalog.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Current product version, host target, and cancellation.
//   - Outputs: Validated release candidates or bounded failure statuses.
//   - Side effects: Anonymous HTTPS reads of the fixed GitHub endpoint.
// - Split-When:
//   - Trusted manifests add an independent installation contract.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Selects final public candidates without claiming installation trust.
// - Description:
//   - Rejects malformed metadata, foreign assets, and future releases.
// - Usage:
//   - Check updates locally without credentials or installation authority.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import { isRecord } from "../../../ir/runtime-decoding/domain/exact-object.ts";
import {
  decodeUpdateRelease,
  PUBLIC_RELEASES_API,
} from "../../../ir/application-updates/contract/releases.ts";
import {
  selectPublicUpdate,
  type UpdateSelection,
} from "../../../ir/application-updates/domain/select.ts";

export const UPDATE_METADATA_BYTES = 1_000_000;
export const UPDATE_CHECK_TIMEOUT_MS = 10_000;
export type UpdateCheckResult =
  | UpdateSelection
  | {
      readonly status: "source-unavailable";
      readonly reason:
        | "http"
        | "network"
        | "timeout"
        | "cancelled"
        | "catalog-limit";
      readonly httpStatus?: number;
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly status: "untrusted-metadata";
      readonly reason:
        | "json"
        | "content-type"
        | "response-limit"
        | "pagination";
    };
class CatalogFailure extends Error {
  readonly result: UpdateCheckResult;
  constructor(result: UpdateCheckResult) {
    super("public-update-check-failed");
    this.result = result;
  }
}
function metadataFailure(
  reason: "json" | "content-type" | "response-limit" | "pagination",
): never {
  throw new CatalogFailure({ status: "untrusted-metadata", reason });
}
function sourceFailure(
  reason: "http" | "network" | "timeout" | "cancelled" | "catalog-limit",
): never {
  throw new CatalogFailure({ status: "source-unavailable", reason });
}

// Only selected GitHub fields enter the exact internal contract. Unrelated API
// fields (authors, body text, counters) are ignored, never trusted or returned.
export function projectGithubReleases(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 50)
    throw new CatalogFailure({
      status: "untrusted-metadata",
      reason: "malformed",
    });
  return value.map((release) => {
    if (!isRecord(release) || !Array.isArray(release["assets"]))
      throw new CatalogFailure({
        status: "untrusted-metadata",
        reason: "malformed",
      });
    const candidate = {
      schemaVersion: 1,
      id: release["id"],
      tag: release["tag_name"],
      url: release["html_url"],
      publishedAt: release["published_at"],
      draft: release["draft"],
      prerelease: release["prerelease"],
      assets: release["assets"].map((asset) => {
        if (!isRecord(asset)) return null;
        return {
          id: asset["id"],
          name: asset["name"],
          size: asset["size"],
          state: asset["state"],
          url: asset["browser_download_url"],
        };
      }),
    };
    const decoded = decodeUpdateRelease(candidate);
    if (!decoded.ok)
      throw new CatalogFailure({
        status: "untrusted-metadata",
        reason: "malformed",
      });
    return decoded.value;
  });
}

export function admittedNextPage(
  link: string | null,
  currentPage: number,
): string | null {
  if (link === null) return null;
  if (link.length > 8_192) return metadataFailure("pagination");
  let next: string | null = null;
  for (const part of link.split(",")) {
    const match = /^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/u.exec(
      part,
    );
    if (!match) return metadataFailure("pagination");
    let url: URL;
    try {
      url = new URL(match[1]!);
    } catch {
      return metadataFailure("pagination");
    }
    if (
      url.origin + url.pathname !== PUBLIC_RELEASES_API ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.size !== 2 ||
      url.searchParams.get("per_page") !== "50" ||
      !/^[1-9][0-9]{0,6}$/u.test(url.searchParams.get("page") ?? "")
    )
      return metadataFailure("pagination");
    if (match[2] !== "next") continue;
    if (
      next !== null ||
      url.searchParams.get("page") !== String(currentPage + 1)
    )
      return metadataFailure("pagination");
    next = `${PUBLIC_RELEASES_API}?per_page=50&page=${currentPage + 1}`;
  }
  return next;
}

async function boundedJson(
  response: Response,
  remainingBytes: number,
  signal: AbortSignal,
): Promise<{ value: unknown; bytes: number }> {
  const type = response.headers.get("content-type") ?? "";
  if (
    !/^application\/(?:json|vnd\.github\+json)(?:;\s*charset=utf-8)?$/iu.test(
      type,
    )
  ) {
    await response.body?.cancel().catch(() => {});
    return metadataFailure("content-type");
  }
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^[0-9]{1,10}$/u.test(length) || Number(length) > remainingBytes)
  ) {
    await response.body?.cancel().catch(() => {});
    return metadataFailure("response-limit");
  }
  if (!response.body) return metadataFailure("json");
  const reader = response.body.getReader();
  const cancelRead = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancelRead, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) return sourceFailure("cancelled");
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > remainingBytes) return metadataFailure("response-limit");
      chunks.push(result.value);
    }
    if (signal.aborted) return sourceFailure("cancelled");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, bytes),
    );
    return { value: JSON.parse(text), bytes };
  } catch (error) {
    if (error instanceof CatalogFailure) throw error;
    if (error instanceof SyntaxError || error instanceof TypeError)
      return metadataFailure("json");
    return sourceFailure("network");
  } finally {
    signal.removeEventListener("abort", cancelRead);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function checkPublicUpdates(options: {
  readonly currentVersion: string;
  readonly target: string;
  readonly now?: Date;
  readonly signal?: AbortSignal;
  readonly request?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<UpdateCheckResult> {
  if (options.target !== "darwin-arm64")
    return { status: "unsupported-platform" };
  const timeoutMs = options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > UPDATE_CHECK_TIMEOUT_MS
  )
    throw new Error("invalid-update-deadline");
  const controller = new AbortController();
  const request = options.request ?? fetch;
  const now = options.now ?? new Date();
  let timedOut = false;
  let cancelRequest: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    cancelRequest = () =>
      reject(
        new CatalogFailure({
          status: "source-unavailable",
          reason: "cancelled",
        }),
      );
  });
  const cancel = () => {
    controller.abort();
    cancelRequest?.();
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new CatalogFailure({ status: "source-unavailable", reason: "timeout" }),
      );
    }, timeoutMs);
  });
  async function load(): Promise<UpdateCheckResult> {
    let next: string | null = `${PUBLIC_RELEASES_API}?per_page=50&page=1`;
    let page = 0;
    let remainingBytes = UPDATE_METADATA_BYTES;
    const candidates: unknown[] = [];
    while (next !== null) {
      if (controller.signal.aborted) return sourceFailure("cancelled");
      if (++page > 2) return sourceFailure("catalog-limit");
      const response = await request(next, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "blooket-api-update-check",
        },
      });
      if (controller.signal.aborted) {
        await response.body?.cancel().catch(() => {});
        return sourceFailure("cancelled");
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        const retry = response.headers.get("retry-after");
        const retryAfterSeconds =
          retry && /^[0-9]{1,6}$/u.test(retry) && Number(retry) <= 604800
            ? Number(retry)
            : undefined;
        throw new CatalogFailure({
          status: "source-unavailable",
          reason: "http",
          httpStatus: response.status,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        });
      }
      const result = await boundedJson(
        response,
        remainingBytes,
        controller.signal,
      );
      remainingBytes -= result.bytes;
      candidates.push(...projectGithubReleases(result.value));
      next = admittedNextPage(response.headers.get("link"), page);
    }
    return selectPublicUpdate(
      candidates,
      options.currentVersion,
      options.target,
      now,
    );
  }
  try {
    return await Promise.race([load(), deadline, cancelled]);
  } catch (error) {
    if (timedOut) return { status: "source-unavailable", reason: "timeout" };
    if (options.signal?.aborted)
      return { status: "source-unavailable", reason: "cancelled" };
    if (error instanceof CatalogFailure) return error.result;
    return { status: "source-unavailable", reason: "network" };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    controller.abort();
  }
}
