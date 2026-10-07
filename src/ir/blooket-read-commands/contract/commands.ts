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
//   - Exact bounded payloads for admitted Blooket read commands.
// - Must-Not:
//   - Expose credentials, infer provider fields, or admit publication.
// - Allows:
//   - Inputs: Validated command inputs and explicit local ports.
//   - Outputs: Canonical read results or stable failures.
//   - Side effects: Only explicitly delegated local operations.
// - Split-When:
//   - One port family needs independent browser lifecycle management.
// - Merge-When:
//   - Application ports directly consume bridge commands.
// - Summary:
//   - Exact bounded payloads for admitted Blooket read commands.
// - Description:
//   - Preserves the canonical runtime validation boundary.
// - Usage:
//   - Use through the owning validated command entrypoint.
// - Defaults:
//   - Invalid or unsupported inputs fail closed.
//
import { decodeBlooketSetId } from
  "../../blooket-set-reads/contract/set-read.ts";
import {
  isRecord,
  unknownFieldIssues,
} from "../../runtime-decoding/domain/exact-object.ts";
import type { DecodeResult } from
  "../../runtime-decoding/domain/decode-result.ts";

export const BLOOKET_READ_COMMANDS = [
  "blooket.session.inspect",
  "blooket.sets.list",
  "blooket.sets.get",
] as const;
export type BlooketReadCommandName = (typeof BLOOKET_READ_COMMANDS)[number];
export type BlooketReadPayload =
  | { readonly kind: "session" }
  | { readonly kind: "list" }
  | { readonly kind: "get"; readonly setId: string };

export function isBlooketReadCommand(
  name: string,
): name is BlooketReadCommandName {
  return BLOOKET_READ_COMMANDS.some((command) => command === name);
}

export function decodeBlooketReadCommand(
  name: BlooketReadCommandName,
  value: unknown,
): DecodeResult<BlooketReadPayload> {
  if (!isRecord(value))
    return {
      ok: false,
      issues: [
        {
          path: "$.payload",
          code: "expected-object",
          message: "Expected a Blooket read payload object.",
        },
      ],
    };
  const keys = new Set(name === "blooket.sets.get" ? ["setId"] : []);
  const issues = [...unknownFieldIssues(value, keys, "$.payload")];
  if (issues.length) return { ok: false, issues };
  if (name === "blooket.sets.get") {
    const id = decodeBlooketSetId(value["setId"], "$.payload.setId");
    if (!id.ok) return id;
    if (id.value.length > 512 || /[\x00-\x1f\x7f]/u.test(id.value))
      return {
        ok: false,
        issues: [
          {
            path: "$.payload.setId",
            code: "invalid-set-id",
            message: "Set IDs must contain 1 to 512 non-control characters.",
          },
        ],
      };
    return { ok: true, value: { kind: "get", setId: id.value } };
  }
  return {
    ok: true,
    value: {
      kind: name === "blooket.session.inspect" ? "session" : "list",
    },
  };
}
