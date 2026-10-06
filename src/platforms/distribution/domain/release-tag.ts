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
//   - Quarterly CalVer admission for explicit release tags.
// - Must-Not:
//   - Use production data, credentials, or a live Blooket account.
// - Allows:
//   - Inputs: One admitted native target and explicit release verification.
//   - Outputs: A passing smoke result or a failing process exit.
//   - Side effects: None.
// - Split-When:
//   - Another distribution format needs independent acceptance.
// - Merge-When:
//   - Package verification no longer requires native execution.
// - Summary:
//   - Rejects malformed calendar versions before release execution.
// - Description:
//   - Defines three-month UTC quarters and monotonic release revisions.
// - Usage:
//   - Validate the operator-selected tag before release execution.
// - Defaults:
//   - Failed checks block release and cleanup only the owned fixture.
//
export interface QuarterlyRelease {
  readonly year: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly revision: number;
  readonly tag: string;
}
export function decodeReleaseTag(tag: string): QuarterlyRelease {
  const match = /^v(20[0-9]{2})\.([1-4])\.(0|[1-9][0-9]{0,4})$/u.exec(tag);
  if (!match) throw new Error("invalid-quarterly-release-tag");
  return {
    year: Number(match[1]),
    quarter: Number(match[2]) as 1 | 2 | 3 | 4,
    revision: Number(match[3]),
    tag,
  };
}
export function initialReleaseTag(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("invalid-release-date");
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const tag = `v${year}.${quarter}.0`;
  return decodeReleaseTag(tag).tag;
}
