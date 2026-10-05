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
//   - Requested or resolved project image references.
// - Must-Not:
//   - Search the media vault or claim that an image satisfies a description.
// - Allows:
//   - Inputs: Unknown image-request candidates.
//   - Outputs: Strict image requests or structured validation failures.
//   - Side effects: None.
// - Split-When:
//   - Non-image media requests need independent semantics.
// - Merge-When:
//   - Projects stop representing unresolved image requirements.
// - Summary:
//   - Connects pedagogical image descriptions to optional media IDs.
// - Description:
//   - Keeps an image requirement usable before a vault asset is selected.
// - Usage:
//   - Reuse for cover, question, and answer images.
// - Defaults:
//   - A null media ID means the image requirement is unresolved.
//
import {
  decodeFailure,
  type DecodeResult,
  type ValidationIssue,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";
import { decodeMediaId } from
  "../../../media/media-identifiers/domain/media-id.ts";

export interface ImageRequest {
  readonly description: string;
  readonly mediaId: string | null;
}

const IMAGE_KEYS = new Set(["description", "mediaId"]);

export function decodeImageRequest(
  value: unknown,
  path = "$",
): DecodeResult<ImageRequest> {
  if (!isRecord(value)) {
    return decodeFailure(path, "expected-object", "Expected an image request.");
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, IMAGE_KEYS, path),
  ];
  const description = requiredString(
    value["description"],
    `${path}.description`,
    issues,
  );
  const mediaId = value["mediaId"];

  if (mediaId !== null) {
    const decoded = decodeMediaId(mediaId, `${path}.mediaId`);
    if (!decoded.ok) {
      issues.push(...decoded.issues);
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (
    description === undefined
    || (mediaId !== null && typeof mediaId !== "string")
  ) {
    return decodeFailure(
      path,
      "decoder-invariant",
      "Decoder invariant failed.",
    );
  }

  return { ok: true, value: { description, mediaId } };
}
