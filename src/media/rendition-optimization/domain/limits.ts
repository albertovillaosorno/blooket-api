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
//   - The strict prepared-media byte ceiling used by local preparation.
// - Must-Not:
//   - Encode media, inspect provider state, or relax the ceiling by format.
// - Allows:
//   - Inputs: Candidate encoded byte counts.
//   - Outputs: One canonical exclusive ceiling and exact admission decision.
//   - Side effects: None.
// - Split-When:
//   - A provider-specific upload boundary has independently verified limits.
// - Merge-When:
//   - Prepared media no longer needs an independent strict byte policy.
// - Summary:
//   - Keeps every portable prepared-media boundary below 2,500,000 bytes.
// - Description:
//   - The ceiling is exclusive; exactly 2,500,000 bytes is not admitted.
// - Usage:
//   - Use the maximum for bounded reads and the predicate for final admission.
// - Defaults:
//   - Only positive safe-integer byte counts below the ceiling are admitted.
//
export const PREPARED_MEDIA_BYTE_CEILING = 2_500_000;
export const MAX_PREPARED_MEDIA_BYTES = PREPARED_MEDIA_BYTE_CEILING - 1;

export function preparedMediaBytesAdmitted(bytes: number): boolean {
  return (
    Number.isSafeInteger(bytes) &&
    bytes >= 1 &&
    bytes < PREPARED_MEDIA_BYTE_CEILING
  );
}
