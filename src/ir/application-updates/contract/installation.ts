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
//   - Exact local installation facts and admitted journal transitions.
// - Must-Not:
//   - Grant publisher trust, inspect files, launch apps, or install bundles.
// - Allows:
//   - Inputs: Unknown journal records and caller-selected next phases.
//   - Outputs: Exact decoded facts or bounded validation failures.
//   - Side effects: None.
// - Split-When:
//   - Another installation target needs a distinct persistence contract.
// - Merge-When:
//   - Installation facts no longer need durable recovery.
// - Summary:
//   - Records intent and observation without inferring installed health.
// - Description:
//   - Paths and signed envelopes cannot grant filesystem or trust authority.
// - Usage:
//   - Reassess local publisher trust, ownership, and health before any action.
// - Defaults:
//   - Invalid or contradictory records cannot authorize recovery.
//
import { posix } from "node:path";
import { compareProductVersions, decodeProductVersion } from
  "../../product-version/contract/version.ts";
import { isRecord, unknownFieldIssues } from
  "../../runtime-decoding/domain/exact-object.ts";
import { decodeFailure, type DecodeResult } from
  "../../runtime-decoding/domain/decode-result.ts";
import { decodeSignedUpdateManifest, type SignedUpdateManifest } from
  "../../update-manifests/contract/manifest.ts";

export const BUNDLE_NAME = "Blooket API.app";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-" +
  "[0-9a-f]{12}";
const installationId = new RegExp("^" + uuid + "$", "u");
const preparedName = new RegExp("^\\.blooket-api\\.update-" + uuid + "$", "u");
export interface DirectoryIdentity {
  readonly device: string;
  readonly inode: string;
}
export type ExchangeOrientation = "original" | "exchanged" | "unknown";
export function identityAdmitted(value: unknown): value is DirectoryIdentity {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "device") || !Object.hasOwn(value, "inode"))
    return false;
  return [value["device"], value["inode"]].every(part =>
    typeof part === "string" && /^(?:0|[1-9][0-9]{0,19})$/u.test(part) &&
      BigInt(part) <= 18_446_744_073_709_551_615n) && value["inode"] !== "0";
}
export function sameIdentity(left: DirectoryIdentity,
  right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}
export function pathAdmitted(path: string): boolean {
  return typeof path === "string" && path.length <= 4_096 &&
    posix.isAbsolute(path) && posix.resolve(path) === path &&
    !/[\x00-\x1f\x7f]/u.test(path);
}
export function locationsAdmitted(installed: string, candidate: string) {
  if (!pathAdmitted(installed) || !pathAdmitted(candidate) ||
      posix.basename(installed) !== BUNDLE_NAME ||
      posix.basename(candidate) !== BUNDLE_NAME) return false;
  const parent = posix.dirname(installed), prepared = posix.dirname(candidate);
  return parent !== "/" && posix.dirname(prepared) === parent &&
    preparedName.test(posix.basename(prepared));
}
export type InstallationPhase = "prepared" | "exchange-intent"
  | "new-observed" | "new-healthy" | "rollback-intent"
  | "old-observed" | "old-healthy";
export interface UpdateInstallationJournal {
  readonly schemaVersion: 1;
  readonly installationId: string;
  readonly installedVersion: string;
  readonly document: SignedUpdateManifest;
  readonly installedPath: string;
  readonly candidatePath: string;
  readonly installedIdentity: DirectoryIdentity;
  readonly candidateIdentity: DirectoryIdentity;
  readonly phase: InstallationPhase;
}
const phases: readonly InstallationPhase[] = ["prepared", "exchange-intent",
  "new-observed", "new-healthy", "rollback-intent", "old-observed",
  "old-healthy"];
const keys = new Set(["schemaVersion", "installationId", "installedVersion",
  "document", "installedPath", "candidatePath", "installedIdentity",
  "candidateIdentity", "phase"]);

export function decodeUpdateInstallationJournal(value: unknown):
  DecodeResult<UpdateInstallationJournal> {
  const fail = () => decodeFailure("$", "invalid-update-installation",
    "The installation journal is malformed or contradictory.");
  if (!isRecord(value)) return fail();
  const unknown = unknownFieldIssues(value, keys, "$");
  if (unknown.length) return { ok: false, issues: unknown };
  if (value["schemaVersion"] !== 1 ||
      typeof value["installationId"] !== "string" ||
      !installationId.test(value["installationId"]) ||
      typeof value["installedVersion"] !== "string" ||
      typeof value["installedPath"] !== "string" ||
      typeof value["candidatePath"] !== "string" ||
      !locationsAdmitted(value["installedPath"], value["candidatePath"]) ||
      posix.basename(posix.dirname(value["candidatePath"])) !==
        ".blooket-api.update-" + value["installationId"] ||
      !identityAdmitted(value["installedIdentity"]) ||
      !identityAdmitted(value["candidateIdentity"]) ||
      sameIdentity(value["installedIdentity"], value["candidateIdentity"]) ||
      value["installedIdentity"].device !== value["candidateIdentity"].device ||
      !phases.includes(value["phase"] as InstallationPhase)) return fail();
  const document = decodeSignedUpdateManifest(value["document"]);
  if (!document.ok) return fail();
  try {
    decodeProductVersion(value["installedVersion"]);
    if (compareProductVersions(document.value.manifest.version,
        value["installedVersion"]) <= 0) return fail();
  } catch { return fail(); }
  return { ok: true, value: {
    schemaVersion: 1, installationId: value["installationId"],
    installedVersion: value["installedVersion"], document: document.value,
    installedPath: value["installedPath"],
    candidatePath: value["candidatePath"],
    installedIdentity: { ...value["installedIdentity"] },
    candidateIdentity: { ...value["candidateIdentity"] },
    phase: value["phase"] as InstallationPhase,
  } };
}
const transitions: Readonly<Record<InstallationPhase,
  readonly InstallationPhase[]>> = {
  prepared: ["exchange-intent"],
  "exchange-intent": ["new-observed", "old-observed"],
  "new-observed": ["new-healthy", "rollback-intent"],
  "new-healthy": ["rollback-intent"],
  "rollback-intent": ["old-observed"],
  "old-observed": ["old-healthy"],
  "old-healthy": [],
};
export function advanceUpdateInstallationJournal(value: unknown,
  phase: InstallationPhase): DecodeResult<UpdateInstallationJournal> {
  const decoded = decodeUpdateInstallationJournal(value);
  if (!decoded.ok) return decoded;
  if (!transitions[decoded.value.phase].includes(phase))
    return decodeFailure("$.phase", "invalid-update-transition",
      "The installation phase cannot skip intent or observed ownership.");
  return { ok: true, value: { ...decoded.value, phase } };
}
