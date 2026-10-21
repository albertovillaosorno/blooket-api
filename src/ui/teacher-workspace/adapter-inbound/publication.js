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

const PROGRESS_FIELDS = new Set([
  "draftId", "revision", "remoteSetId", "phase", "published",
  "completedOperations", "totalOperations", "state", "reason",
  "verifiedAt",
]);

function progress(value, draftId) {
  // Command replies cross a trust boundary. Snapshot only exact own JSON-like
  // fields, never run accessors or inherit a forged publication checkpoint.
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
          Object.getPrototypeOf(value) !== null))
      throw Error("publication-progress-invalid");
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).some(key => {
      const descriptor = fields[key];
      return typeof key !== "string" || !PROGRESS_FIELDS.has(key) ||
        !descriptor?.enumerable || !Object.hasOwn(descriptor, "value");
    })) throw Error("publication-progress-invalid");
    value = Object.fromEntries(Object.entries(fields).map(([key, field]) =>
      [key, field.value]));
  } catch { throw Error("publication-progress-invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.draftId !== draftId || typeof value.phase !== "string" ||
      typeof value.published !== "boolean" ||
      (value.published && value.phase !== "verified") ||
      (value.phase === "verified" && !value.published))
    throw Error("publication-progress-invalid");
  // Provider stop metadata is presentation-only. Reject nonprimitive values
  // rather than letting an arbitrary nested object leak into the UI or
  // travel alongside a writable snapshot.
  for (const field of ["state", "reason", "verifiedAt"])
    if (value[field] !== undefined && typeof value[field] !== "string")
      throw Error("publication-progress-invalid");
  // A plan without a journal cannot already own saved operations or a set.
  // Refuse contradictory preflight data before the first remote write.
  if (value.phase === "not-started" && (
    value.completedOperations !== undefined ||
    value.totalOperations !== undefined ||
    value.remoteSetId !== undefined ||
    value.revision !== undefined))
    throw Error("publication-progress-invalid");
  // A new set has a null binding; existing-target append and replacement
  // plans have an exact nonempty remote ID. Never accept a forged or empty
  // binding merely because no operation has completed yet.
  if (value.remoteSetId !== undefined && value.remoteSetId !== null &&
      (typeof value.remoteSetId !== "string" || !value.remoteSetId))
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
    // Append and replacement plans own a remote set before their first
    // mutation. Only the canonical frozen plan can distinguish them from
    // Create Set, so preserve that binding and reject any later retarget.
    (value.completedOperations > 0 &&
      (typeof value.remoteSetId !== "string" || !value.remoteSetId))
  )) throw Error("publication-progress-invalid");
  return value;
}

// The canonical server emits the moment of two independent remote reads as
// Date#toISOString(). An arbitrary nonempty label cannot certify that proof.
function hasVerifiedTimestamp(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
        .test(value)) return false;
  const moment = Date.parse(value);
  return Number.isFinite(moment) &&
    new Date(moment).toISOString() === value;
}

// Reading a local status can describe saved progress but cannot itself
// certify a fresh remote verification. The UI may expose actions only from
// a complete canonical journal snapshot, never from an invented status.
export function publicationStatusForView(incoming, draftId) {
  const status = progress(incoming, draftId);
  if (status.published !== false ||
      !["not-started", "ready", "writes-complete",
        "reconciliation-required"].includes(status.phase) ||
      (status.phase !== "not-started" &&
        (typeof status.revision !== "string" ||
         !/^[a-f0-9]{64}$/u.test(status.revision) ||
         status.remoteSetId === undefined ||
         status.totalOperations < 1 ||
         (status.completedOperations > 0 &&
          (typeof status.remoteSetId !== "string" ||
           !status.remoteSetId)))))
    throw Error("publication-progress-invalid");
  return status;
}

// An independent Reconcile button may offer Resume only after a complete,
// read-only recovered checkpoint proves this exact frozen operation. The
// subsequent user click re-reads canonical status before any new Save.
export function recoveredPublicationAction(previous, incoming, draftId) {
  const after = progress(incoming, draftId);
  if (after.phase !== "recovered") return null;
  const before = progress(previous, draftId);
  if (before.phase !== "reconciliation-required" ||
      before.published !== false || after.published !== false ||
      typeof before.revision !== "string" ||
      !/^[a-f0-9]{64}$/u.test(before.revision) ||
      after.revision !== before.revision ||
      after.totalOperations !== before.totalOperations ||
      after.completedOperations !== before.completedOperations + 1 ||
      typeof after.remoteSetId !== "string" || !after.remoteSetId ||
      (before.remoteSetId != null &&
        after.remoteSetId !== before.remoteSetId))
    throw Error("publication-progress-invalid");
  return after.completedOperations === after.totalOperations
    ? "verify" : "publish";
}

// A standalone Verify click is a read-only observation, not permission to
// change the frozen target. Never label a foreign or malformed receipt as
// published, even when its transport reply says "verified".
export function verifiedPublicationResult(previous, incoming, draftId) {
  const before = progress(previous, draftId);
  const after = progress(incoming, draftId);
  const success = after.phase === "verified" &&
    after.published === true && hasVerifiedTimestamp(after.verifiedAt);
  const paused = ["wait", "session-required", "human-action-required"]
    .includes(after.phase) && after.published === false;
  if (before.phase !== "writes-complete" || before.published !== false ||
      before.completedOperations !== before.totalOperations ||
      typeof before.revision !== "string" ||
      !/^[a-f0-9]{64}$/u.test(before.revision) ||
      typeof before.remoteSetId !== "string" || !before.remoteSetId ||
      after.revision !== before.revision ||
      after.remoteSetId !== before.remoteSetId ||
      after.totalOperations !== before.totalOperations ||
      after.completedOperations !== before.completedOperations ||
      !(success || paused))
    throw Error("publication-progress-invalid");
  return after;
}

// A browser cooldown is never a mutation retry. A stopped teacher intent
// releases the delay immediately rather than leaving Stop pending for 5 s.
export async function waitForPublicationReadCooldown(
  signal, delayMs = 5_000,
) {
  if (signal?.aborted || !Number.isSafeInteger(delayMs) ||
      delayMs < 0 || delayMs > 5_000) return false;
  return await new Promise(resolve => {
    let timer;
    const finish = ok => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolve(ok);
    };
    const stop = () => finish(false);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) { stop(); return; }
    timer = setTimeout(() => finish(!signal?.aborted), delayMs);
  });
}

export async function publishTextDraft(
  draftId, revision, send, onProgress = () => {}, cancelled = () => false,
  waitForReadRetry = async () => false,
) {
  if (typeof draftId !== "string" ||
      !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}$/u.test(draftId) ||
      typeof revision !== "string" || !/^[a-f0-9]{64}$/u.test(revision))
    throw Error("invalid-publication-request");
  // No sender may retain and mutate a reusable command payload between
  // independent status, reconciliation and verification requests.
  const payload = () => ({ draftId });
  // UI progress listeners may mutate presentation objects. They must never
  // alter the authoritative checkpoint compared before subsequent writes.
  const report = value => onProgress({ ...value });
  // A read-only probe that cannot prove recovery must preserve the existing
  // frozen checkpoint. "ready" or a foreign target is never a safe signal
  // to resume an uncertain Save.
  const preserveUncertain = (before, after) => {
    if (!["reconciliation-required", "wait", "human-action-required",
      "session-required"].includes(after.phase) ||
        after.published !== false ||
        after.revision !== before.revision ||
        after.totalOperations !== before.totalOperations ||
        after.completedOperations !== before.completedOperations ||
        after.remoteSetId !== before.remoteSetId)
      throw Error("publication-progress-invalid");
  };
  // Rate limiting may interrupt a *read-only* recovery or final verify.
  // Exactly one opt-in, cancelable cooldown retry is allowed. It can never
  // repeat publication.step, which might have already submitted a Save.
  const readWithCooldown = async (name, validate) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (cancelled()) return { cancelled: true };
      const rawReply = await send(name, payload());
      // Stop does not interrupt a committed provider request. Ignore its
      // eventual UI receipt rather than reporting progress after Stop.
      if (cancelled()) return { cancelled: true };
      const reply = progress(rawReply, draftId);
      validate(reply);
      if (attempt === 0 && reply.phase === "wait" &&
          reply.state === "rate-limited") {
        report(reply);
        // Stop may be triggered synchronously by the progress callback.
        // Do not start a timer after that teacher intent was revoked.
        if (cancelled()) return { cancelled: true };
        const allowed = await waitForReadRetry();
        if (cancelled()) return { cancelled: true };
        if (allowed) continue;
        return { reply, reported: true };
      }
      return { reply, reported: false };
    }
    throw Error("publication-progress-invalid");
  };
  const initialReply = await send("blooket.publication.status", payload());
  if (cancelled()) return { draftId, phase: "paused", published: false,
    completedOperations: 0, totalOperations: 0 };
  let current = progress(initialReply, draftId);
  report(current);
  if (current.published !== false) throw Error("publication-progress-invalid");
  if (!["not-started", "ready", "writes-complete",
    "reconciliation-required"].includes(current.phase))
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
    const observed = await readWithCooldown(
      "blooket.publication.verify", verified => {
        // Inconclusive verification retains the same frozen checkpoint.
        if (!verified.published && (
          !["wait", "human-action-required", "session-required"].includes(
            verified.phase) ||
          verified.revision !== frozenRevision ||
          verified.remoteSetId !== current.remoteSetId ||
          verified.totalOperations !== current.totalOperations ||
          verified.completedOperations !== current.completedOperations))
          throw Error("publication-progress-invalid");
        // Only the product's matching fresh receipt may claim success.
        if (verified.published && (
          !hasVerifiedTimestamp(verified.verifiedAt) ||
          verified.revision !== frozenRevision ||
          typeof current.remoteSetId !== "string" ||
          !current.remoteSetId ||
          verified.remoteSetId !== current.remoteSetId ||
          verified.totalOperations !== current.totalOperations ||
          verified.completedOperations !== current.completedOperations ||
          verified.completedOperations !== verified.totalOperations))
          throw Error("publication-progress-invalid");
      },
    );
    if (observed.cancelled) return { ...current, phase: "paused" };
    if (!observed.reported) report(observed.reply);
    return observed.reply;
  };
  const reconcile = async before => await readWithCooldown(
    "blooket.publication.reconcile", reply => {
      if (reply.published !== false)
        throw Error("publication-progress-invalid");
      if (reply.phase !== "recovered") preserveUncertain(before, reply);
    },
  );
  if (current.phase === "reconciliation-required") {
    // A resumed intent may inspect its existing uncertain journal once.
    // Reconcile uses fresh reads, never another Save. Only an exact
    // recovered checkpoint grants the next numbered mutation.
    if (cancelled()) return { ...current, phase: "paused" };
    const observation = await reconcile(current);
    if (observation.cancelled) return { ...current, phase: "paused" };
    const reconciled = observation.reply;
    if (reconciled.phase !== "recovered") {
      if (!observation.reported) report(reconciled);
      return reconciled;
    }
    if (reconciled.revision !== frozenRevision ||
        reconciled.totalOperations !== current.totalOperations ||
        reconciled.completedOperations !== current.completedOperations + 1 ||
        (current.remoteSetId != null &&
          reconciled.remoteSetId !== current.remoteSetId) ||
        typeof reconciled.remoteSetId !== "string" ||
        !reconciled.remoteSetId)
      throw Error("publication-progress-invalid");
    current = reconciled;
    report(current);
    if (current.completedOperations === current.totalOperations)
      return await verify();
  }
  if (current.phase === "writes-complete") return await verify();
  if (current.phase !== "not-started" && current.phase !== "ready" &&
      current.phase !== "recovered") return current;
  for (let index = 0; index < MAX_UI_STEPS; index++) {
    if (cancelled()) return { ...current, phase: "paused" };
    const stepReply = await send("blooket.publication.step", {
      draftId, expectedRevision: frozenRevision,
    });
    // An in-flight mutation may have persisted despite Stop. Never replay
    // it, verify it implicitly, or report its late reply as fresh progress.
    if (cancelled()) return { ...current, phase: "paused" };
    let next = progress(stepReply, draftId);
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
          (current.remoteSetId !== undefined &&
            next.remoteSetId !== current.remoteSetId) ||
          (current.phase === "not-started" && next.remoteSetId != null))
        throw Error("publication-progress-invalid");
      report(next);
      if (cancelled()) return { ...next, phase: "paused" };
      const observation = await reconcile(next);
      if (observation.cancelled) return { ...next, phase: "paused" };
      const reconciled = observation.reply;
      if (reconciled.phase !== "recovered") {
        if (!observation.reported) report(reconciled);
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
      // A provider wait after a normal step is a stop, not a new progress
      // checkpoint. A changed set or counter must not reach the UI as an
      // apparently resumable state. Before the first snapshot a stop may
      // legitimately omit all checkpoint metadata.
      if (!["wait", "human-action-required", "session-required"].includes(
        next.phase)) throw Error("publication-progress-invalid");
      if (current.phase === "not-started") {
        if (next.completedOperations !== 0 || next.remoteSetId != null ||
            (next.totalOperations !== 0 &&
              next.revision !== frozenRevision))
          throw Error("publication-progress-invalid");
      } else if (next.revision !== frozenRevision ||
          next.completedOperations !== current.completedOperations ||
          next.totalOperations !== current.totalOperations ||
          next.remoteSetId !== current.remoteSetId)
        throw Error("publication-progress-invalid");
      report(next);
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
    report(current);
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
  if (code === "blooket-browser-unavailable") return "connection";
  if (["blooket-write-baseline-not-captured",
    "blooket-browser-failed", "blooket-browser-navigation-timeout"
  ].includes(code)) return "verification";
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
