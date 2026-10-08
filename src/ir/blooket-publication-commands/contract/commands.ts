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
//   - Exact logical publication command admission.
// - Must-Not:
//   - Expose credentials, accept arbitrary paths, or infer remote success.
// - Allows:
//   - Inputs: Bounded logical requests and saved draft revisions.
//   - Outputs: Validated logical inputs or stable decoding failures.
//   - Side effects: None.
// - Split-When:
//   - One port family needs independent browser lifecycle management.
// - Merge-When:
//   - Application ports directly consume bridge commands.
// - Summary:
//   - Exact logical publication command admission.
// - Description:
//   - Preserves the canonical runtime validation boundary.
// - Usage:
//   - Use through the owning validated command entrypoint.
// - Defaults:
//   - Invalid or unsupported inputs fail closed.
//
import { isRecord } from "../../runtime-decoding/domain/exact-object.ts";
import type { DecodeResult } from
  "../../runtime-decoding/domain/decode-result.ts";

export const BLOOKET_PUBLICATION_COMMANDS = [
  "blooket.publication.step", "blooket.publication.status",
  "blooket.publication.verify", "blooket.publication.reconcile",
] as const;
export type BlooketPublicationCommandName =
  (typeof BLOOKET_PUBLICATION_COMMANDS)[number];
export interface BlooketPublicationPayload {
  readonly draftId: string;
  readonly expectedRevision?: string;
}
export function isBlooketPublicationCommand(
  name: string,
): name is BlooketPublicationCommandName {
  return BLOOKET_PUBLICATION_COMMANDS.some(command => command === name);
}
export function decodeBlooketPublicationCommand(
  name: BlooketPublicationCommandName, value: unknown,
): DecodeResult<BlooketPublicationPayload> {
  const step = name === "blooket.publication.step";
  if (!isRecord(value) ||
      Object.keys(value).sort().join() !==
        (step ? "draftId,expectedRevision" : "draftId") ||
      typeof value["draftId"] !== "string" ||
      !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}$/u.test(value["draftId"]) ||
      (step && (typeof value["expectedRevision"] !== "string" ||
        !/^[a-f0-9]{64}$/u.test(value["expectedRevision"]))))
    return { ok: false, issues: [{
      path: "$.payload", code: "invalid-publication-request",
      message: "Expected a logical draft ID and, for a step, its exact " +
        "saved revision. Paths, provider state, and retry overrides are " +
        "not admitted.",
    }] };
  return { ok: true, value: {
    draftId: value["draftId"],
    ...(step ? { expectedRevision: value["expectedRevision"] as string } : {}),
  } };
}
