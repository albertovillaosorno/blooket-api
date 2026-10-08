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
//   - Guarded silent atomic exchange of two admitted application directories.
// - Must-Not:
//   - Choose update policy, verify publishers, remove apps, or open Terminal.
// - Allows:
//   - Inputs: Trusted local paths and exact expected filesystem identities.
//   - Outputs: Observed exchange orientation or bounded failure reasons.
//   - Side effects: Native atomic directory exchange and directory syncs.
// - Split-When:
//   - Update orchestration needs semantic journal/restart authority.
// - Merge-When:
//   - Node exposes the required atomic exchange syscall directly.
// - Summary:
//   - Retains both applications and inspects outcomes after native completion.
// - Description:
//   - An uncertain process result cannot authorize a blind second exchange.
// - Usage:
//   - Hold the installation lock and quiesce writers in trusted composition.
// - Defaults:
//   - Unsupported hosts and changed identities never invoke exchange.
//
import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncDirectory } from
  "../../update-extraction/adapter-outbound/files.ts";
import { EXCHANGE_HELPER_NAME, directoryIdentity, identityAdmitted,
  locationsAdmitted, pathAdmitted, sameIdentity, observeExchange,
  type DirectoryIdentity, type ExchangeOrientation } from "./identity.ts";

export type ExchangeCommand = (executable: string, args: readonly string[],
  signal: AbortSignal) => Promise<void>;
export interface BundleExchangeOptions {
  readonly installedPath: string;
  readonly candidatePath: string;
  readonly installedIdentity: DirectoryIdentity;
  readonly candidateIdentity: DirectoryIdentity;
  readonly signal?: AbortSignal;
  // Local composition/test authority only; never HTTP or MCP arguments.
  readonly helperPath?: string;
  readonly host?: { readonly platform: string; readonly architecture: string };
  readonly execute?: ExchangeCommand;
  readonly timeoutMs?: number;
}
type ExchangeReason = "unsupported-host" | "locations" | "identity"
  | "storage" | "helper" | "native" | "sync" | "cancelled" | "timeout";
export type BundleExchangeResult =
  | { readonly status: "exchanged"; readonly orientation: "exchanged";
      readonly durable: true }
  | { readonly status: "exchange-failed"; readonly reason: ExchangeReason;
      readonly orientation: ExchangeOrientation };

export async function exchangeBundles(options: BundleExchangeOptions):
  Promise<BundleExchangeResult> {
  let orientation: ExchangeOrientation = "unknown";
  const fail = (reason: ExchangeReason): BundleExchangeResult =>
    ({ status: "exchange-failed", reason, orientation });
  const host = options.host ?? { platform: process.platform,
    architecture: process.arch };
  if (host.platform !== "darwin" || host.architecture !== "arm64")
    return fail("unsupported-host");
  if (!locationsAdmitted(options.installedPath, options.candidatePath))
    return fail("locations");
  if (!identityAdmitted(options.installedIdentity) ||
      !identityAdmitted(options.candidateIdentity) ||
      sameIdentity(options.installedIdentity, options.candidateIdentity) ||
      options.installedIdentity.device !== options.candidateIdentity.device)
    return fail("identity");
  const timeout = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000)
    throw new Error("invalid-bundle-exchange-timeout");
  if (options.signal?.aborted) return fail("cancelled");
  const helper = options.helperPath ?? fileURLToPath(new URL(
    "../../../../../runtime/" + EXCHANGE_HELPER_NAME, import.meta.url));
  if (!pathAdmitted(helper) || basename(helper) !== EXCHANGE_HELPER_NAME)
    return fail("helper");
  const installedParent = dirname(options.installedPath);
  const candidateParent = dirname(options.candidatePath);
  let parents: DirectoryIdentity[];
  try {
    parents = await Promise.all([directoryIdentity(installedParent),
      directoryIdentity(candidateParent)]);
    const privateParent = await lstat(candidateParent);
    if ((privateParent.mode & 0o077) !== 0 ||
        (process.getuid && privateParent.uid !== process.getuid()))
      return fail("storage");
    if (parents.some(parent => parent.device !==
        options.installedIdentity.device)) return fail("identity");
    const binary = await lstat(helper);
    if (!binary.isFile() || (binary.mode & 0o111) === 0 ||
        (binary.mode & 0o022) !== 0 || await realpath(helper) !== helper ||
        (process.getuid && binary.uid !== 0 && binary.uid !== process.getuid()))
      return fail("helper");
  } catch { return fail("storage"); }
  orientation = await observeExchange(options);
  if (orientation !== "original") return fail("identity");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeout);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  let nativeFailed = false, synced = false;
  try {
    if (signal.aborted) return fail("cancelled");
    try {
      await (options.execute ?? executeNative)(helper, [installedParent,
        candidateParent, options.installedIdentity.device,
        options.installedIdentity.inode, options.candidateIdentity.device,
        options.candidateIdentity.inode, parents[0]!.device, parents[0]!.inode,
        parents[1]!.device, parents[1]!.inode], signal);
    } catch { nativeFailed = true; }
    // The native writer must be stopped before ownership can be observed.
    // Cancellation is never proof that an atomic exchange did not occur.
    orientation = await observeExchange(options);
    if (orientation === "exchanged") {
      try {
        await syncDirectory(installedParent);
        await syncDirectory(candidateParent);
        synced = true;
      } catch { return fail("sync"); }
    }
    if (signal.aborted)
      return fail(options.signal?.aborted ? "cancelled" : "timeout");
    if (nativeFailed || orientation !== "exchanged") return fail("native");
    if (!synced) return fail("sync");
    return { status: "exchanged", orientation, durable: true };
  } finally { clearTimeout(timer); }
}

// Promise settlement confirms that the owned writer has actually closed.
// Caller-held installation ownership must last until this promise settles.
function executeNative(file: string, args: readonly string[],
  signal: AbortSignal): Promise<void> {
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) { reject(new Error("cancelled")); return; }
    const child = spawn(file, [...args], { shell: false, stdio: "ignore",
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
    const cancel = () => { child.kill("SIGKILL"); };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    let failed = false;
    child.once("error", () => { failed = true; });
    child.once("close", code => {
      signal.removeEventListener("abort", cancel);
      if (failed || code !== 0 || signal.aborted)
        reject(new Error("native-exchange-failed"));
      else resolveResult();
    });
  });
}
