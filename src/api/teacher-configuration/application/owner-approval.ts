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
//   - Local owner-password approval with a shared bounded attempt budget.
// - Must-Not:
//   - Return stored secrets or mutate Blooket during diagnostics.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Host-secret reads and bounded password verification.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Local owner-password approval with a shared bounded attempt budget.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import {
  OWNER_VERIFIER_SECRET,
  verifyOwnerPassword,
} from "../../../security/owner-password/domain/verifier.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";

export function createOwnerApprovalGuard(
  secrets: HostSecretStore,
  now: () => number = Date.now,
) {
  let attempts: number[] = [];
  let checking = false;
  return async (password: string): Promise<void> => {
    const time = now();
    attempts = attempts.filter((at) => time - at < 60_000);
    if (checking || attempts.length >= 5)
      throw new Error("owner-approval-rate-limited");
    attempts.push(time);
    checking = true;
    try {
      const stored = await secrets
        .read(OWNER_VERIFIER_SECRET)
        .catch(() => ({ ok: false as const }));
      if (!stored.ok || stored.kind !== "found")
        throw new Error("owner-password-unavailable");
      if (!(await verifyOwnerPassword(password, stored.secret)))
        throw new Error("owner-password-invalid");
    } finally {
      checking = false;
    }
  };
}
