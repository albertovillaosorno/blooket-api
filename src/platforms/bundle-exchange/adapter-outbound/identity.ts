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
import { basename, dirname, isAbsolute, resolve } from "node:path";

export const BUNDLE_NAME = "Blooket API.app";
export const EXCHANGE_HELPER_NAME = "bundle-exchange";
const preparedName = new RegExp("^\\.blooket-api\\.update-" +
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-" +
  "[0-9a-f]{12}$", "u");
export interface DirectoryIdentity {
  readonly device: string;
  readonly inode: string;
}
export type ExchangeOrientation = "original" | "exchanged" | "unknown";
export function identityAdmitted(value: DirectoryIdentity): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "device") || !Object.hasOwn(value, "inode"))
    return false;
  return [value.device, value.inode].every(part =>
    typeof part === "string" && /^(?:0|[1-9][0-9]{0,19})$/u.test(part) &&
      BigInt(part) <= 18_446_744_073_709_551_615n) && value.inode !== "0";
}
export function sameIdentity(left: DirectoryIdentity,
  right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}
export function pathAdmitted(path: string): boolean {
  return typeof path === "string" && path.length <= 4_096 &&
    isAbsolute(path) && resolve(path) === path &&
    !/[\x00-\x1f\x7f]/u.test(path);
}
export function locationsAdmitted(installed: string, candidate: string) {
  if (!pathAdmitted(installed) || !pathAdmitted(candidate) ||
      basename(installed) !== BUNDLE_NAME ||
      basename(candidate) !== BUNDLE_NAME) return false;
  const parent = dirname(installed), prepared = dirname(candidate);
  return parent !== "/" && dirname(prepared) === parent &&
    preparedName.test(basename(prepared));
}
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
