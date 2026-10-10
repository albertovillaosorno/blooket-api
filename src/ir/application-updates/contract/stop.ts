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
//   - Private IPC drained shutdown for an explicitly owned service process.
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
//   - Never treats startup messages or stale runtime files as drained shutdown.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import { isRecord } from "../../runtime-decoding/domain/exact-object.ts";
import { decodeUpdateHealthResponse } from "./health.ts";

const uuid = new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-" +
  "[89ab][0-9a-f]{3}-[0-9a-f]{12}$", "u");
export interface UpdateStopRequest {
  readonly kind: "update-stop-request";
  readonly nonce: string;
  readonly instance: string;
}
export function decodeUpdateStopRequest(value: unknown):
  UpdateStopRequest | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join() !==
      "instance,kind,nonce" || value["kind"] !== "update-stop-request" ||
      typeof value["nonce"] !== "string" || !uuid.test(value["nonce"]) ||
      typeof value["instance"] !== "string" || !uuid.test(value["instance"]))
    return undefined;
  return { kind: "update-stop-request", nonce: value["nonce"],
    instance: value["instance"] };
}
export interface UpdateStopResponse {
  readonly kind: "update-stop-response";
  readonly nonce: string;
  readonly status: "drained" | "unavailable";
  readonly version: string;
  readonly instance: string;
  readonly pid: number;
}
export function decodeUpdateStopResponse(value: unknown):
  UpdateStopResponse | undefined {
  if (!isRecord(value) || value["kind"] !== "update-stop-response" ||
      (value["status"] !== "drained" && value["status"] !== "unavailable"))
    return undefined;
  const receipt = decodeUpdateHealthResponse({ ...value,
    kind: "update-health-response",
    status: value["status"] === "drained" ? "healthy" : "unavailable" });
  if (!receipt) return undefined;
  return { ...receipt, kind: "update-stop-response",
    status: value["status"] };
}
