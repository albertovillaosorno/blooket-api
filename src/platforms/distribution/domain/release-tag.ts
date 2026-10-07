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
import {
  decodeProductVersion,
  PRODUCT_VERSION,
} from "../../../ir/product-version/contract/version.ts";

export interface QuarterlyRelease {
  readonly year: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly revision: number;
  readonly tag: string;
}
export function decodeReleaseTag(tag: string): QuarterlyRelease {
  if (!tag.startsWith("v")) throw new Error("invalid-quarterly-release-tag");
  const { year, quarter, revision } = decodeProductVersion(tag.slice(1));
  return { year, quarter, revision, tag };
}
export function assertProductReleaseTag(tag: string): string {
  decodeReleaseTag(tag);
  if (tag !== `v${PRODUCT_VERSION}`)
    throw new Error("release-tag-product-version-mismatch");
  return tag;
}
export function initialReleaseTag(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("invalid-release-date");
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2099) throw new Error("unsupported-release-year");
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const tag = `v${String(year - 2000).padStart(2, "0")}.${quarter}.0`;
  return decodeReleaseTag(tag).tag;
}
