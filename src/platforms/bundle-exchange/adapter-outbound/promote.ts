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
//   - Silent no-replace promotion from an owned extraction wrapper.
// - Must-Not:
//   - Replace the installed app, grant trust, delete candidates, or retry.
// - Allows:
//   - Inputs: Trusted sibling/stage locations and captured directory identity.
//   - Outputs: Fresh durable placement or bounded failure.
//   - Side effects: One native exclusive rename and directory synchronization.
// - Split-When:
//   - Installation exchange needs a separate journaled lifecycle.
// - Merge-When:
//   - Node offers an atomic directory rename that refuses existing targets.
// - Summary:
//   - Never overwrites a competing destination, including an empty directory.
// - Description:
//   - Lost acknowledgment is observed after writer closure, never replayed.
// - Usage:
//   - Promote only a completed trusted extraction before installation intent.
// - Defaults:
//   - Unsupported hosts and unknown filesystem state preserve both paths.
//
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeNative, type ExchangeCommand } from "./exchange.ts";
import { BUNDLE_NAME, EXCHANGE_HELPER_NAME, directoryIdentity,
  identityAdmitted, pathAdmitted, sameIdentity, type DirectoryIdentity } from
  "./identity.ts";
import { syncDirectory } from
  "../../update-extraction/adapter-outbound/files.ts";

export interface BundlePromotionOptions {
  readonly sourcePath: string;
  readonly candidatePath: string;
  readonly sourceIdentity: DirectoryIdentity;
  readonly helperPath?: string;
  readonly host?: { readonly platform: string; readonly architecture: string };
  readonly execute?: ExchangeCommand;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export type BundlePromotionResult =
  | { readonly status: "promoted"; readonly durable: true }
  | { readonly status: "promotion-failed"; readonly reason:
      "unsupported-host" | "locations" | "identity" | "helper" | "storage"
      | "candidate-exists" | "native" | "cancelled" | "timeout" };
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-" +
  "[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const prepared = new RegExp("^\\.blooket-api\\.update-" + uuid + "$", "u");
const stage = new RegExp("^stage-" + uuid + "$", "u");
const missing = (error: unknown) => error instanceof Error &&
  "code" in error && error.code === "ENOENT";

export async function promotePreparedBundle(options: BundlePromotionOptions):
  Promise<BundlePromotionResult> {
  const fail = (reason: Extract<BundlePromotionResult,
    { status: "promotion-failed" }>["reason"]): BundlePromotionResult =>
    ({ status: "promotion-failed", reason });
  const host = options.host ?? { platform: process.platform,
    architecture: process.arch };
  if (host.platform !== "darwin" || host.architecture !== "arm64")
    return fail("unsupported-host");
  const source = options.sourcePath, candidate = options.candidatePath;
  const left = dirname(source), right = dirname(candidate);
  if (!pathAdmitted(source) || !pathAdmitted(candidate) ||
      basename(source) !== BUNDLE_NAME || basename(candidate) !== BUNDLE_NAME ||
      !prepared.test(basename(right)) || basename(left) !== "unpacked" ||
      !stage.test(basename(dirname(left))) ||
      dirname(dirname(left)) !== right ||
      candidate !== join(right, BUNDLE_NAME))
    return fail("locations");
  if (!identityAdmitted(options.sourceIdentity)) return fail("identity");
  const expected = { ...options.sourceIdentity };
  const helper = options.helperPath ?? fileURLToPath(new URL(
    "../../../../../runtime/" + EXCHANGE_HELPER_NAME, import.meta.url));
  if (!pathAdmitted(helper) || basename(helper) !== EXCHANGE_HELPER_NAME)
    return fail("helper");
  let parents: DirectoryIdentity[];
  let sourceMode: number;
  try {
    parents = await Promise.all([directoryIdentity(left),
      directoryIdentity(right)]);
    if (parents.some(p => p.device !== expected.device) ||
        !sameIdentity(expected, await directoryIdentity(source)))
      return fail("identity");
    sourceMode = (await lstat(source)).mode & 0o777;
    for (const path of [left, right]) {
      const info = await lstat(path);
      if ((info.mode & 0o077) !== 0 ||
          (process.getuid && info.uid !== process.getuid()))
        return fail("storage");
    }
    try { await lstat(candidate); return fail("candidate-exists"); }
    catch (error) { if (!missing(error)) return fail("storage"); }
    const binary = await lstat(helper);
    if (!binary.isFile() || (binary.mode & 0o111) === 0 ||
        (binary.mode & 0o022) !== 0 || await realpath(helper) !== helper ||
        (process.getuid && binary.uid !== 0 && binary.uid !== process.getuid()))
      return fail("helper");
  } catch { return fail("storage"); }
  const timeout = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000)
    throw new Error("invalid-promotion-timeout");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeout);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const interruption = () => options.signal?.aborted ? "cancelled" as const
    : deadline.signal.aborted ? "timeout" as const : undefined;
  try {
    if (signal.aborted) return fail("cancelled");
    try {
      await (options.execute ?? executeNative)(helper, ["--prepare", left,
        right, expected.device, expected.inode, parents[0]!.device,
        parents[0]!.inode, parents[1]!.device, parents[1]!.inode], signal);
    } catch { /* Observe only after the owned native writer has stopped. */ }
    try { await lstat(source); return fail(interruption() ?? "native"); }
    catch (error) { if (!missing(error)) return fail("storage"); }
    if (!sameIdentity(expected, await directoryIdentity(candidate)) ||
        ((await lstat(candidate)).mode & 0o777) !== sourceMode ||
        !sameIdentity(parents[0]!, await directoryIdentity(left)) ||
        !sameIdentity(parents[1]!, await directoryIdentity(right)))
      return fail("identity");
    await syncDirectory(left);
    await syncDirectory(right);
    if (signal.aborted) return fail(options.signal?.aborted
      ? "cancelled" : "timeout");
    return { status: "promoted", durable: true };
  } catch { return fail("storage"); }
  finally { clearTimeout(timer); }
}
