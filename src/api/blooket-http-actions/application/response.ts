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
//   - Bounded decoding of build-scoped Blooket action response candidates.
// - Must-Not:
//   - Execute requests, claim remote success, create receipts, or retry writes.
// - Allows:
//   - Inputs: HTTP status, observed action headers, and one bounded body
//     string.
//   - Outputs: Strict response evidence or a stable candidate-decode failure.
//   - Side effects: None.
// - Split-When:
//   - A verified action family requires an incompatible response contract.
// - Merge-When:
//   - Provider-owned write responses become a stable supported API.
// - Summary:
//   - Decodes response evidence without turning candidates into confirmation.
// - Description:
//   - Exact RSC content type gates Flight parsing; other bodies stay opaque.
// - Usage:
//   - Apply after an admitted HTTP action, before write verification policy.
// - Defaults:
//   - HTTP status and SUCCESS state alone never confirm a remote mutation.
//
import {
  decodeFlightActionResponseMetadata,
  flightActionState,
  flightErrorRecords,
  type FlightActionResponseMetadata,
  type FlightActionState,
} from "../../../ir/blooket-flight-records/contract/flight.ts";

const MAX_RESPONSE_BYTES = 5_000_000;

export interface BlooketHttpActionResponseCandidate {
  readonly status: number;
  readonly metadata: FlightActionResponseMetadata;
  readonly actionState: FlightActionState | null;
  readonly errorDigests: readonly string[];
}

export type BlooketHttpActionResponseDecodeResult =
  | {
      readonly ok: true;
      readonly value: BlooketHttpActionResponseCandidate;
    }
  | {
      readonly ok: false;
      readonly code:
        | "invalid-http-action-status"
        | "invalid-http-action-metadata"
        | "invalid-http-action-body";
    };

export function decodeBlooketHttpActionResponse(input: {
  readonly status: unknown;
  readonly contentType: string | null;
  readonly redirect: string | null;
  readonly revalidated: string | null;
  readonly body: string;
  readonly origin?: string;
}): BlooketHttpActionResponseDecodeResult {
  if (
    !Number.isSafeInteger(input.status) ||
    (input.status as number) < 100 ||
    (input.status as number) > 599
  )
    return { ok: false, code: "invalid-http-action-status" };

  let metadata: FlightActionResponseMetadata;
  try {
    metadata = decodeFlightActionResponseMetadata({
      contentType: input.contentType,
      redirect: input.redirect,
      revalidated: input.revalidated,
      ...(input.origin === undefined ? {} : { origin: input.origin }),
    });
  } catch {
    return { ok: false, code: "invalid-http-action-metadata" };
  }

  if (
    typeof input.body !== "string" ||
    new TextEncoder().encode(input.body).length > MAX_RESPONSE_BYTES
  )
    return { ok: false, code: "invalid-http-action-body" };

  if (!metadata.hasFlightBody) {
    return {
      ok: true,
      value: {
        status: input.status as number,
        metadata,
        actionState: null,
        errorDigests: [],
      },
    };
  }

  if (input.body.length === 0)
    return { ok: false, code: "invalid-http-action-body" };

  try {
    const actionState = flightActionState(input.body) ?? null;
    const errorDigests = flightErrorRecords(input.body).map(
      (record) => record.digest,
    );
    return {
      ok: true,
      value: {
        status: input.status as number,
        metadata,
        actionState,
        errorDigests,
      },
    };
  } catch {
    return { ok: false, code: "invalid-http-action-body" };
  }
}
