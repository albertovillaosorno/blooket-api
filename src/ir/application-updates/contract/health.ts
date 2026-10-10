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
//   - Private IPC health proof for an explicitly owned service process.
// - Must-Not:
//   - Expose secrets or trust unvalidated host configuration.
// - Allows:
//   - Inputs: Explicit host configuration and bounded lifecycle inputs.
//   - Outputs: Validated local status, artifacts, or stable failure codes.
//   - Side effects: Owned filesystem, process, or browser operations.
// - Split-When:
//   - Host admission needs an independent platform boundary.
// - Merge-When:
//   - This host capability no longer needs a separate boundary.
// - Summary:
//   - Never treats startup messages or stale runtime files as fresh health.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import { isRecord } from "../../runtime-decoding/domain/exact-object.ts";
import { decodeProductVersion } from
  "../../product-version/contract/version.ts";

const uuid = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-" +
  "[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "u");
export function decodeUpdateHealthRequest(value: unknown): string | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join() !== "kind,nonce" ||
      value["kind"] !== "update-health-request" ||
      typeof value["nonce"] !== "string" || !uuid.test(value["nonce"]))
    return undefined;
  return value["nonce"];
}
export interface UpdateHealthResponse {
  readonly kind: "update-health-response";
  readonly nonce: string;
  readonly status: "healthy" | "unavailable";
  readonly version: string;
  readonly instance: string;
  readonly pid: number;
}
export function decodeUpdateHealthResponse(value: unknown):
  UpdateHealthResponse | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join() !==
      "instance,kind,nonce,pid,status,version" ||
      value["kind"] !== "update-health-response" ||
      typeof value["nonce"] !== "string" || !uuid.test(value["nonce"]) ||
      typeof value["instance"] !== "string" || !uuid.test(value["instance"]) ||
      typeof value["pid"] !== "number" ||
      !Number.isSafeInteger(value["pid"]) || value["pid"] < 1 ||
      (value["status"] !== "healthy" && value["status"] !== "unavailable") ||
      typeof value["version"] !== "string") return undefined;
  try { decodeProductVersion(value["version"]); }
  catch { return undefined; }
  return value as unknown as UpdateHealthResponse;
}
