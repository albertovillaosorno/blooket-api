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
//   - Canonical stable identifiers for media-vault assets.
// - Must-Not:
//   - Resolve paths, inspect files, or generate identifiers from content.
// - Allows:
//   - Inputs: Unknown candidate media identifier values.
//   - Outputs: Valid media identifiers or structured failures.
//   - Side effects: None.
// - Split-When:
//   - Identifier generation becomes an independent capability.
// - Merge-When:
//   - Media records no longer use stable identifiers.
// - Summary:
//   - Defines one reusable media identifier grammar.
// - Description:
//   - Prevents projects and the media vault from duplicating identifier rules.
// - Usage:
//   - Decode every media ID before storing or resolving a media reference.
// - Defaults:
//   - IDs are lowercase ASCII and at most 128 characters.
//
import {
  decodeFailure,
  type DecodeResult,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";

export interface MediaId {
  readonly value: string;
}

const MEDIA_ID = /^[a-z0-9](?:[a-z0-9._-]{0,127})$/u;

export function decodeMediaId(
  value: unknown,
  path = "$.mediaId",
): DecodeResult<MediaId> {
  if (typeof value !== "string") {
    return decodeFailure(path, "expected-media-id", "Expected a string.");
  }

  if (!MEDIA_ID.test(value)) {
    return decodeFailure(
      path,
      "invalid-media-id",
      "Expected a lowercase stable media identifier.",
    );
  }

  return { ok: true, value: { value } };
}
