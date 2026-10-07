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
//   - Canonical product version parsing and package projections.
// - Must-Not:
//   - Use production data, credentials, or a live Blooket account.
// - Allows:
//   - Inputs: A product version or UTC release date.
//   - Outputs: Validated calendar versions and monotonic package projections.
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
//   - Malformed versions fail closed.
//
export const PRODUCT_VERSION = "26.4.0";

export interface ProductVersion {
  readonly year: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly revision: number;
  readonly version: string;
}

// YY is explicitly 2000–2099. PATCH retains the existing 0–99999 bound.
export function decodeProductVersion(version: string): ProductVersion {
  const match = /^([0-9]{2})\.([1-4])\.(0|[1-9][0-9]{0,4})$/u.exec(version);
  if (!match) throw new Error("invalid-quarterly-product-version");
  return {
    year: 2000 + Number(match[1]),
    quarter: Number(match[2]) as 1 | 2 | 3 | 4,
    revision: Number(match[3]),
    version,
  };
}

export function compareProductVersions(left: string, right: string): number {
  const a = decodeProductVersion(left);
  const b = decodeProductVersion(right);
  return Math.sign(
    a.year - b.year || a.quarter - b.quarter || a.revision - b.revision,
  );
}

// Chrome limits each integer to 65535; the display version stays canonical.
export function extensionVersion(version: string): string {
  const value = decodeProductVersion(version);
  return (
    `${value.year - 2000}.${value.quarter}.` +
    `${Math.floor(value.revision / 65536)}.${value.revision % 65536}`
  );
}

// A monotonic 4/2/2-digit Apple build projection, not a second product version.
export function appleBuildVersion(version: string): string {
  const value = decodeProductVersion(version);
  const ordinal = (value.year - 2000) * 4 + value.quarter;
  return (
    `${ordinal * 10 + Math.floor(value.revision / 10000)}.` +
    `${Math.floor(value.revision / 100) % 100}.${value.revision % 100}`
  );
}
