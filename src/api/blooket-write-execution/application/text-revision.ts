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
//   - Paced and journaled correction of one existing quiz text field.
// - Must-Not:
//   - Blindly replay uncertain Saves, alter media, or invent persistence.
// - Allows:
//   - Inputs: One exact revision and service-owned browser execution ports.
//   - Outputs: Verified completion or a recoverable stop with journal ID.
//   - Side effects: Durable history and at most one Save per admission.
// - Split-When:
//   - Multi-operation revisions require an independent state machine.
// - Merge-When:
//   - All existing-set editing shares a canonical journal implementation.
// - Summary:
//   - Reconciliation does not Save; exact unchanged rows may re-arm.
// - Description:
//   - Exact input hashes bind recovery to original and desired text.
// - Usage:
//   - Execute behind the canonical local command boundary.
// - Defaults:
//   - Unknown storage, pending edits and missing browser support stop.
//
import { createHash } from "node:crypto";
import { decodeBlooketSetDetail, type BlooketSetDetail } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";
import { readdir } from "node:fs/promises";
import type { CommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import { decodeBlooketTextRevision } from
  "../../../ir/blooket-publication-commands/contract/text-revision.ts";
import { commandFailure, commandSuccess } from
  "../../command-execution/application/result.ts";
import { acquirePublicationBoundary } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../platforms/write-checkpoint-files/adapter-outbound/update-boundary.ts";
import { writeAtomicFile } from
  "../../../platforms/atomic-files/adapter-outbound/atomic-file.ts";
import { safeLibraryPath, boundedBytes } from
  "../../../platforms/user-library/adapter-outbound/files.ts";
import type { BlooketPublicationDependencies } from "./command.ts";

export async function executeTextRevision(command: CommandEnvelope,
  host?: BlooketPublicationDependencies) {
  const fail = (code: string, stage?: string) =>
    commandFailure(command.operationId, [{
    path: "$.revision" + (stage ? "." + stage : ""), code,
    message: code === "text-revision-reconciled-unchanged"
      ? "Two fresh reads confirmed the original row. This call did not " +
        "Save; the same request may receive a separate paced admission. " +
        "The prior attempt remains in its recovery history."
      : "Keep the text revision journal. Reconcile this exact request " +
        "before starting another correction; never repeat an uncertain Save.",
  }]);
  const decoded = decodeBlooketTextRevision(command.payload);
  if (!decoded.ok) return commandFailure(command.operationId, decoded.issues);
  if (!host?.textRevision) return fail("text-revision-unavailable");
  const input = decoded.value;
  const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const setKey = createHash("sha256").update(input.expectedSet.id)
    .digest("hex");
  const boundary = await acquirePublicationBoundary(host.root);
  if (!boundary.ok) return fail("blooket-publication-busy");
  let lease: { release(): void } | undefined;
  try {
    const relative = "text-revisions/" + setKey + "/" + key + ".json";
    const path = await safeLibraryPath(host.root, relative, true);
    const directory = path.slice(0, path.lastIndexOf("/"));
    const files = await readdir(directory);
    if (files.length > 1_000) return fail("text-revision-storage-unavailable");
    let attempted = false;
    let unresolved = false;
    let history: { outcome: "unchanged"; at: string }[] = [];
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/u.test(file))
        return fail("text-revision-storage-unavailable");
      const savedPath = await safeLibraryPath(host.root,
        "text-revisions/" + setKey + "/" + file);
      const saved = JSON.parse((await boundedBytes(savedPath, 1_000_000))
        .toString("utf8"));
      const request = decodeBlooketTextRevision(saved.request);
      if (saved.schemaVersion !== 1 || !request.ok ||
          !["ready", "attempting", "verified"].includes(saved.phase) ||
          saved.key !== file.slice(0, -5) ||
          createHash("sha256").update(JSON.stringify(request.value))
            .digest("hex") !== saved.key ||
          request.value.expectedSet.id !== input.expectedSet.id)
        return fail("text-revision-storage-unavailable");
      if (saved.key === key) {
        attempted = saved.phase !== "ready";
        unresolved = saved.phase === "attempting";
        if (saved.history !== undefined) {
          if (!Array.isArray(saved.history) || saved.history.length > 100 ||
              saved.history.some((item: { outcome?: unknown; at?: unknown }) =>
                item?.outcome !== "unchanged" ||
                typeof item.at !== "string" ||
                !Number.isFinite(Date.parse(item.at))))
            return fail("text-revision-storage-unavailable");
          history = saved.history;
        }
      }
      else if (saved.phase === "attempting")
        return fail("text-revision-reconciliation-required");
    }
    if (host.signal?.aborted) return fail("blooket-publication-cancelled");
    if (!attempted) {
      const admitted = await host.pacer.acquire(host.signal);
      if (!admitted.ok) return fail("blooket-publication-cancelled");
      lease = admitted.lease;
      if (host.signal?.aborted) return fail("blooket-publication-cancelled");
      await writeAtomicFile(path, JSON.stringify({ schemaVersion: 1,
        key, phase: "attempting", request: input, history }) + "\n");
    }
    const result = await host.textRevision.revise(input, attempted);
    if (result.outcome === "not-submitted" && !attempted) {
      await writeAtomicFile(path, JSON.stringify({ schemaVersion: 1,
        key, phase: "ready", request: input, history }) + "\n");
      return fail("text-revision-not-submitted", result.stage);
    }
    if (result.outcome === "unchanged" && unresolved) {
      if (history.length >= 100)
        return fail("text-revision-reconciliation-required");
      history.push({ outcome: "unchanged", at: new Date().toISOString() });
      await writeAtomicFile(path, JSON.stringify({ schemaVersion: 1,
        key, phase: "ready", request: input, history }) + "\n");
      return fail("text-revision-reconciled-unchanged", result.stage);
    }
    if (result.outcome !== "verified")
      return fail("text-revision-reconciliation-required", result.stage);
    await writeAtomicFile(path, JSON.stringify({ schemaVersion: 1, key,
      phase: "verified", request: input, history,
      verifiedAt: new Date().toISOString() }) + "\n");
    return commandSuccess(command.operationId, {
      verified: true, journalId: key, setId: input.expectedSet.id,
      kind: input.change.kind,
      ...(input.change.kind === "question-text"
        ? { number: input.change.previous.number } : {}),
      reconciled: attempted,
    });
  } catch { return fail("text-revision-storage-or-browser-unavailable"); }
  finally { lease?.release(); await boundary.lock.release(); }
}


// A local-only recovery tool for a lost Edit Info Save. Existing sets.get
// forces a newly loaded provider document for each invocation. No text.revise
// or Save is sent until two separate canonical reads establish the unchanged
// original metadata, and the exact attempted request is still journaled.
export async function reconcileUnchangedMetadataTextRevision(
  command: CommandEnvelope, root: string,
  readFresh: (setId: string) => Promise<{
    readonly operationId: string; readonly metadata: unknown;
  }>,
) {
  const stop = (code: string) => commandFailure(command.operationId, [{
    path: "$.revision", code,
    message: "Reconciliation stopped without a Save. Preserve the original " +
      "journal and review fresh account evidence before any retry.",
  }]);
  if (command.command !== "blooket.publication.reconcile-text")
    return stop("text-revision-invalid-recovery-command");
  const decoded = decodeBlooketTextRevision(command.payload);
  if (!decoded.ok) return commandFailure(command.operationId, decoded.issues);
  const input = decoded.value;
  if (input.change.kind === "question-text")
    return stop("text-revision-metadata-only");
  const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const setKey = createHash("sha256").update(input.expectedSet.id)
    .digest("hex");
  const boundary = await acquirePublicationBoundary(root);
  if (!boundary.ok) return stop("blooket-publication-busy");
  try {
    const path = await safeLibraryPath(root,
      "text-revisions/" + setKey + "/" + key + ".json");
    const files = await readdir(path.slice(0, path.lastIndexOf("/")));
    if (files.length > 1_000) return stop("text-revision-storage-unavailable");
    let original: Buffer | undefined;
    let originalHistory: { outcome: "unchanged"; at: string }[] = [];
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/u.test(file))
        return stop("text-revision-storage-unavailable");
      const bytes = await boundedBytes(await safeLibraryPath(root,
        "text-revisions/" + setKey + "/" + file), 1_000_000);
      const entry = JSON.parse(bytes.toString("utf8"));
      const valid = decodeBlooketTextRevision(entry.request);
      if (!valid.ok || entry.schemaVersion !== 1 ||
          !["ready", "attempting", "verified"].includes(entry.phase) ||
          entry.key !== file.slice(0, -5) ||
          createHash("sha256").update(JSON.stringify(valid.value))
            .digest("hex") !== entry.key ||
          valid.value.expectedSet.id !== input.expectedSet.id)
        return stop("text-revision-storage-unavailable");
      if (file === key + ".json") {
        if (entry.phase !== "attempting" ||
            JSON.stringify(valid.value) !== JSON.stringify(input) ||
            !Array.isArray(entry.history) || entry.history.length >= 100 ||
            entry.history.some((x: { outcome?: unknown; at?: unknown }) =>
              x?.outcome !== "unchanged" ||
              typeof x.at !== "string" ||
              !Number.isFinite(Date.parse(x.at))))
          return stop("text-revision-reconciliation-required");
        original = bytes;
        originalHistory = entry.history;
      } else if (entry.phase === "attempting")
        return stop("text-revision-reconciliation-required");
    }
    if (!original) return stop("text-revision-reconciliation-required");
    const verified: { readonly operationId: string;
      readonly metadata: BlooketSetDetail }[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await readFresh(input.expectedSet.id);
      const observation = decodeBlooketSetDetail(response.metadata);
      if (!/^cli:[a-f0-9-]{36}$/u.test(response.operationId) ||
          verified.some(x => x.operationId === response.operationId) ||
          !observation.ok ||
          JSON.stringify(observation.value) !==
            JSON.stringify(input.expectedSet))
        return stop("text-revision-reconciliation-required");
      verified.push({ operationId: response.operationId,
        metadata: observation.value });
    }
    // Validate journal bytes again after the second independently reloaded
    // provider document. A concurrent or manually changed journal is not
    // allowed to be promoted by an earlier observation.
    const current = await boundedBytes(path, 1_000_000);
    if (!current.equals(original))
      return stop("text-revision-reconciliation-required");
    const recovered = JSON.parse(original.toString("utf8"));
    const at = new Date().toISOString();
    const history = [...originalHistory, { outcome: "unchanged", at }];
    await writeAtomicFile(path, JSON.stringify({ ...recovered,
      phase: "ready", history,
      recoveryEvidence: { kind: "fresh-set-get-v1", at,
        operationIds: verified.map(x => x.operationId) },
    }) + "\n");
    return commandFailure(command.operationId, [{
      path: "$.revision", code: "text-revision-reconciled-unchanged",
      message: "Two independent fresh set reads verified the original " +
        "metadata. No Save was sent. The original attempt remains in " +
        "journal history; a separate paced admission is now possible.",
    }]);
  } catch { return stop("text-revision-storage-or-browser-unavailable"); }
  finally { await boundary.lock.release(); }
}
