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
//   - Private authenticated native ZIP staging and cancellation ownership.
// - Must-Not:
//   - Install, launch, consume secrets, or infer Apple trust.
// - Allows:
//   - Inputs: Authenticated archive facts and trusted local staging authority.
//   - Outputs: Bounded staging results still requiring Apple assessment.
//   - Side effects: Owned staging files and bounded silent native extraction.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Native extraction no longer needs independent physical validation.
// - Summary:
//   - Private authenticated native ZIP staging and cancellation ownership.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rm, statfs } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { verifySignedUpdateManifest } from
  "../../update-signatures/adapter-outbound/verify.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";
import { abortable } from "../../update-downloads/adapter-outbound/response.ts";
import { BUNDLE_ROOT } from "./layout.ts";
import { inspectUpdateArchive } from "./inspect.ts";
import { snapshotArchive, validateAndFreezeTree, syncDirectory,
  removeCreatedStage } from "./files.ts";

export type ArchiveExtractionCommand = (executable: string,
  args: readonly string[], signal: AbortSignal) => Promise<void>;
export interface UpdateExtractionOptions {
  readonly directory: string;
  readonly archivePath: string;
  readonly verification: Parameters<typeof verifySignedUpdateManifest>[0];
  readonly signal?: AbortSignal;
  readonly host?: { readonly platform: string; readonly architecture: string };
  readonly execute?: ArchiveExtractionCommand;
  readonly availableBytes?: (directory: string) => Promise<bigint>;
  readonly timeoutMs?: number;
}
type FailureReason = "manifest" | "unsupported-host" | "storage" | "busy"
  | "space" | "archive-bytes" | "archive-layout" | "archive-limit"
  | "native-extraction" | "extracted-layout" | "extracted-bytes"
  | "timeout" | "cancelled" | "cleanup";
export type UpdateExtractionResult =
  | { readonly status: "staged"; readonly stageId: string;
      readonly bundlePath: string; readonly version: string;
      readonly requiresAppleVerification: true }
  | { readonly status: "extraction-failed"; readonly reason: FailureReason;
      readonly retainedStageId?: string };

function ownedPath(path: string) {
  return typeof path === "string" && isAbsolute(path) &&
    path.length <= 4_096 && resolve(path) === path &&
    !/[\x00-\x1f\x7f]/u.test(path);
}
const availableSpace = async (directory: string) => {
  const information = await statfs(directory, { bigint: true });
  return information.bavail * information.bsize;
};
const RESERVE_BYTES = 268_435_456n;

export async function stageSignedUpdate(options: UpdateExtractionOptions):
  Promise<UpdateExtractionResult> {
  const fail = (reason: FailureReason, retainedStageId?: string):
    UpdateExtractionResult => ({ status: "extraction-failed", reason,
      ...(retainedStageId ? { retainedStageId } : {}) });
  const verified = verifySignedUpdateManifest(options.verification);
  if (!verified.ok) return fail("manifest");
  const host = options.host ?? { platform: process.platform,
    architecture: process.arch };
  if (host.platform !== "darwin" || host.architecture !== "arm64")
    return fail("unsupported-host");
  if (!ownedPath(options.directory) || !ownedPath(options.archivePath) ||
      basename(options.archivePath) !== "darwin-arm64.zip")
    return fail("storage");
  const timeout = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000)
    throw new Error("invalid-update-extraction-timeout");
  if (options.signal?.aborted) return fail("cancelled");
  try {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(options.directory);
    if (await realpath(options.directory) !== options.directory ||
        !info.isDirectory() || (info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid()) ||
        await realpath(options.archivePath) !== options.archivePath ||
        !(await lstat(options.archivePath)).isFile()) return fail("storage");
  } catch { return fail("storage"); }
  const acquired = await tryAcquireFileLock(join(options.directory,
    ".extract.lock"));
  if (!acquired.ok)
    return fail(acquired.reason === "busy" ? "busy" : "storage");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeout);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const space = options.availableBytes ?? availableSpace;
  const stageId = randomUUID();
  const stage = join(options.directory, "stage-" + stageId);
  let created = false, published = false, deferred = false;
  let native: Promise<void> | undefined;
  let nativeSettled = true;
  let phase: FailureReason = "storage";
  async function cleanup() {
    if (created && !published) {
      await removeCreatedStage(stage);
      await syncDirectory(options.directory);
    }
  }
  try {
    if (await space(options.directory) <
        BigInt(verified.asset.size) + RESERVE_BYTES) return fail("space");
    signal.throwIfAborted();
    await mkdir(stage, { mode: 0o700 });
    created = true;
    const ownership = await open(join(stage, ".owner.json"), "wx", 0o600);
    try {
      await ownership.writeFile(JSON.stringify({ schemaVersion: 1, stageId,
        pid: process.pid, version: verified.manifest.version,
        archiveHash: verified.asset.sha256 }) + "\n");
      await ownership.sync();
    } finally { await ownership.close(); }
    await syncDirectory(stage);
    const snapshot = join(stage, "darwin-arm64.zip");
    phase = "archive-bytes";
    await snapshotArchive(options.archivePath, snapshot,
      verified.asset, signal);
    phase = "archive-layout";
    const layout = await inspectUpdateArchive(snapshot, signal);
    phase = "storage";
    if (await space(options.directory) <
        BigInt(layout.expandedBytes) + RESERVE_BYTES) return fail("space");
    const unpacked = join(stage, "unpacked");
    await mkdir(unpacked, { mode: 0o700 });
    phase = "native-extraction";
    nativeSettled = false;
    native = Promise.resolve().then(() =>
      (options.execute ?? extractNative)("/usr/bin/ditto",
        ["-x", "-k", snapshot, unpacked], signal));
    void native.then(() => { nativeSettled = true; },
      () => { nativeSettled = true; });
    await abortable(native, signal);
    signal.throwIfAborted();
    phase = "extracted-layout";
    await validateAndFreezeTree(unpacked, layout, signal);
    phase = "storage";
    await rm(snapshot);
    await syncDirectory(stage);
    await syncDirectory(options.directory);
    signal.throwIfAborted();
    published = true;
    return { status: "staged", stageId, version: verified.manifest.version,
      bundlePath: join(unpacked, BUNDLE_ROOT),
      requiresAppleVerification: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : phase;
    const reason = signal.aborted
      ? options.signal?.aborted ? "cancelled" : "timeout"
      : (["archive-limit", "archive-bytes", "archive-layout",
        "extracted-bytes", "extracted-layout"].includes(message)
        ? message as FailureReason : phase);
    return fail(reason, native && !nativeSettled ? stageId : undefined);
  } finally {
    clearTimeout(timer);
    if (native && !nativeSettled) {
      // A late trusted-port writer retains exclusive ownership until it stops.
      // Keep its directory and lock while it may still write.
      deferred = true;
      void native.catch(() => {}).then(async () => {
        try { await cleanup(); }
        finally { await acquired.lock.release(); }
      }).catch(() => {});
    }
    if (!deferred) {
      let failed = false;
      try { await cleanup(); } catch { failed = true; }
      try { await acquired.lock.release(); } catch { failed = true; }
      if (failed) return fail("cleanup", created ? stageId : undefined);
    }
  }
}

// Direct silent process creation; resolve only once the owned child closes.
// Killing on abort is not proof that an extraction writer has already exited.
function extractNative(file: string, args: readonly string[],
  signal: AbortSignal): Promise<void> {
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) { reject(new Error("cancelled")); return; }
    const child = spawn(file, [...args], { shell: false, stdio: "ignore",
      env: { HOME: process.env["HOME"], PATH: "/usr/bin:/bin", LC_ALL: "C" } });
    let failed = false;
    const cancel = () => { child.kill("SIGKILL"); };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    child.once("error", () => { failed = true; });
    child.once("close", code => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted || failed || code !== 0)
        reject(new Error(signal.aborted ? "cancelled" : "native-extraction"));
      else resolveResult();
    });
  });
}
