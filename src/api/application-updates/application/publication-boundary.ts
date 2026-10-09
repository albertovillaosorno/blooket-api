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
//   - Admission of an update boundary against active or unresolved publication.
// - Must-Not:
//   - Install apps, stop services, clear journals, or replay Blooket writes.
// - Allows:
//   - Inputs: Trusted local user-data authority.
//   - Outputs: Held publication exclusion or bounded recovery/ownership stops.
//   - Side effects: Shared local lock acquisition and directory observation.
// - Split-When:
//   - Other user-data writers require separate update coordination.
// - Merge-When:
//   - Installation composition owns this policy without external callers.
// - Summary:
//   - Keeps publication excluded after inspection until the caller releases it.
// - Description:
//   - Any remaining attempt, including confirmed state, blocks installation.
// - Usage:
//   - Acquire before service quiescence; retain through restart or recovery.
// - Defaults:
//   - Busy or unsafe state cannot authorize an application exchange.
//
import { acquirePublicationBoundary, publicationAttemptPresent } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../platforms/write-checkpoint-files/adapter-outbound/update-boundary.ts";

export type UpdatePublicationBoundaryResult =
  | { readonly ok: true; release(): Promise<void> }
  | { readonly ok: false; readonly reason: "publication-busy"
      | "publication-recovery-required" | "publication-storage-unavailable" };

export async function acquireUpdatePublicationBoundary(root: string):
  Promise<UpdatePublicationBoundaryResult> {
  const owned = await acquirePublicationBoundary(root);
  if (!owned.ok) return { ok: false, reason: owned.reason === "busy"
    ? "publication-busy" : "publication-storage-unavailable" };
  let reason: "publication-recovery-required"
    | "publication-storage-unavailable";
  try {
    if (!await publicationAttemptPresent(root))
      return { ok: true, release: () => owned.lock.release() };
    reason = "publication-recovery-required";
  } catch { reason = "publication-storage-unavailable"; }
  try { await owned.lock.release(); }
  catch { reason = "publication-storage-unavailable"; }
  return { ok: false, reason };
}
