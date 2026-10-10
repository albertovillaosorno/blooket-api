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
//   - Exact-route native document lifetime observation for browser reads.
// - Must-Not:
//   - Inspect credentials, framework state, or infer saved account contents.
// - Allows:
//   - Inputs: One expected dashboard URL.
//   - Outputs: A positive native time origin or an unverified null.
//   - Side effects: None.
// - Split-When:
//   - A browser needs independent document freshness evidence.
// - Merge-When:
//   - The browser host supplies equivalent native document identity.
// - Summary:
//   - Distinguishes a new document from a stale complete tab response.
// - Description:
//   - The serialized function has no module or framework dependencies.
// - Usage:
//   - Inspect before and after an admitted navigation or reload.
// - Defaults:
//   - Wrong routes, incomplete documents, and invalid origins fail closed.
//
export function inspectBlooketDocumentOrigin(
  expectedUrl: string,
): number | null {
  try {
    if (new URL(expectedUrl).origin !== "https://dashboard.blooket.com" ||
        location.href !== expectedUrl || document.readyState !== "complete")
      return null;
    const origin = performance.timeOrigin;
    return Number.isFinite(origin) && origin > 0 ? origin : null;
  } catch {
    return null;
  }
}
