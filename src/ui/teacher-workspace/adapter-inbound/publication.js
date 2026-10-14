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
//   - Unknown phases, cancellation, and uncertain attempts stop immediately.
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
  // Before a snapshot exists, human/challenge/rate-limit outcomes omit counts.
  // They are recoverable stops, never authorization for another write.
  const noCounts = value.completedOperations === undefined &&
    value.totalOperations === undefined;
  if (noCounts && ["not-started", "wait", "human-action-required"]
    .includes(value.phase) && !value.published)
    return { ...value, completedOperations: 0, totalOperations: 0 };
  if (!Number.isSafeInteger(value.completedOperations) ||
      !Number.isSafeInteger(value.totalOperations) ||
      value.completedOperations < 0 || value.totalOperations < 1 ||
      value.totalOperations > MAX_UI_STEPS ||
      value.completedOperations > value.totalOperations)
    throw Error("publication-progress-invalid");
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
    onProgress(verified);
    return verified;
  };
  if (current.phase === "writes-complete") return await verify();
  if (current.phase !== "not-started" && current.phase !== "ready")
    return current;
  for (let index = 0; index < MAX_UI_STEPS; index++) {
    if (cancelled()) return { ...current, phase: "paused" };
    const next = progress(await send("blooket.publication.step", {
      draftId, expectedRevision: frozenRevision,
    }), draftId);
    // One publication step cannot prove final remote verification.
    if (next.published !== false) throw Error("publication-progress-invalid");
    onProgress(next);
    if (next.phase === "reconciliation-required") return next;
    // A new command can only follow an exact advancement of the frozen plan.
    // Never replay a write merely because its result was pending or ambiguous.
    if (next.phase !== "advanced" ||
        next.revision !== frozenRevision ||
        next.completedOperations !== current.completedOperations + 1 ||
        (current.totalOperations !== 0 &&
          next.totalOperations !== current.totalOperations))
      return next;
    current = next;
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
  if (code === "blooket-publication-media-unsupported") return "media";
  if (code === "blooket-publication-busy") return "busy";
  if (["publication-storage-unavailable", "publication-lock-release-failed",
    "publication-snapshot-invalid"].includes(code)) return "storage";
  if (code === "blooket-publication-cancelled") return "paused";
  return "unknown";
}
