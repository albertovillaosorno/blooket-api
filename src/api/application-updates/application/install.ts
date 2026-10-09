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
import { randomUUID } from "node:crypto";
import { isRecord } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";
import { advanceUpdateInstallationJournal, decodeUpdateInstallationJournal,
  type ExchangeOrientation, type InstallationPhase,
  type UpdateInstallationJournal } from
  "../../../ir/application-updates/contract/installation.ts";
import { assessInstallationRecovery } from
  "../../../ir/application-updates/domain/recovery.ts";
import type { InstallationStopReason, InstallationTarget,
  UpdateInstallationPorts, UpdateInstallationResult } from
  "../contract/installation.ts";

// Authority comes from owned preparation and local configuration, independently
// of journal paths/claims. Capture it before the first async operation. Product
// integration must supply real fences, supervised descendants, Apple trust,
// silent restart, and authenticated health; no default permissive ports exist.
export function createUpdateInstallationController(
  authority: unknown, ports: UpdateInstallationPorts,
) {
  const prepared = decodeUpdateInstallationJournal(authority);
  const owned = prepared.ok && prepared.value.phase === "prepared"
    ? freeze(prepared.value) : undefined;
  let pending: Promise<UpdateInstallationResult> | undefined;
  return {
    run(signal?: AbortSignal): Promise<UpdateInstallationResult> {
      if (pending) return pending;
      const operation = runInstallation(owned, ports, signal);
      pending = operation;
      void operation.then(() => { pending = undefined; },
        () => { pending = undefined; });
      return operation;
    },
  };
}

async function runInstallation(authority: UpdateInstallationJournal | undefined,
  ports: UpdateInstallationPorts, signal?: AbortSignal):
  Promise<UpdateInstallationResult> {
  let current: UpdateInstallationJournal | undefined;
  let failure: InstallationStopReason = "journal";
  const stop = (reason: InstallationStopReason): UpdateInstallationResult => ({
    status: "installation-stopped", reason,
    ...(current ? { phase: current.phase } : {}),
  });
  if (!authority) return stop("invalid-authority");
  try {
    failure = "ownership";
    if (!status(await ports.ownership(), "owned")) return stop(failure);
    failure = "journal";
    const read = decodeUpdateInstallationJournal(await ports.journal.read());
    if (!read.ok) return stop(failure);
    current = freeze(read.value);
    if (JSON.stringify({ ...current, phase: "prepared" }) !==
        JSON.stringify(authority)) return stop("authority-mismatch");
    const orientation = await inspect();
    if (!orientation) return stop(failure);
    const recovery = assessInstallationRecovery(current, orientation, true);
    switch (recovery) {
      case "assess-candidate": {
        if (signal?.aborted) return stop("cancelled");
        if (!await assess(target("new", "original")))
          return stop("assessment");
        if (!await quiesce()) return stop("quiescence");
        // Journal intent before any native writer. Cancellation afterward is
        // recovery work, not permission to forget the old app or this intent.
        await advance("exchange-intent");
        const fresh = await inspect();
        if (!fresh) return stop(failure);
        if (fresh !== "original") return stop("orientation");
        if (signal?.aborted || !await assess(target("new", "original")) ||
            signal?.aborted) return await oldHealth();
        const observed = await exchange("forward", signal);
        if (!observed) return stop(failure);
        return observed === "original" ? await oldHealth()
          : await newHealth();
      }
      case "check-new-health": return await newHealth();
      case "check-old-health": return await oldHealth();
      case "rollback-required": return await rollback();
      default: return stop("orientation");
    }
  } catch { return stop(failure); }

  async function advance(phase: InstallationPhase) {
    failure = "journal";
    const next = advanceUpdateInstallationJournal(current!, phase);
    if (!next.ok) throw new Error("invalid-installation-transition");
    const admitted = freeze(next.value);
    await ports.journal.replace(current!, admitted);
    current = admitted;
  }
  async function inspect(): Promise<Exclude<ExchangeOrientation,
    "unknown"> | undefined> {
    failure = "ownership";
    if (!status(await ports.ownership(), "owned")) return undefined;
    failure = "writer";
    if (!status(await ports.settleNativeWriter(), "stopped")) return undefined;
    failure = "orientation";
    const observed = await ports.inspect();
    if (!isRecord(observed) || Object.keys(observed).sort().join() !==
        "durable,orientation" ||
        (observed["orientation"] !== "original" &&
          observed["orientation"] !== "exchanged") ||
        typeof observed["durable"] !== "boolean") return undefined;
    failure = "durability";
    if (!observed["durable"]) return undefined;
    return observed["orientation"];
  }
  function target(kind: "new" | "old",
    orientation: "original" | "exchanged"): InstallationTarget {
    const installed = (kind === "new") === (orientation === "exchanged");
    return freeze({ kind,
      path: installed ? current!.installedPath : current!.candidatePath,
      version: kind === "new" ? current!.document.manifest.version
        : current!.installedVersion,
      identity: kind === "new" ? current!.candidateIdentity
        : current!.installedIdentity,
    });
  }
  async function assess(expected: InstallationTarget) {
    failure = "assessment";
    try {
      const result = await ports.assess(expected, current!);
      return isRecord(result) && Object.keys(result).sort().join() ===
        "status,version" && result["status"] === "verified" &&
        result["version"] === expected.version;
    } catch { return false; }
  }
  async function quiesce() {
    failure = "quiescence";
    return status(await ports.quiesce(), "quiesced");
  }
  async function exchange(direction: "forward" | "rollback",
    cancellation?: AbortSignal) {
    failure = "exchange";
    try { await ports.exchange(direction, current!, cancellation); }
    catch {
      // Lost acknowledgement still requires a fresh owned observation.
    }
    return await inspect();
  }
  async function health(expected: InstallationTarget) {
    failure = "health";
    const nonce = randomUUID();
    try {
      const response = await ports.startAndCheck(expected, nonce);
      return isRecord(response) && Object.keys(response).sort().join() ===
        "nonce,status,version" && response["status"] === "healthy" &&
        response["version"] === expected.version && response["nonce"] === nonce;
    } catch { return false; }
  }
  async function newHealth(): Promise<UpdateInstallationResult> {
    if (current!.phase === "exchange-intent") await advance("new-observed");
    const expected = target("new", "exchanged");
    const assessed = await assess(expected);
    const healthy = assessed && !signal?.aborted && await health(expected);
    const observed = await inspect();
    if (!observed) return stop(failure);
    if (observed !== "exchanged") return stop("orientation");
    if (!healthy || signal?.aborted) {
      await advance("rollback-intent");
      return await rollback();
    }
    if (current!.phase === "new-observed") await advance("new-healthy");
    return { status: "applied", phase: "new-healthy",
      installationId: current!.installationId, version: expected.version };
  }
  async function rollback(): Promise<UpdateInstallationResult> {
    // Reassess the retained old app before stopping any running candidate.
    if (!await assess(target("old", "exchanged")))
      return stop("assessment");
    if (!await quiesce()) return stop("quiescence");
    const before = await inspect();
    if (!before) return stop(failure);
    if (before === "original") return await oldHealth();
    // Essential recovery uses its own bounded supervision; caller cancellation
    // cannot release ownership or abort away the only usable old application.
    const observed = await exchange("rollback");
    if (!observed) return stop(failure);
    if (observed !== "original") return stop("exchange");
    return await oldHealth();
  }
  async function oldHealth(): Promise<UpdateInstallationResult> {
    if (current!.phase === "exchange-intent" ||
        current!.phase === "rollback-intent") await advance("old-observed");
    const expected = target("old", "original");
    if (!await assess(expected)) return stop("assessment");
    if (!await health(expected)) return stop("health");
    const observed = await inspect();
    if (!observed) return stop(failure);
    if (observed !== "original") return stop("orientation");
    if (current!.phase === "old-observed") await advance("old-healthy");
    return { status: "old-running", phase: "old-healthy",
      installationId: current!.installationId, version: expected.version };
  }
}

function status(value: unknown, expected: string): boolean {
  return isRecord(value) && Object.keys(value).join() === "status" &&
    value["status"] === expected;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
