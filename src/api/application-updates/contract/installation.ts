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
//   - Journaled installation, fresh health, and guarded rollback sequencing.
// - Must-Not:
//   - Select paths, grant trust, delete apps, or replay uncertain writes.
// - Allows:
//   - Inputs: Prepared authority and exclusively owned installation ports.
//   - Outputs: Fresh health-confirmed installation or preserved recovery state.
//   - Side effects: Journal, assessment, lifecycle, and exchange calls.
// - Split-When:
//   - Independent helper supervision needs another runtime boundary.
// - Merge-When:
//   - Installation no longer crosses service process lifetimes.
// - Summary:
//   - Coordinates one forward exchange and at most one inverse rollback.
// - Description:
//   - Recorded health and process signal delivery never prove current health.
// - Usage:
//   - Run in the independent installer while retaining all writer fences.
// - Defaults:
//   - Unproven ownership, trust, writer completion, or health fail closed.
//
import type { DirectoryIdentity, UpdateInstallationJournal } from
  "../../../ir/application-updates/contract/installation.ts";

export interface InstallationTarget {
  readonly kind: "new" | "old";
  readonly path: string;
  readonly version: string;
  readonly identity: DirectoryIdentity;
}

// These are trusted local composition ports, never remote command payloads.
// One independent installer owns the journal and every publication/persistent
// writer fence throughout the call. Do not release them on a timeout/signal.
export interface UpdateInstallationPorts {
  readonly journal: {
    read(): Promise<unknown>;
    replace(expected: UpdateInstallationJournal,
      next: UpdateInstallationJournal): Promise<void>;
  };
  // Exact { status: "owned" } only while exclusive fences remain held.
  ownership(): Promise<unknown>;
  // Independent proof for all old/current native descendants. Neither a dead
  // parent PID nor an interrupted observation grants "stopped" authority.
  settleNativeWriter(): Promise<unknown>;
  // Exact { orientation, durable } from fresh identities and parent fsyncs.
  inspect(): Promise<unknown>;
  // Authenticate the new signed context and Apple publisher, or reassess the
  // retained old bundle's publisher/version. Identity alone grants no trust.
  assess(target: InstallationTarget,
    record: UpdateInstallationJournal): Promise<unknown>;
  // Exact { status: "quiesced" } after every supervised writer has closed.
  quiesce(): Promise<unknown>;
  // Settle only after the owned native writer closes, even on cancellation
  // or lost acknowledgement. The result is never exchange/health evidence.
  exchange(direction: "forward" | "rollback",
    record: UpdateInstallationJournal, signal?: AbortSignal): Promise<void>;
  // Exact healthy status/version/nonce from the actual owned local runtime.
  // Use a fresh authenticated health challenge; stale discovery/PIDs, process
  // spawn success, and an unrelated instance cannot prove health. Bound all
  // process/probe work and drain it before settlement. Never open Terminal.
  startAndCheck(target: InstallationTarget, nonce: string): Promise<unknown>;
}

export type InstallationStopReason = "invalid-authority" | "ownership"
  | "journal" | "authority-mismatch" | "writer" | "orientation"
  | "durability" | "assessment" | "quiescence" | "health" | "exchange"
  | "cancelled";
export type UpdateInstallationResult =
  | { readonly status: "applied"; readonly installationId: string;
      readonly version: string; readonly phase: "new-healthy" }
  | { readonly status: "old-running"; readonly installationId: string;
      readonly version: string; readonly phase: "old-healthy" }
  | { readonly status: "installation-stopped";
      readonly reason: InstallationStopReason;
      readonly phase?: UpdateInstallationJournal["phase"] };
