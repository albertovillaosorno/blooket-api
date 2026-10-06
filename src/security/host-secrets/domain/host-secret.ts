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
//   - Canonical names and bounded values for secrets held by the host OS.
// - Must-Not:
//   - Persist secrets, choose an operating-system backend, or emit diagnostics.
// - Allows:
//   - Inputs: Untrusted secret names and trusted in-process secret strings.
//   - Outputs: Validated names and stable validation failures.
//   - Side effects: None.
// - Split-When:
//   - Different secret classes require independent lifetime or size policies.
// - Merge-When:
//   - Host secret storage is removed.
// - Summary:
//   - Defines the narrow value contract used by platform secret stores.
// - Description:
//   - Names are command-safe identifiers; values are bounded UTF-8 strings.
// - Usage:
//   - Validate names and values before crossing into an OS secret-store
//     adapter.
// - Defaults:
//   - Secret values may not be empty and are limited to 2048 UTF-8 bytes.
//
import {
  decodeFailure,
  type DecodeResult,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";

export const HOST_SECRET_MAX_BYTES = 2048;
const HOST_SECRET_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;

declare const HOST_SECRET_NAME_BRAND: unique symbol;

export type HostSecretName = string & {
  readonly [HOST_SECRET_NAME_BRAND]: true;
};

export function decodeHostSecretName(
  value: unknown,
  path = "$",
): DecodeResult<HostSecretName> {
  if (
    typeof value !== "string"
    || !HOST_SECRET_NAME.test(value)
  ) {
    return decodeFailure(
      path,
      "invalid-host-secret-name",
      "Expected a lowercase host-secret name using letters, digits, "
        + "dot, dash, or underscore.",
    );
  }

  return {
    ok: true,
    value: value as HostSecretName,
  };
}

export type HostSecretValueValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | "host-secret-empty"
        | "host-secret-too-large";
    };

export function validateHostSecretValue(
  value: string,
): HostSecretValueValidation {
  if (value.length === 0) {
    return { ok: false, code: "host-secret-empty" };
  }

  if (Buffer.byteLength(value, "utf8") > HOST_SECRET_MAX_BYTES) {
    return { ok: false, code: "host-secret-too-large" };
  }

  return { ok: true };
}
