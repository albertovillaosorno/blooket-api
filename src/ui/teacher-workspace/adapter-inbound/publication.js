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
const MAX_UI_STEPS = 128;

function progress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.phase !== "string")
    throw Error("publication-progress-invalid");
  if (value.phase === "not-started") return {
    phase: value.phase, completedOperations: 0, totalOperations: 0,
    published: false,
  };
  if (!Number.isSafeInteger(value.completedOperations) ||
      !Number.isSafeInteger(value.totalOperations) ||
      value.completedOperations < 0 || value.totalOperations < 1 ||
      value.totalOperations > MAX_UI_STEPS ||
      value.completedOperations > value.totalOperations ||
      typeof value.published !== "boolean")
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
  let current = progress(await send("blooket.publication.status", payload));
  onProgress(current);
  if (current.phase === "reconciliation-required") return current;
  // Only the separate fresh remote verify command may claim publication.
  if (current.published !== false) throw Error("publication-progress-invalid");
  const verify = async () => {
    if (cancelled()) return { ...current, phase: "paused" };
    const verified = progress(await send(
      "blooket.publication.verify", payload,
    ));
    onProgress(verified);
    return verified;
  };
  if (current.phase === "writes-complete") return await verify();
  if (current.phase !== "not-started" && current.phase !== "ready")
    return current;
  for (let index = 0; index < MAX_UI_STEPS; index++) {
    if (cancelled()) return { ...current, phase: "paused" };
    const next = progress(await send("blooket.publication.step", {
      draftId, expectedRevision: revision,
    }));
    // One publication step cannot prove final remote verification.
    if (next.published !== false) throw Error("publication-progress-invalid");
    onProgress(next);
    if (next.phase === "reconciliation-required") return next;
    // A new command can only follow an exact advancement of the frozen plan.
    // Never replay a write merely because its result was pending or ambiguous.
    if (next.phase !== "advanced" ||
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
