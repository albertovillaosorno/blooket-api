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
//   - Read-only recovery assessment from intent and observed ownership.
// - Must-Not:
//   - Grant publisher trust, inspect files, launch apps, or install bundles.
// - Allows:
//   - Inputs: Unknown journal records and caller-selected next phases.
//   - Outputs: Required fresh assessments without replaying an exchange.
//   - Side effects: None.
// - Split-When:
//   - Another installation target needs a distinct persistence contract.
// - Merge-When:
//   - Installation facts no longer need durable recovery.
// - Summary:
//   - Records intent and observation without inferring installed health.
// - Description:
//   - Paths and signed envelopes cannot grant filesystem or trust authority.
// - Usage:
//   - Reassess local publisher trust, ownership, and health before any action.
// - Defaults:
//   - Invalid or contradictory records cannot authorize recovery.
//
import { decodeUpdateInstallationJournal,
  type ExchangeOrientation } from "../contract/installation.ts";

export type InstallationRecoveryAssessment = "invalid-journal"
  | "wait-for-writer" | "manual-recovery" | "assess-candidate"
  | "check-new-health" | "check-old-health" | "rollback-required";

// Native writer completion must be established outside the journal. A dead
// service PID or timeout is not proof that its child helper has stopped.
// These are required checks, never permission to exchange or delete a bundle.
export function assessInstallationRecovery(value: unknown,
  orientation: ExchangeOrientation, nativeWriterStopped: boolean):
  InstallationRecoveryAssessment {
  const decoded = decodeUpdateInstallationJournal(value);
  if (!decoded.ok) return "invalid-journal";
  if (nativeWriterStopped !== true) return "wait-for-writer";
  if (orientation !== "original" && orientation !== "exchanged")
    return "manual-recovery";
  switch (decoded.value.phase) {
    case "prepared":
      return orientation === "original"
        ? "assess-candidate" : "manual-recovery";
    case "exchange-intent":
      return orientation === "original"
        ? "check-old-health" : "check-new-health";
    case "new-observed":
    case "new-healthy":
      return orientation === "exchanged"
        ? "check-new-health" : "manual-recovery";
    case "rollback-intent":
      return orientation === "original"
        ? "check-old-health" : "rollback-required";
    case "old-observed":
    case "old-healthy":
      return orientation === "original"
        ? "check-old-health" : "manual-recovery";
  }
}
