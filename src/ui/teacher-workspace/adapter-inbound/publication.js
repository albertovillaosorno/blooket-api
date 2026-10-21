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
//   - Bounded UI orchestration over canonical journaled publication commands.
// - Must-Not:
//   - Write Blooket directly, infer receipts, or retry uncertain operations.
// - Allows:
//   - Inputs: One draft revision and a canonical command sender.
//   - Outputs: Reported progress or a recoverable stop.
//   - Side effects: Sequential calls to the ordinary product command boundary.
// - Split-When:
//   - Additional write transports require distinct browser state.
// - Merge-When:
//   - UI publication orchestration moves to the server.
// - Summary:
//   - Drives one admitted quiz publication to fresh verification.
// - Description:
//   - Advances only on a strictly increasing durable operation counter.
// - Usage:
//   - Wire into Quizzes after an explicit user publication request.
// - Defaults:
//   - Uncertain writes get one read-only probe; only proven recovery continues.
//
// The canonical write plan and durable mutation budget bound publication.
// A smaller UI-only limit would interrupt valid long quizzes every 128 writes.
const MAX_UI_STEPS = 10_000;

function progress(value, draftId) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.draftId !== draftId || typeof value.phase !== "string" ||
      typeof value.published !== "boolean" ||
      (value.published && value.phase !== "verified") ||
      (value.phase === "verified" && !value.published))
    throw Error("publication-progress-invalid");
  // A plan without a journal cannot already own saved operations or a set.
  // Refuse contradictory preflight data before the first remote write.
  if (value.phase === "not-started" && (
    value.completedOperations !== undefined ||
    value.totalOperations !== undefined ||
    value.remoteSetId !== undefined ||
    value.revision !== undefined))
    throw Error("publication-progress-invalid");
  // Before a snapshot exists, human/challenge/rate-limit outcomes omit counts.
  // They are recoverable stops, never authorization for another write.
  const noCounts = value.completedOperations === undefined &&
    value.totalOperations === undefined;
  if (noCounts && ["not-started", "wait", "human-action-required",
    "session-required"].includes(value.phase) && !value.published)
    return { ...value, completedOperations: 0, totalOperations: 0 };
  if (!Number.isSafeInteger(value.completedOperations) ||
      !Number.isSafeInteger(value.totalOperations) ||
      value.completedOperations < 0 || value.totalOperations < 1 ||
      value.totalOperations > MAX_UI_STEPS ||
      value.completedOperations > value.totalOperations)
    throw Error("publication-progress-invalid");
  if (["ready", "writes-complete"].includes(value.phase) && (
    (value.phase === "ready" &&
      value.completedOperations === value.totalOperations) ||
    (value.phase === "writes-complete" &&
      value.completedOperations !== value.totalOperations) ||
    (value.phase === "ready" && value.completedOperations === 0 &&
      value.remoteSetId != null) ||
    (value.completedOperations > 0 &&
      (typeof value.remoteSetId !== "string" || !value.remoteSetId))
  )) throw Error("publication-progress-invalid");
  return value;
}

export async function publishTextDraft(
  draftId, revision, send, onProgress = () => {}, cancelled = () => false,
) {
  if (typeof draftId !== "string" ||
      !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}$/u.test(draftId) ||
      typeof revision !== "string" || !/^[a-f0-9]{64}$/u.test(revision))
    throw Error("invalid-publication-request");
  const payload = { draftId };
  let current = progress(await send(
    "blooket.publication.status", payload,
  ), draftId);
  onProgress(current);
  if (current.phase === "reconciliation-required") return current;
  if (current.published !== false) throw Error("publication-progress-invalid");
  if (!["not-started", "ready", "writes-complete"].includes(current.phase))
    return current;
  // A started publication owns an immutable snapshot revision. Do not use
  // a separately edited draft revision to resume that frozen write plan.
  const frozenRevision = current.phase === "not-started"
    ? revision : current.revision;
  if (typeof frozenRevision !== "string" ||
      !/^[a-f0-9]{64}$/u.test(frozenRevision))
    throw Error("publication-progress-invalid");
  // Only the separate fresh remote verify command may claim publication.
  const verify = async () => {
    if (cancelled()) return { ...current, phase: "paused" };
    const verified = progress(await send(
      "blooket.publication.verify", payload,
    ), draftId);
    // The product owns fresh provider verification. Presentation may show
    // success only if its receipt still belongs to this frozen plan and set.
    if (verified.published && (
      verified.revision !== frozenRevision ||
      typeof current.remoteSetId !== "string" ||
      !current.remoteSetId ||
      verified.remoteSetId !== current.remoteSetId ||
      verified.totalOperations !== current.totalOperations ||
      verified.completedOperations !== current.completedOperations ||
      verified.completedOperations !== verified.totalOperations
    )) throw Error("publication-progress-invalid");
    onProgress(verified);
    return verified;
  };
  if (current.phase === "writes-complete") return await verify();
  if (current.phase !== "not-started" && current.phase !== "ready")
    return current;
  for (let index = 0; index < MAX_UI_STEPS; index++) {
    if (cancelled()) return { ...current, phase: "paused" };
    let next = progress(await send("blooket.publication.step", {
      draftId, expectedRevision: frozenRevision,
    }), draftId);
    // One publication step cannot prove final remote verification.
    if (next.published !== false) throw Error("publication-progress-invalid");
    let recoveredByProbe = false;
    if (next.phase === "reconciliation-required") {
      // A lost Save reply is not permission for another Save. The canonical
      // reconciler may prove this exact operation through fresh remote reads.
      if (next.revision !== frozenRevision ||
          next.completedOperations !== current.completedOperations ||
          (current.totalOperations !== 0 &&
            next.totalOperations !== current.totalOperations) ||
          (current.remoteSetId != null &&
            next.remoteSetId !== current.remoteSetId))
        throw Error("publication-progress-invalid");
      onProgress(next);
      if (cancelled()) return { ...next, phase: "paused" };
      const reconciled = progress(await send(
        "blooket.publication.reconcile", payload,
      ), draftId);
      if (reconciled.published !== false)
        throw Error("publication-progress-invalid");
      if (reconciled.phase !== "recovered") {
        onProgress(reconciled);
        return reconciled;
      }
      if (reconciled.revision !== next.revision ||
          reconciled.totalOperations !== next.totalOperations ||
          reconciled.completedOperations !== next.completedOperations + 1 ||
          (next.remoteSetId != null &&
            reconciled.remoteSetId !== next.remoteSetId))
        throw Error("publication-progress-invalid");
      next = reconciled;
      recoveredByProbe = true;
    }
    if (next.phase !== "advanced" && !recoveredByProbe) {
      onProgress(next);
      return next;
    }
    // The first Create Set receipt must bind a real set; later steps cannot
    // quietly change it, the frozen revision, or the operation count.
    if (typeof next.remoteSetId !== "string" ||
        !next.remoteSetId ||
        (current.remoteSetId != null &&
          current.remoteSetId !== next.remoteSetId) ||
        next.revision !== frozenRevision ||
        next.completedOperations !== current.completedOperations + 1 ||
        (current.totalOperations !== 0 &&
          next.totalOperations !== current.totalOperations))
      throw Error("publication-progress-invalid");
    current = next;
    onProgress(current);
    if (current.completedOperations === current.totalOperations)
      return await verify();
  }
  return { ...current, phase: "paused" };
}

// Only stable application-owned codes become actionable UI hints. Provider
// response bodies and unexpected exception messages are never shown directly.
export function publicationStopReason(error) {
  const code = error instanceof Error ? error.message : "";
  if (code === "blooket-authentication-required" ||
      code === "blooket-authentication-not-established") return "sign-in";
  if (["blooket-browser-companion-update-required",
    "blooket-browser-incompatible"].includes(code)) return "extension";
  if (["blooket-publication-remote-conflict",
    "blooket-remote-state-changed", "blooket-publication-draft-conflict",
    "blooket-publication-capabilities-changed"].includes(code))
    return "conflict";
  if (["blooket-publication-media-unsupported",
    "blooket-media-not-prepared", "blooket-media-stale",
    "blooket-media-invalid", "blooket-media-unavailable"].includes(code))
    return "media";
  if (code === "blooket-publication-busy") return "busy";
  if (code === "blooket-write-baseline-not-captured")
    return "verification";
  if (code === "blooket-publication-single-edit-required")
    return "single-edit";
  if (code === "blooket-publication-edit-unsupported")
    return "edit-unsupported";
  if (code === "blooket-publication-invalid-draft") return "content";
  if (["publication-storage-unavailable", "publication-lock-release-failed",
    "publication-snapshot-invalid",
    "blooket-publication-recovery-required"].includes(code))
    return "storage";
  if (code === "blooket-publication-question-limit") return "capacity";
  if (["mutation-task-start-budget-exhausted",
    "mutation-task-duration-exhausted"].includes(code)) return "limit";
  if (code === "mutation-pacing-failed") return "pacing";
  if (code === "blooket-publication-cancelled") return "paused";
  return "unknown";
}
