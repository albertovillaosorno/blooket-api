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
//   - Canonical journaled publication of one immutable saved draft.
// - Must-Not:
//   - Accept paths, replay uncertain writes, or claim unverified publication.
// - Allows:
//   - Inputs: Exact logical draft requests and service-owned
//     execution dependencies.
//   - Outputs: Recoverable progress, fresh verification, or stable failures.
//   - Side effects: Owned snapshots/journals, bounded reads, and one write.
// - Split-When:
//   - One port family needs independent browser lifecycle management.
// - Merge-When:
//   - Application ports directly consume bridge commands.
// - Summary:
//   - Canonical journaled publication of one immutable saved draft.
// - Description:
//   - Preserves the canonical runtime validation boundary.
// - Usage:
//   - Use through the owning validated command entrypoint.
// - Defaults:
//   - Invalid or unsupported inputs fail closed.
//
import type { CommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import { commandFailure, commandSuccess } from
  "../../command-execution/application/result.ts";
import {
  decodeBlooketPublicationCommand, isBlooketPublicationCommand,
} from "../../../ir/blooket-publication-commands/contract/commands.ts";
import { isRecord } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";
import { decodeProjectDocument } from
  "../../../projects/project-documents/domain/project.ts";
import type { BlooketCapabilitySnapshot } from
  "../../../ir/capability-snapshots/contract/blooket-capabilities.ts";
import {
  buildBlooketWritePlan, buildPreparedBlooketWritePlan,
  sameRemoteCreateSetMetadata,
} from "../../../projects/blooket-write-plans/domain/write-plan.ts";
import { decodeBlooketPublicationSnapshot as decodeSnapshot,
  publicationHasMedia as hasMedia } from
  "../../../projects/blooket-write-plans/domain/publication-snapshot.ts";
import type { BlooketPreparedMediaReadPort } from
  "../contract/prepared-media.ts";
import { executeLibraryCommand } from
  "../../teacher-library/application/library.ts";
import { inspectBlooketCapabilities } from
  "../../blooket-capability-inspection/application/inspect-capabilities.ts";
import type { BlooketReadDependencies } from
  "../../blooket-set-reads/application/command.ts";
import { getBlooketSet, listBlooketQuestions, listBlooketSets } from
  "../../blooket-set-reads/application/read-sets.ts";
import {
  publicationFiles, readPublicationSnapshot, createPublicationSnapshot,
  readOtherPublicationSnapshots,
} from
  "../../../platforms/write-checkpoint-files/adapter-outbound/publication.ts";
import { loadWriteCheckpointFile } from
  "../../../platforms/write-checkpoint-files/adapter-outbound/file.ts";
import { loadWriteAttemptFile } from
  "../../../platforms/write-attempt-files/adapter-outbound/file.ts";
import { tryAcquireFileLock, type FileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import { acquirePublicationBoundary } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../platforms/write-checkpoint-files/adapter-outbound/update-boundary.ts";
import type { BlooketWriteExecutionPort } from
  "../contract/write-execution.ts";
import type { BlooketMutationPacer } from "./mutation-pacing.ts";
import { executePersistedBlooketWrite } from "./execute-persisted.ts";
import { verifyPersistedBlooketWrite } from "./verify-reconciliation.ts";
import { blooketSetReadWriteVerifier, questionMatches } from
  "./set-read-verifier.ts";
import { lowerBlooketWriteSubmission } from "./lower-submission.ts";

export interface BlooketPublicationDependencies {
  readonly root: string;
  readonly blooket: BlooketReadDependencies;
  readonly writes: BlooketWriteExecutionPort;
  readonly pacer: BlooketMutationPacer;
  readonly preparedMedia?: BlooketPreparedMediaReadPort;
  readonly signal?: AbortSignal;
}

export async function executeBlooketPublicationCommand(
  command: CommandEnvelope, host?: BlooketPublicationDependencies,
) {
  const fail = (code: string) => commandFailure(command.operationId, [{
    path: "$.publication", code,
    message: code === "blooket-publication-remote-conflict"
      ? "Publication stopped: an existing set or previously started " +
        "identical plan may conflict. Inspect the original publication " +
        "and remote quiz before any new Create Set attempt."
      : code === "publication-storage-unavailable"
        ? "Publication stopped: local journal evidence could not be " +
          "safely inspected. Preserve it and repair storage before retrying."
        : code === "blooket-write-baseline-not-captured"
          ? "Publication stopped before sending a new write: the current " +
            "Blooket collection could not be fully verified for recovery. " +
            "Keep the saved draft; repeating this step cannot repair " +
            "missing collection evidence."
          : "Publication stopped. Keep the saved draft and inspect its " +
            "publication status before another step or reconciliation.",
  }]);
  if (!isBlooketPublicationCommand(command.command))
    return fail("unknown-command");
  const decoded = decodeBlooketPublicationCommand(
    command.command, command.payload,
  );
  if (!decoded.ok) return commandFailure(command.operationId, decoded.issues);
  if (!host) return fail("blooket-publication-unavailable");
  const { draftId, expectedRevision } = decoded.value;
  const { root, blooket, writes, pacer, signal } = host;
  const success = (value: unknown) =>
    commandSuccess(command.operationId, value);
  const boundary = await acquirePublicationBoundary(root);
  if (!boundary.ok) return fail(boundary.reason === "busy"
    ? "blooket-publication-busy" : "publication-storage-unavailable");
  let publicationLock: FileLock | undefined;
  try {
    const files = await publicationFiles(root, draftId).catch(() => undefined);
    if (!files) return fail("publication-storage-unavailable");
    const lock = await tryAcquireFileLock(files.lock);
    if (!lock.ok) return fail("blooket-publication-busy");
    publicationLock = lock.lock;
    if (signal?.aborted) return fail("blooket-publication-cancelled");
    let snapshot = await readPublicationSnapshot(files.snapshot);
    let currentCapabilities: BlooketCapabilitySnapshot | undefined;
    if (snapshot === undefined) {
      if (command.command !== "blooket.publication.step")
        return success({ draftId, phase: "not-started", published: false });
      const draft = await executeLibraryCommand({
        ...command, command: "drafts.get", payload: { id: draftId },
      }, root);
      if (!draft.ok || !isRecord(draft.value) ||
          draft.value["id"] !== draftId ||
          draft.value["revision"] !== expectedRevision)
        return fail("blooket-publication-draft-conflict");
      const document = decodeProjectDocument(draft.value["document"]);
      if (!document.ok)
        return fail("blooket-publication-invalid-draft");
      if (hasMedia(document.value))
        return fail("blooket-publication-media-unsupported");
      const capabilities = await inspectBlooketCapabilities(
        blooket.session, blooket.secrets, blooket.capabilities,
        { readOnly: true },
      );
      if (!capabilities.ok) return fail(capabilities.code);
      if (capabilities.kind !== "capabilities")
        return success({ draftId, phase: capabilities.kind,
          state: capabilities.state, published: false });
      currentCapabilities = capabilities.value;
      const candidate = {
        schemaVersion: 2, draftId, revision: expectedRevision,
        expectedMedia: { schemaVersion: 1, items: [] },
        document: document.value, capabilities: capabilities.value,
      };
      const admitted = decodeSnapshot(candidate, draftId);
      if (!admitted) return fail("blooket-publication-invalid-draft");
      if (signal?.aborted) return fail("blooket-publication-cancelled");
      await createPublicationSnapshot(files.snapshot, candidate);
      snapshot = candidate;
    }
    const prepared = decodeSnapshot(snapshot, draftId);
    if (!prepared) return fail("publication-snapshot-invalid");
    const { plan, revision, expectedMedia } = prepared;
    if (expectedRevision !== undefined && expectedRevision !== revision)
      return fail("blooket-publication-draft-conflict");
    const loaded = await loadWriteCheckpointFile(files.checkpoint, plan);
    const attempt = await loadWriteAttemptFile(files.attempt, plan);
    if (!loaded.ok || !attempt.ok)
      return fail("blooket-publication-recovery-required");
    const checkpoint = loaded.checkpoint;
    const progress = {
      draftId, revision, remoteSetId: checkpoint.remoteSetId,
      completedOperations: checkpoint.nextOperationIndex,
      totalOperations: plan.operations.length, published: false,
    };
    if (command.command === "blooket.publication.status")
      return success({ ...progress,
        phase: attempt.kind === "record" ? "reconciliation-required"
          : checkpoint.nextOperationIndex === plan.operations.length
            ? "writes-complete" : "ready",
        ...(attempt.kind === "record" ? {
          reason: attempt.record.baseline === null
            ? "baseline-unavailable" : "ambiguous-attempt",
        } : {}),
      });
    const verifier = blooketSetReadWriteVerifier(
      blooket.sets, blooket.questions, expectedMedia,
    );
    if (command.command === "blooket.publication.reconcile") {
      const result = await verifyPersistedBlooketWrite(
        files, plan, blooket.session, blooket.secrets, verifier,
      );
      if (!result.ok)
        return fail("code" in result ? result.code
          : "blooket-publication-recovery-required");
      return success({ ...progress, phase: result.kind,
        ...("state" in result ? { state: result.state } : {}),
        ...("reason" in result ? { reason: result.reason } : {}),
        completedOperations: result.checkpoint.nextOperationIndex,
        remoteSetId: result.checkpoint.remoteSetId,
      });
    }
    if (command.command === "blooket.publication.verify") {
      if (attempt.kind !== "missing" ||
          checkpoint.nextOperationIndex !== plan.operations.length ||
          checkpoint.remoteSetId === null)
        return fail("blooket-publication-incomplete");
      let previous: string | undefined;
      for (let observation = 0; observation < 2; observation++) {
        if (signal?.aborted) return fail("blooket-publication-cancelled");
        const detail = await getBlooketSet(
          blooket.session, blooket.secrets, blooket.sets,
          checkpoint.remoteSetId, { readOnly: true },
        );
        if (!detail.ok) return fail(detail.code);
        if (detail.kind !== "set")
          return success({ ...progress, phase: detail.kind,
            state: detail.state });
        const questions = await listBlooketQuestions(
          blooket.session, blooket.secrets, blooket.questions,
          checkpoint.remoteSetId, { readOnly: true },
        );
        if (!questions.ok) return fail(questions.code);
        if (questions.kind !== "questions")
          return success({ ...progress, phase: questions.kind,
            state: questions.state });
        const set = plan.operations[0];
        if (!set || set.kind !== "set" ||
            detail.value.title !== set.title ||
            detail.value.description !== set.description ||
            detail.value.visibility !== set.visibility ||
            questions.value.length !== plan.operations.length - 1 ||
            !plan.operations.slice(1).every((operation, index) => {
              const lowered = lowerBlooketWriteSubmission(operation, {
                remoteSetId: checkpoint.remoteSetId,
              });
              const imageId = lowered.ok &&
                lowered.value.kind === "add-question"
                ? lowered.value.image?.mediaId : undefined;
              return lowered.ok && questions.value[index] !== undefined &&
                questionMatches(questions.value[index]!, lowered.value,
                  imageId === undefined ? undefined
                    : expectedMedia?.items.find(item =>
                        item.mediaId === imageId));
            }))
          return fail("blooket-publication-remote-conflict");
        const current = JSON.stringify([detail.value, questions.value]);
        if (previous !== undefined && previous !== current)
          return fail("blooket-publication-remote-conflict");
        previous = current;
      }
      if (signal?.aborted) return fail("blooket-publication-cancelled");
      return success({ ...progress, phase: "verified", published: true,
        verifiedAt: new Date().toISOString(),
      });
    }
    if (signal?.aborted) return fail("blooket-publication-cancelled");
    // Keep new media mutations closed until the live native upload is proven.
    // Durable identity verification never consults current library bytes.
    if (hasMedia(prepared.document))
      return fail("blooket-publication-media-unsupported");
    // Admission is fresh for each new mutation. Already journaled attempts
    // need local recovery first and cannot create another remote write.
    if (attempt.kind === "missing" &&
        checkpoint.nextOperationIndex !== plan.operations.length) {
      if (currentCapabilities === undefined) {
        const capabilities = await inspectBlooketCapabilities(
          blooket.session, blooket.secrets, blooket.capabilities,
          { readOnly: true },
        );
        if (!capabilities.ok) return fail(capabilities.code);
        if (capabilities.kind !== "capabilities")
          return success({ ...progress, phase: capabilities.kind,
            state: capabilities.state });
        currentCapabilities = capabilities.value;
      }
      const admission = expectedMedia
        ? buildPreparedBlooketWritePlan(prepared.document, expectedMedia,
            currentCapabilities)
        : buildBlooketWritePlan(JSON.stringify(prepared.document), "",
            currentCapabilities);
      if (!admission.ok)
        return fail("blooket-publication-capabilities-changed");
    }
    // Separate drafts can create the same set even with different planned
    // questions. Match the remote Create Set payload, not a whole-plan hash.
    // The lock prevents two local publications from starting simultaneously;
    // the potentially partial My Sets list cannot prove global absence.
    if (attempt.kind === "missing" &&
        checkpoint.nextOperationIndex === 0) {
      let others;
      try { others = await readOtherPublicationSnapshots(root, draftId); }
      catch { return fail("publication-storage-unavailable"); }
      for (const other of others) {
        const candidate = decodeSnapshot(other.data, other.draftId);
        if (!candidate)
          return fail("publication-storage-unavailable");
        const ownSet = plan.operations[0];
        const otherSet = candidate.plan.operations[0];
        if (!ownSet || !otherSet || ownSet.kind !== "set" ||
            otherSet.kind !== "set")
          return fail("publication-storage-unavailable");
        if (!sameRemoteCreateSetMetadata(ownSet, otherSet)) continue;
        const paths = await publicationFiles(root, other.draftId)
          .catch(() => undefined);
        if (!paths) return fail("publication-storage-unavailable");
        const prior = await loadWriteCheckpointFile(
          paths.checkpoint, candidate.plan,
        );
        const inFlight = await loadWriteAttemptFile(
          paths.attempt, candidate.plan,
        );
        if (!prior.ok || !inFlight.ok)
          return fail("publication-storage-unavailable");
        if (prior.checkpoint.nextOperationIndex > 0 ||
            inFlight.kind === "record")
          return fail("blooket-publication-remote-conflict");
      }
    }
    // Even an incomplete My Sets list can prove a positive collision.
    // This prevents another draft from reproducing a matching private quiz
    // after a prior uncertain Create Set; absence is never taken as proof.
    if (attempt.kind === "missing" &&
        checkpoint.nextOperationIndex === 0) {
      const planned = plan.operations[0];
      if (!planned || planned.kind !== "set")
        return fail("blooket-publication-remote-conflict");
      const listed = await listBlooketSets(
        blooket.session, blooket.secrets, blooket.sets,
        { readOnly: true },
      );
      if (!listed.ok) return fail(listed.code);
      if (listed.kind !== "sets")
        return success({ ...progress, phase: listed.kind,
          state: listed.state });
      const matching = listed.value.filter(set =>
        set.title === planned.title);
      if (matching.length > 3)
        return fail("blooket-publication-remote-conflict");
      for (const candidate of matching) {
        const detail = await getBlooketSet(
          blooket.session, blooket.secrets, blooket.sets,
          candidate.id, { readOnly: true },
        );
        if (!detail.ok) return fail(detail.code);
        if (detail.kind !== "set")
          return success({ ...progress, phase: detail.kind,
            state: detail.state });
        if (detail.value.id === candidate.id &&
            detail.value.title === planned.title &&
            detail.value.description === planned.description &&
            detail.value.visibility === planned.visibility)
          return fail("blooket-publication-remote-conflict");
      }
    }
    // An earlier Create Set receipt alone must not authorize changes to an
    // unrelated existing quiz if the user or provider switched edit routes.
    // Read the exact remote metadata again before any subsequent question
    // mutation; a human stop or unknown route cannot authorize a write.
    if (checkpoint.nextOperationIndex > 0 &&
        checkpoint.nextOperationIndex < plan.operations.length) {
      const expected = plan.operations[0];
      if (!expected || expected.kind !== "set" ||
          checkpoint.remoteSetId === null)
        return fail("blooket-publication-remote-conflict");
      const detail = await getBlooketSet(
        blooket.session, blooket.secrets, blooket.sets,
        checkpoint.remoteSetId, { readOnly: true },
      );
      if (!detail.ok) return fail(detail.code);
      if (detail.kind !== "set")
        return success({ ...progress, phase: detail.kind,
          state: detail.state });
      if (detail.value.id !== checkpoint.remoteSetId ||
          detail.value.title !== expected.title ||
          detail.value.description !== expected.description ||
          detail.value.visibility !== expected.visibility)
        return fail("blooket-publication-remote-conflict");
      {
        const existing = await listBlooketQuestions(
          blooket.session, blooket.secrets, blooket.questions,
          checkpoint.remoteSetId, { readOnly: true },
        );
        if (!existing.ok) return fail(existing.code);
        if (existing.kind !== "questions")
          return success({ ...progress, phase: existing.kind,
            state: existing.state });
        const prior = plan.operations.slice(1,
          checkpoint.nextOperationIndex);
        if (existing.value.length !== prior.length ||
            !prior.every((operation, index) => {
              const lowered = lowerBlooketWriteSubmission(operation, {
                remoteSetId: checkpoint.remoteSetId,
              });
              const mediaId = lowered.ok &&
                lowered.value.kind === "add-question"
                ? lowered.value.image?.mediaId : undefined;
              return lowered.ok && existing.value[index] !== undefined &&
                questionMatches(existing.value[index]!, lowered.value,
                  mediaId === undefined ? undefined
                    : expectedMedia?.items.find(item =>
                        item.mediaId === mediaId));
            }))
          return fail("blooket-publication-remote-conflict");
      }
    }
    const result = await executePersistedBlooketWrite(
      files, plan, blooket.session, blooket.secrets, writes, verifier, {
        requireVerificationBaseline: true,
        pacer, ...(signal ? { signal } : {}),
        ...(host.preparedMedia ? { media: host.preparedMedia } : {}),
        ...(expectedMedia ? { expectedMedia } : {}), budget: {
          path: files.budget,
          policy: {
            maximumStarts: Math.min(10_000, plan.operations.length + 5),
            maximumDurationMs: 86_400_000,
          },
        },
      },
    );
    if (!result.ok)
      return fail("code" in result ? result.code
        : "blooket-publication-recovery-required");
    return success({ ...progress, phase: result.kind,
      ...("state" in result ? { state: result.state } : {}),
      ...("reason" in result ? { reason: result.reason } : {}),
      completedOperations: result.checkpoint.nextOperationIndex,
      remoteSetId: result.checkpoint.remoteSetId,
    });
  } catch {
    return fail("blooket-publication-unavailable");
  } finally {
    let releaseFailed = false;
    try { await publicationLock?.release(); }
    catch { releaseFailed = true; }
    try { await boundary.lock.release(); }
    catch { releaseFailed = true; }
    if (releaseFailed) return fail("publication-lock-release-failed");
  }
}
