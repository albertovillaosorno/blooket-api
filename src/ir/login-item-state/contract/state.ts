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
//   - Exact native login-item status admission.
// - Must-Not:
//   - Register services, consume credentials, or infer OS approval.
// - Allows:
//   - Inputs: Untrusted native login-item responses.
//   - Outputs: Validated state or bounded decoding failures.
//   - Side effects: None.
// - Split-When:
//   - Login-item results need a different schema or trust authority.
// - Merge-When:
//   - Native login-item state no longer needs a separate contract.
// - Summary:
//   - Preserves actual OS approval as a distinct product state.
// - Description:
//   - Rejects unknown fields and unsupported service status values.
// - Usage:
//   - Decode native process responses before displaying product status.
// - Defaults:
//   - Unknown schemas and malformed records fail closed.
//
import { isRecord } from "../../runtime-decoding/domain/exact-object.ts";
import { decodeFailure, type DecodeResult } from
  "../../runtime-decoding/domain/decode-result.ts";

export type LoginItemState = "enabled" | "not-registered" | "requires-approval"
  | "not-found" | "unsupported" | "unavailable";
export interface LoginItemStatus {
  readonly schemaVersion: 1;
  readonly state: LoginItemState;
}
export function decodeLoginItemStatus(
  value: unknown,
): DecodeResult<LoginItemStatus> {
  if (!isRecord(value) || Object.keys(value).sort().join() !==
      "schemaVersion,state" || value["schemaVersion"] !== 1 ||
      !["enabled", "not-registered", "requires-approval", "not-found",
        "unsupported", "unavailable"].includes(value["state"] as string))
    return decodeFailure("$", "invalid-login-item-status",
      "Invalid native login-item status.");
  return { ok: true, value: { schemaVersion: 1,
    state: value["state"] as LoginItemState } };
}
