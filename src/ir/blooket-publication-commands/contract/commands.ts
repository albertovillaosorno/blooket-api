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
  const invalid = (): DecodeResult<BlooketPublicationPayload> => ({
    ok: false, issues: [{
      path: "$.payload", code: "invalid-publication-request",
      message: "Expected a logical draft ID and, for a step, its exact " +
        "saved revision. Paths, provider state, and retry overrides are " +
        "not admitted.",
    }],
  });
  try {
    if (!isRecord(value)) return invalid();
    const fields = step ? ["draftId", "expectedRevision"] : ["draftId"];
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length ||
        keys.some(key => typeof key !== "string" || !fields.includes(key)))
      return invalid();
    const data = Object.getOwnPropertyDescriptors(value);
    const draft = data["draftId"];
    const revision = data["expectedRevision"];
    if (!draft || !Object.hasOwn(draft, "value") || !draft.enumerable ||
        typeof draft.value !== "string" ||
        !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}$/u.test(draft.value) ||
        (step && (!revision || !Object.hasOwn(revision, "value") ||
          !revision.enumerable || typeof revision.value !== "string" ||
          !/^[a-f0-9]{64}$/u.test(revision.value)))) return invalid();
    return { ok: true, value: {
      draftId: draft.value,
      ...(step ? { expectedRevision: revision!.value as string } : {}),
    } };
  } catch { return invalid(); }
}
