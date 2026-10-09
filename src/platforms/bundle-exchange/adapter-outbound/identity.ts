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
import { lstat, realpath } from "node:fs/promises";
import { BUNDLE_NAME, identityAdmitted, sameIdentity, pathAdmitted,
  locationsAdmitted, type DirectoryIdentity, type ExchangeOrientation } from
  "../../../ir/application-updates/contract/installation.ts";
export { BUNDLE_NAME, identityAdmitted, sameIdentity, pathAdmitted,
  locationsAdmitted, type DirectoryIdentity, type ExchangeOrientation };
export const EXCHANGE_HELPER_NAME = "bundle-exchange";
export async function directoryIdentity(path: string):
  Promise<DirectoryIdentity> {
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory() || await realpath(path) !== path)
    throw new Error("invalid-exchange-directory");
  return { device: info.dev.toString(), inode: info.ino.toString() };
}
export async function observeExchange(options: {
  readonly installedPath: string;
  readonly candidatePath: string;
  readonly installedIdentity: DirectoryIdentity;
  readonly candidateIdentity: DirectoryIdentity;
}): Promise<ExchangeOrientation> {
  try {
    const [installed, candidate] = await Promise.all([
      directoryIdentity(options.installedPath),
      directoryIdentity(options.candidatePath),
    ]);
    if (sameIdentity(installed, options.installedIdentity) &&
        sameIdentity(candidate, options.candidateIdentity)) return "original";
    if (sameIdentity(installed, options.candidateIdentity) &&
        sameIdentity(candidate, options.installedIdentity)) return "exchanged";
  } catch {
    // Missing, symbolic or replaced directories are not ownership proof.
  }
  return "unknown";
}
