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
//   - Independent, verified installer program copies before bundle exchange.
// - Must-Not:
//   - Install, launch, consume secrets, or invent publisher trust.
// - Allows:
//   - Inputs: Captured installation authority and admitted Apple publisher.
//   - Outputs: Verified program copy or a bounded preparation failure.
//   - Side effects: Private program copies and owned tree permission changes.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Installer lifetime no longer crosses application replacement.
// - Summary:
//   - Independent, verified installer program copies before bundle exchange.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import { lstat, mkdir, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decodeUpdateInstallationJournal, sameIdentity,
  type DirectoryIdentity } from
  "../../../ir/application-updates/contract/installation.ts";
import { directoryIdentity } from
  "../../bundle-exchange/adapter-outbound/identity.ts";
import { executeNative, type ExchangeCommand } from
  "../../bundle-exchange/adapter-outbound/exchange.ts";
import { verifyAppleInstalledBundle, type AppleAssessmentCommand } from
  "../../update-signatures/adapter-outbound/apple.ts";
import { validateAndFreezeTree, syncDirectory,
  removeCreatedStage } from "./files.ts";
import { inspectInstallerProgramLayout } from "./installer-layout.ts";

export interface InstallerProgramCopyOptions {
  readonly authority: unknown;
  readonly publisherTeamId: string;
  readonly signal?: AbortSignal;
  // Local composition/test dependencies only. No HTTP or MCP arguments.
  readonly host?: { readonly platform: string; readonly architecture: string };
  readonly assess?: AppleAssessmentCommand;
  readonly copy?: ExchangeCommand;
  readonly availableBytes?: (directory: string) => Promise<bigint>;
  readonly timeoutMs?: number;
}
type CopyFailure = "authority" | "unsupported-host" | "storage" | "identity"
  | "source-bundle" | "layout" | "space" | "copy" | "bytes"
  | "copied-bundle" | "cancelled" | "timeout" | "cleanup";
export type InstallerProgramCopyResult =
  | { readonly status: "prepared"; readonly bundlePath: string;
      readonly identity: DirectoryIdentity; readonly version: string }
  | { readonly status: "preparation-failed"; readonly reason: CopyFailure };

// The independent installer must run from this copy, not either app directory
// that exchange can move. This function neither launches nor replaces apps.
export async function prepareInstallerProgramCopy(
  options: InstallerProgramCopyOptions,
): Promise<InstallerProgramCopyResult> {
  const decoded = decodeUpdateInstallationJournal(options.authority);
  const fail = (reason: CopyFailure): InstallerProgramCopyResult =>
    ({ status: "preparation-failed", reason });
  if (!decoded.ok || decoded.value.phase !== "prepared")
    return fail("authority");
  const authority = decoded.value;
  const host = options.host ?? { platform: process.platform,
    architecture: process.arch };
  if (host.platform !== "darwin" || host.architecture !== "arm64")
    return fail("unsupported-host");
  const timeout = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000)
    throw Error("invalid-installer-copy-timeout");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeout);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const parent = dirname(authority.candidatePath);
  const directory = join(parent, "installer");
  const bundlePath = join(directory, "Blooket API.app");
  let created = false, completed = false;
  let createdIdentity: DirectoryIdentity | undefined;
  let parentIdentity: DirectoryIdentity | undefined;
  let reason: CopyFailure = "storage";
  try {
    signal.throwIfAborted();
    parentIdentity = await directoryIdentity(parent);
    const ownedParent = parentIdentity;
    const info = await lstat(parent);
    if ((info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid())) return fail(reason);
    const unchanged = async () =>
      sameIdentity(ownedParent, await directoryIdentity(parent)) &&
      sameIdentity(authority.installedIdentity,
        await directoryIdentity(authority.installedPath)) &&
      sameIdentity(authority.candidateIdentity,
        await directoryIdentity(authority.candidatePath));
    if (!await unchanged()) return fail("identity");
    const assess = (path: string) => verifyAppleInstalledBundle({
      bundlePath: path, version: authority.installedVersion,
      publisherTeamId: options.publisherTeamId, host, signal,
      ...(options.assess ? { execute: options.assess } : {}),
    });
    reason = "source-bundle";
    if ((await assess(authority.installedPath)).status !== "verified") {
      signal.throwIfAborted();
      return fail(reason);
    }
    reason = "layout";
    const layout = await inspectInstallerProgramLayout(
      authority.installedPath, signal);
    reason = "space";
    const available = options.availableBytes
      ? await options.availableBytes(parent)
      : await statfs(parent, { bigint: true }).then(s => s.bavail * s.bsize);
    if (available < BigInt(layout.expandedBytes) + 268_435_456n)
      return fail(reason);
    reason = "storage";
    signal.throwIfAborted();
    if (!await unchanged()) return fail("identity");
    // Exclusive creation preserves prior copies and prevents merging into an
    // existing program. Never clean a discovered or caller-selected folder.
    await mkdir(directory, { mode: 0o700 });
    created = true;
    createdIdentity = await directoryIdentity(directory);
    reason = "copy";
    // Preserve native bundle metadata. The silent process settles only after
    // its actual writer closes, including cancellation or timeout.
    await (options.copy ?? executeNative)("/usr/bin/ditto",
      ["--rsrc", "--extattr", "--acl", authority.installedPath, bundlePath],
      signal);
    signal.throwIfAborted();
    reason = "bytes";
    await validateAndFreezeTree(directory, layout, signal);
    reason = "copied-bundle";
    if ((await assess(bundlePath)).status !== "verified") {
      signal.throwIfAborted();
      return fail(reason);
    }
    reason = "identity";
    if (!await unchanged()) return fail(reason);
    const identity = await directoryIdentity(bundlePath);
    if (sameIdentity(identity, authority.installedIdentity) ||
        sameIdentity(identity, authority.candidateIdentity))
      return fail(reason);
    await syncDirectory(parent);
    signal.throwIfAborted();
    completed = true;
    return { status: "prepared", bundlePath, identity,
      version: authority.installedVersion };
  } catch {
    return fail(options.signal?.aborted ? "cancelled"
      : deadline.signal.aborted ? "timeout" : reason);
  } finally {
    clearTimeout(timer);
    if (created && !completed) {
      try {
        if (!parentIdentity || !createdIdentity ||
            !sameIdentity(parentIdentity, await directoryIdentity(parent)) ||
            !sameIdentity(createdIdentity, await directoryIdentity(directory)))
          return fail("cleanup");
        await removeCreatedStage(directory);
        await syncDirectory(parent);
      }
      catch { return fail("cleanup"); }
    }
  }
}
