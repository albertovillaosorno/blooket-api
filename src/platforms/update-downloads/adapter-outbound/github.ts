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
//   - Bounded personal GitHub release archive staging using GitHub SHA-256.
// - Must-Not:
//   - Install a package, trust foreign URLs, or modify application data.
// - Allows:
//   - Inputs: Admitted public release metadata with exact GitHub digest.
//   - Outputs: Verified archive in a new privately owned staging directory.
//   - Side effects: Anonymous GET and exclusive disposable filesystem work.
// - Split-When:
//   - Native Linux installation/restart owns separate transactional exchange.
// - Merge-When:
//   - Public and signed artifact bytes share staging implementations.
// - Summary:
//   - Downloads only byte-identical GitHub release assets for personal use.
// - Description:
//   - Validates target, digest, redirect, length and checksum before publish.
// - Usage:
//   - Call only after selecting a final release from the fixed repository.
// - Defaults:
//   - Missing SHA, mismatched bytes, cancellation and redirects fail closed.
//
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { releaseAssetUrl, releasePageUrl, MAX_UPDATE_ARCHIVE_BYTES } from
  "../../../ir/application-updates/contract/releases.ts";
import { LINUX_UPDATE_ARCHIVE, MAC_UPDATE_ARCHIVE } from
  "../../../ir/application-updates/domain/select.ts";
import type { UpdateSelection } from
  "../../../ir/application-updates/domain/select.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";
import { abortable, downloadResponse } from "./response.ts";
import type { UpdateArchiveFetch } from "./download.ts";

export type GithubDownloadResult =
  | { readonly status: "downloaded"; readonly archivePath: string;
      readonly version: string; readonly digest: string }
  | { readonly status: "verification-failed";
      readonly reason: "missing-digest" | "size-mismatch" | "hash-mismatch"
        | "release-mismatch" }
  | { readonly status: "download-failed";
      readonly reason: "cancelled" | "timeout" | "http" | "redirect"
        | "storage" | "busy" | "unavailable" | "cleanup" };

// This does not identify a publisher separately from the fixed GitHub repo.
// HTTPS plus GitHub's upload-time digest protect transport integrity; they do
// not prove that a compromised maintainer account published trustworthy code.
export async function downloadGithubAsset(options: {
  readonly directory: string;
  readonly selection: Extract<UpdateSelection, { status: "available" }>;
  readonly target: "darwin-arm64" | "linux-x64";
  readonly fetch?: UpdateArchiveFetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<GithubDownloadResult> {
  const selected = options.selection;
  const asset = selected.asset;
  const archive = options.target === "linux-x64"
    ? LINUX_UPDATE_ARCHIVE : MAC_UPDATE_ARCHIVE;
  if (selected.tag !== "v" + selected.version ||
      selected.releaseUrl !== releasePageUrl(selected.tag) ||
      asset.name !== archive ||
      asset.url !== releaseAssetUrl(selected.tag, archive) ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 ||
      asset.size > MAX_UPDATE_ARCHIVE_BYTES)
    return { status: "verification-failed", reason: "release-mismatch" };
  if (!/^sha256:[0-9a-f]{64}$/u.test(asset.digest ?? ""))
    return { status: "verification-failed", reason: "missing-digest" };
  const deadline = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 120_000)
    throw new Error("invalid-github-update-timeout");
  if (options.signal?.aborted)
    return { status: "download-failed", reason: "cancelled" };
  const acquired = await tryAcquireFileLock(join(options.directory,
    ".github-download.lock"));
  if (!acquired.ok)
    return { status: "download-failed",
      reason: acquired.reason === "busy" ? "busy" : "storage" };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadline);
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  let temporary: string | undefined;
  let published = false;
  try {
    if (options.signal?.aborted) throw new Error("cancelled");
    const response = await downloadResponse(
      asset.url, options.fetch ?? fetch, controller.signal,
    );
    const header = response.headers.get("content-length");
    if (header !== null && (!/^[0-9]{1,12}$/u.test(header) ||
        Number(header) !== asset.size)) throw new Error("size-mismatch");
    if (!response.body) throw new Error("size-mismatch");
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    temporary = await mkdtemp(join(options.directory, "github-"));
    const partial = join(temporary, archive + ".partial");
    const destination = join(temporary, archive);
    const file = await open(partial, "wx", 0o600);
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let total = 0;
    try {
      while (true) {
        const chunk = await abortable(reader.read(), controller.signal);
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > asset.size) throw new Error("size-mismatch");
        hash.update(chunk.value);
        await file.writeFile(chunk.value);
      }
      if (total !== asset.size) throw new Error("size-mismatch");
      if ("sha256:" + hash.digest("hex") !== asset.digest)
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
    return { status: "downloaded", archivePath: destination,
      version: selected.version, digest: asset.digest };
  } catch (error) {
    if (controller.signal.aborted)
      return { status: "download-failed",
        reason: timedOut ? "timeout" : "cancelled" };
    const code = error instanceof Error ? error.message : "unavailable";
    if (code === "size-mismatch" || code === "hash-mismatch")
      return { status: "verification-failed", reason: code };
    return { status: "download-failed", reason:
      code === "http" || code === "redirect" ? code
        : error instanceof Error && "code" in error ? "storage"
          : "unavailable" };
  } finally {
    controller.abort();
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    let cleanupFailed = false;
    try {
      if (temporary && !published)
        await rm(temporary, { recursive: true, force: true });
    } catch { cleanupFailed = true; }
    try { await acquired.lock.release(); }
    catch { cleanupFailed = true; }
    if (cleanupFailed)
      return { status: "download-failed", reason: "cleanup" };
  }
}
