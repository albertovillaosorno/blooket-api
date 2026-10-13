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
//   - Exact private installer-to-child startup admission messages.
// - Must-Not:
//   - Grant authority from a PID, token, environment value, or public request.
// - Allows:
//   - Inputs: Unknown private IPC messages.
//   - Outputs: Owned validated fields or refusal.
//   - Side effects: None.
// - Split-When:
//   - Startup requires another protocol version.
// - Merge-When:
//   - Private lifecycle protocols share identical contracts.
// - Summary:
//   - Captures fields without exposing live installation ownership.
// - Description:
//   - Decoding alone never authenticates the parent or held data boundary.
// - Usage:
//   - Verify against actual child/parent IPC and the private installation file.
// - Defaults:
//   - Unknown, inherited, accessor and extra fields are refused.
//
import { exactOwnData } from "../../runtime-decoding/domain/exact-object.ts";

export interface UpdateStartupRequest {
  readonly kind: "update-startup-request";
  readonly version: 1;
  readonly ownerPid: number;
  readonly childPid: number;
  // Confidential local ownership, never an HTTP/CLI/MCP result or log field.
  readonly token: string;
}
const uuid = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-" +
  "[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "u");

export function decodeUpdateStartupRequest(value: unknown):
  UpdateStartupRequest | undefined {
  const fields = exactOwnData(value,
    ["kind", "version", "ownerPid", "childPid", "token"]);
  if (!fields || fields["kind"] !== "update-startup-request" ||
      fields["version"] !== 1 || typeof fields["ownerPid"] !== "number" ||
      !Number.isSafeInteger(fields["ownerPid"]) || fields["ownerPid"] < 1 ||
      typeof fields["childPid"] !== "number" ||
      !Number.isSafeInteger(fields["childPid"]) || fields["childPid"] < 1 ||
      fields["ownerPid"] === fields["childPid"] ||
      typeof fields["token"] !== "string" || !uuid.test(fields["token"]))
    return undefined;
  return Object.freeze({ kind: "update-startup-request", version: 1,
    ownerPid: fields["ownerPid"], childPid: fields["childPid"],
    token: fields["token"] });
}

// A readiness notice only prevents an IPC listener race. It is not health,
// ownership or permission to install; the parent still owns its exact child.
export function decodeUpdateStartupReady(value: unknown): number | undefined {
  const fields = exactOwnData(value, ["kind", "version", "pid"]);
  if (!fields || fields["kind"] !== "update-startup-ready" ||
      fields["version"] !== 1 || typeof fields["pid"] !== "number" ||
      !Number.isSafeInteger(fields["pid"]) || fields["pid"] < 1)
    return undefined;
  return fields["pid"];
}
