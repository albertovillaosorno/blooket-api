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
import { decodeProjectDocument, type ProjectDocument } from
  "../../../projects/project-documents/domain/project.ts";
import { decodeBlooketCapabilitySnapshot,
  type BlooketCapabilitySnapshot } from
  "../../../ir/capability-snapshots/contract/blooket-capabilities.ts";
import { buildBlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import { executeLibraryCommand } from
  "../../teacher-library/application/library.ts";
import { inspectBlooketCapabilities } from
  "../../blooket-capability-inspection/application/inspect-capabilities.ts";
import type { BlooketReadDependencies } from
  "../../blooket-set-reads/application/command.ts";
import { getBlooketSet, listBlooketQuestions } from
  "../../blooket-set-reads/application/read-sets.ts";
import {
  publicationFiles, readPublicationSnapshot, createPublicationSnapshot,
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
  readonly signal?: AbortSignal;
}

export async function executeBlooketPublicationCommand(
  command: CommandEnvelope, host?: BlooketPublicationDependencies,
) {
  const fail = (code: string) => commandFailure(command.operationId, [{
    path: "$.publication", code,
    message: "Publication stopped. Keep the saved draft and inspect its " +
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
        schemaVersion: 1, draftId, revision: expectedRevision,
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
    const { plan, revision } = prepared;
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
      });
    const verifier = blooketSetReadWriteVerifier(
      blooket.sets, blooket.questions,
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
              return lowered.ok && questions.value[index] !== undefined &&
                questionMatches(questions.value[index]!, lowered.value);
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
      if (!buildBlooketWritePlan(
        JSON.stringify(prepared.document), "", currentCapabilities,
      ).ok) return fail("blooket-publication-capabilities-changed");
    }
    const result = await executePersistedBlooketWrite(
      files, plan, blooket.session, blooket.secrets, writes, verifier, {
        pacer, ...(signal ? { signal } : {}), budget: {
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

function hasMedia(
  document: ProjectDocument,
): boolean {
  return document.coverImage !== null || document.questions.some(question =>
    question.image !== null || (question.type === "multiple-choice" &&
      question.answers.some(answer => answer.image !== null)),
  );
}
function decodeSnapshot(value: unknown, draftId: string) {
  if (!isRecord(value) || Object.keys(value).sort().join() !==
      "capabilities,document,draftId,revision,schemaVersion" ||
      value["schemaVersion"] !== 1 || value["draftId"] !== draftId ||
      typeof value["revision"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value["revision"])) return undefined;
  const document = decodeProjectDocument(value["document"]);
  const capabilities = decodeBlooketCapabilitySnapshot(value["capabilities"]);
  if (!document.ok || !capabilities.ok || hasMedia(document.value))
    return undefined;
  const built = buildBlooketWritePlan(
    JSON.stringify(document.value), "", capabilities.value,
  );
  if (!built.ok) return undefined;
  return { document: document.value, revision: value["revision"],
    plan: built.value };
}
