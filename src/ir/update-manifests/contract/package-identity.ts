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
//   - Exact clean ARM64 distribution identity admission for release signing.
// - Must-Not:
//   - Grant publisher/Apple trust, inspect files, or consume private keys.
// - Allows:
//   - Inputs: Unknown schema-one distribution metadata.
//   - Outputs: Owned clean package identity or a stable decoding failure.
//   - Side effects: None.
// - Split-When:
//   - Another release target is admitted.
// - Merge-When:
//   - Distribution identity no longer binds signed release metadata.
// - Summary:
//   - Keeps untrusted embedded package metadata behind exact admission.
// - Description:
//   - Dirty builds and declared signing flags cannot confer release trust.
// - Usage:
//   - Decode archive-bound distribution bytes before producing a manifest.
// - Defaults:
//   - Unknown fields, unsupported targets and malformed dependency facts stop.
//
import { isRecord, ownDataField, snapshotExactDenseArray,
  unknownFieldIssues } from "../../runtime-decoding/domain/exact-object.ts";
import { decodeFailure, type DecodeResult } from
  "../../runtime-decoding/domain/decode-result.ts";
import { decodeProductVersion } from
  "../../product-version/contract/version.ts";
import { isAdmittedMinimumMacos } from "./manifest.ts";

const fields = new Set(["version", "productVersion", "target",
  "sourceRevision", "minimumMacOS", "signed", "sourceDirty", "artifacts"]);
const artifactFields = new Set(["name", "version", "sha256", "integrityScope"]);
export interface ReleasePackageIdentity {
  readonly version: string;
  readonly sourceCommit: string;
  readonly minimumMacos: string;
}
export function decodeReleasePackageIdentity(value: unknown):
  DecodeResult<ReleasePackageIdentity> {
  const fail = () => decodeFailure("$", "invalid-release-package-identity",
    "Expected exact clean ARM64 distribution metadata.");
  try {
    if (!isRecord(value) || unknownFieldIssues(value, fields, "$").length)
      return fail();
    const version = ownDataField(value, "productVersion");
    const sourceCommit = ownDataField(value, "sourceRevision");
    const minimumMacos = ownDataField(value, "minimumMacOS");
    const artifacts = snapshotExactDenseArray(ownDataField(value, "artifacts"),
      128);
    if (ownDataField(value, "version") !== 1 ||
        ownDataField(value, "target") !== "darwin-arm64" ||
        ownDataField(value, "sourceDirty") !== false ||
        typeof ownDataField(value, "signed") !== "boolean" ||
        typeof version !== "string" || typeof sourceCommit !== "string" ||
        !/^[a-f0-9]{40}$/u.test(sourceCommit) ||
        !isAdmittedMinimumMacos(minimumMacos) || !artifacts ||
        artifacts.length === 0) return fail();
    decodeProductVersion(version);
    for (const artifact of artifacts) {
      if (!isRecord(artifact) ||
          unknownFieldIssues(artifact, artifactFields, "$").length)
        return fail();
      const name = ownDataField(artifact, "name");
      const revision = ownDataField(artifact, "version");
      const hash = ownDataField(artifact, "sha256");
      const scope = ownDataField(artifact, "integrityScope");
      if (!text(name, 200) || !text(revision, 128) ||
          typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash) ||
          (scope !== "archive" && scope !== "package-manifest")) return fail();
    }
    return { ok: true, value: { version, sourceCommit, minimumMacos } };
  } catch { return fail(); }
}
function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximum && value.trim() === value &&
    !/[\x00-\x1f\x7f]/u.test(value);
}
