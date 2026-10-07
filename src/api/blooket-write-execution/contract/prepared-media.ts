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
//   - Prepared-media facts required immediately before one Blooket mutation.
// - Must-Not:
//   - Choose media IDs, read arbitrary paths, upload, or mutate the library.
// - Allows:
//   - Inputs: One stable media ID.
//   - Outputs: Current prepared bytes, revision, and decoded image format.
//   - Side effects: Read-only access to the owning local media library.
// - Split-When:
//   - Provider media families require incompatible prepared representations.
// - Merge-When:
//   - Browser write surfaces own a single canonical prepared-media contract.
// - Summary:
//   - Keeps local media resolution behind a narrow write-time read port.
// - Description:
//   - Concrete adapters must validate current recipe/file facts before success.
// - Usage:
//   - Resolve every referenced media ID before opening a remote mutation.
// - Defaults:
//   - Missing, stale, invalid, or unreadable prepared media fail closed.
//
export type BlooketPreparedMediaFormat = "gif" | "jpeg" | "png";

export interface BlooketPreparedMedia {
  readonly mediaId: string;
  readonly revision: number;
  readonly format: BlooketPreparedMediaFormat;
  readonly bytes: Uint8Array;
}

export type BlooketPreparedMediaReadResult =
  | {
      readonly ok: true;
      readonly value: BlooketPreparedMedia;
    }
  | {
      readonly ok: false;
      readonly code:
        | "blooket-media-not-prepared"
        | "blooket-media-stale"
        | "blooket-media-invalid"
        | "blooket-media-unavailable";
    };

export interface BlooketPreparedMediaReadPort {
  read(mediaId: string): Promise<BlooketPreparedMediaReadResult>;
}
