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
//   - Bounded retrieval and authentication of signed release metadata.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Selected Mac release, local publisher keys, and cancellation.
//   - Outputs: Authenticated metadata or an explicit bounded failure.
//   - Side effects: Anonymous HTTPS with restricted redirects and
//     owned response cancellation.
// - Split-When:
//   - Bundle replacement gains a separate transactional authority.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Loads the fixed signed manifest before any archive staging.
// - Description:
//   - Authenticates bounded signed JSON against the selected release.
// - Usage:
//   - Fetch only the selected tag and verify against local publisher keys.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import {
  verifySignedUpdateManifest,
  publisherFingerprint,
  type ManifestVerification,
} from "../../update-signatures/adapter-outbound/verify.ts";
import { decodeProductVersion } from
  "../../../ir/product-version/contract/version.ts";
import { MAX_UPDATE_ARCHIVE_BYTES, releaseAssetUrl } from
  "../../../ir/application-updates/contract/releases.ts";
import { abortable, downloadResponse } from "./response.ts";
import type { UpdateArchiveFetch } from "./download.ts";

export const UPDATE_MANIFEST_ASSET = "update-manifest.json";
export const UPDATE_MANIFEST_BYTES = 1_000_000;
export const UPDATE_MANIFEST_TIMEOUT_MS = 10_000;
type VerificationOptions = Parameters<typeof verifySignedUpdateManifest>[0];
export type UpdateManifestFetchResult =
  | { readonly status: "verified";
      readonly document: unknown;
      readonly verification: Extract<ManifestVerification, { ok: true }> }
  | { readonly status: "verification-failed";
      readonly reason: Extract<ManifestVerification, { ok: false }>["reason"] }
  | { readonly status: "manifest-failed";
      readonly reason: "http" | "redirect" | "network"
        | "timeout" | "cancelled" | "response-limit" | "json" };

// The caller supplies a selected public release, never a remote download URL.
// Keys are application-owned trust roots; downloaded metadata cannot add keys.
export async function fetchSignedUpdateManifest(options: {
  readonly release: VerificationOptions["release"];
  readonly trustedKeys: VerificationOptions["trustedKeys"];
  readonly signal?: AbortSignal;
  readonly fetch?: UpdateArchiveFetch;
  readonly timeoutMs?: number;
}): Promise<UpdateManifestFetchResult> {
  const release = options.release;
  try {
    decodeProductVersion(release.version);
    if (release.tag !== "v" + release.version ||
        release.target !== "darwin-arm64" ||
        release.asset.name !== "darwin-arm64.zip" ||
        release.asset.url !==
          releaseAssetUrl(release.tag, release.asset.name) ||
        !Number.isSafeInteger(release.asset.size) || release.asset.size < 1 ||
        release.asset.size > MAX_UPDATE_ARCHIVE_BYTES)
      throw new Error("release-mismatch");
  } catch {
    return { status: "verification-failed", reason: "release-mismatch" };
  }
  if (options.trustedKeys.length < 1 || options.trustedKeys.length > 8 ||
      !options.trustedKeys.some(key => {
        try { publisherFingerprint(key); return true; }
        catch { return false; }
      }))
    return { status: "verification-failed", reason: "unknown-publisher" };
  const timeout = options.timeoutMs ?? UPDATE_MANIFEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 ||
      timeout > UPDATE_MANIFEST_TIMEOUT_MS)
    throw new Error("invalid-update-manifest-timeout");
  if (options.signal?.aborted)
    return { status: "manifest-failed", reason: "cancelled" };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    response = await downloadResponse(
      releaseAssetUrl(release.tag, UPDATE_MANIFEST_ASSET),
      options.fetch ?? fetch, controller.signal,
    );
    const length = response.headers.get("content-length");
    if (length !== null && (!/^[0-9]{1,10}$/u.test(length) ||
        Number(length) > UPDATE_MANIFEST_BYTES))
      throw new Error("response-limit");
    if (!response.body) throw new Error("json");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const chunk = await abortable(reader.read(), controller.signal);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > UPDATE_MANIFEST_BYTES) throw new Error("response-limit");
      chunks.push(chunk.value);
    }
    if (controller.signal.aborted) throw new Error("cancelled");
    let document: unknown;
    try {
      document = JSON.parse(new TextDecoder("utf-8", { fatal: true })
        .decode(Buffer.concat(chunks, total)));
    } catch { throw new Error("json"); }
    const verified = verifySignedUpdateManifest({
      document, release, trustedKeys: options.trustedKeys,
    });
    return verified.ok
      ? { status: "verified", document, verification: verified }
      : { status: "verification-failed", reason: verified.reason };
  } catch (error) {
    if (controller.signal.aborted)
      return { status: "manifest-failed",
        reason: timedOut ? "timeout" : "cancelled" };
    const reason = error instanceof Error ? error.message : "network";
    return { status: "manifest-failed",
      reason: reason === "http" || reason === "redirect" ||
        reason === "response-limit" || reason === "json" ? reason : "network" };
  } finally {
    controller.abort();
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    if (reader) void reader.cancel().catch(() => undefined);
    else void response?.body?.cancel().catch(() => undefined);
  }
}
