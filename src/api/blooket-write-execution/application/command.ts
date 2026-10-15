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
  type BlooketWriteOperation,
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
import {
  decodePublicationPreferences, defaultPublicationPreferences,
  type PublicationPreferences,
} from "../../../settings/teacher-preferences/domain/preferences.ts";
import { executePersistedBlooketWrite } from "./execute-persisted.ts";
import { verifyPersistedBlooketWrite } from "./verify-reconciliation.ts";
import {
  blooketSetReadWriteVerifier, questionMatches, questionBaselineFor,
} from
  "./set-read-verifier.ts";
import type { BlooketQuestionRead } from
  "../../../ir/blooket-question-reads/contract/question-read.ts";
import { sameBlooketWriteVerificationBaseline,
  type BlooketWriteVerificationBaseline } from
  "../../../projects/blooket-write-plans/domain/verification-baseline.ts";
import { lowerBlooketWriteSubmission } from "./lower-submission.ts";
import { admitPreparedPublicationIdentities } from
  "./admit-prepared-media.ts";
import { samePreparedMediaIdentity, type PreparedMediaIdentities } from
  "../../../projects/blooket-write-plans/domain/prepared-media-identities.ts";
import { isBrowserWriteExecutionPort,
  browserCreateSetConfirmationSupported } from "./browser-write-adapter.ts";

export interface BlooketPublicationDependencies {
  readonly root: string;
  readonly blooket: BlooketReadDependencies;
  readonly writes: BlooketWriteExecutionPort;
  readonly pacer: BlooketMutationPacer;
  readonly publicationPolicy?: PublicationPreferences;
  readonly preparedMedia?: BlooketPreparedMediaReadPort;
  readonly signal?: AbortSignal;
}

export async function executeBlooketPublicationCommand(
  command: CommandEnvelope, host?: BlooketPublicationDependencies,
) {
  const fail = (code: string) => commandFailure(command.operationId, [{
    path: "$.publication", code,
    message: code === "blooket-browser-companion-update-required"
      ? "The connected browser companion does not declare the required " +
        "saved-state confirmation support. Update the installed companion " +
        "before starting this quiz. Your saved draft is retained."
      : code === "blooket-publication-remote-conflict"
      ? "Publication stopped: the existing remote quiz, saved question " +
        "prefix, or another active publication conflicts with this plan. " +
        "Inspect the remote quiz and retained publication journal " +
        "before initiating another write."
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
  // A service normally supplies a frozen decoded policy. Own it again here
  // before any draft, browser, or journal I/O so alternate command hosts
  // cannot pass getters, symbols or a relaxed invalid task budget.
  let publicationPolicy: PublicationPreferences;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(host,
      "publicationPolicy");
    if (descriptor && (!descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")))
      return fail("invalid-publication-policy");
    publicationPolicy = descriptor?.value === undefined
      ? defaultPublicationPreferences()
      : decodePublicationPreferences(descriptor.value);
  } catch { return fail("invalid-publication-policy"); }
  const { draftId, expectedRevision, remoteSetId: requestedSetId } =
    decoded.value;
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
      if (command.command !== "blooket.publication.step" &&
          command.command !== "blooket.publication.append")
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
      // Cover and answer images still lack exact remote identity evidence.
      // Only question images backed by current prepared bytes are admitted.
      const unsupported = document.value.coverImage !== null ||
        document.value.questions.some(question =>
          question.type === "multiple-choice" &&
          question.answers.some(answer => answer.image !== null));
      if (unsupported || (hasMedia(document.value) && !host.preparedMedia))
        return fail("blooket-publication-media-unsupported");
      // Admitted question images use the base snapshot's explicit image
      // fact. They do not require probing account-dependent answer images
      // or audio drawers; the planner still refuses unknown image support.
      const capabilities = await inspectBlooketCapabilities(
        blooket.session, blooket.secrets, blooket.capabilities,
        { readOnly: true, textOnly: true },
      );
      if (!capabilities.ok) return fail(capabilities.code);
      if (capabilities.kind !== "capabilities")
        return success({ draftId, phase: capabilities.kind,
          state: capabilities.state, published: false });
      currentCapabilities = capabilities.value;
      let expectedMedia: PreparedMediaIdentities = {
        schemaVersion: 1, items: [],
      };
      if (hasMedia(document.value)) {
        const admitted = await admitPreparedPublicationIdentities(
          document.value, host.preparedMedia!, signal,
        );
        if (!admitted.ok) return fail(admitted.code);
        expectedMedia = admitted.identities;
      }
      let candidate: unknown = {
        schemaVersion: 2, draftId, revision: expectedRevision,
        expectedMedia,
        document: document.value, capabilities: capabilities.value,
      };
      const admitted = decodeSnapshot(candidate, draftId);
      if (!admitted) return fail("blooket-publication-invalid-draft");
      if (requestedSetId !== undefined) {
        const detail = await getBlooketSet(blooket.session, blooket.secrets,
          blooket.sets, requestedSetId, { readOnly: true });
        if (!detail.ok) return fail(detail.code);
        if (detail.kind !== "set")
          return success({ draftId, phase: detail.kind,
            state: detail.state, published: false });
        const existing = await listBlooketQuestions(blooket.session,
          blooket.secrets, blooket.questions, requestedSetId,
          { readOnly: true });
        if (!existing.ok) return fail(existing.code);
        if (existing.kind !== "questions")
          return success({ draftId, phase: existing.kind,
            state: existing.state, published: false });
        if (detail.value.id !== requestedSetId ||
            detail.value.title !== document.value.title ||
            detail.value.description !== document.value.description ||
            detail.value.visibility !== document.value.visibility ||
            existing.value.length >= document.value.questions.length ||
            !matchesQuestions(existing.value,
              admitted.plan.operations.slice(1, existing.value.length + 1),
              requestedSetId, expectedMedia))
          return fail("blooket-publication-remote-conflict");
        const baseline = questionBaselineFor(existing.value);
        if (baseline === null)
          return fail("blooket-write-baseline-not-captured");
        candidate = { schemaVersion: 3, draftId, revision: expectedRevision,
          expectedMedia, document: document.value,
          capabilities: capabilities.value,
          target: { remoteSetId: requestedSetId, baseline } };
        if (!decodeSnapshot(candidate, draftId))
          return fail("blooket-publication-invalid-draft");
        // Refuse a competing active publisher before freezing this new
        // draft. An unstarted rejected draft must remain retryable.
        const collision = await competingAppendState(root, draftId,
          requestedSetId);
        if (collision !== "none") return fail(collision === "conflict"
          ? "blooket-publication-remote-conflict"
          : "publication-storage-unavailable");
      }
      if (signal?.aborted) return fail("blooket-publication-cancelled");
      await createPublicationSnapshot(files.snapshot, candidate);
      snapshot = candidate;
    }
    const prepared = decodeSnapshot(snapshot, draftId);
    if (!prepared) return fail("publication-snapshot-invalid");
    const { plan, desiredPlan, revision, expectedMedia } = prepared;
    if (requestedSetId !== undefined && (plan.schemaVersion !== 2 ||
        requestedSetId !== plan.target.remoteSetId))
      return fail("blooket-publication-remote-conflict");
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
    let expectedAppendBaseline: BlooketWriteVerificationBaseline | null = null;
    const baseVerifier = blooketSetReadWriteVerifier(
      blooket.sets, blooket.questions, expectedMedia,
      isBrowserWriteExecutionPort(writes) ? "observed" : "complete",
    );
    const verifier = plan.schemaVersion === 1 ? baseVerifier : {
      ...baseVerifier,
      captureBaseline: async (...args: Parameters<
        typeof baseVerifier.captureBaseline>) => {
        const captured = await baseVerifier.captureBaseline(...args);
        // Session/media preparation may await between preflight and the
        // durable write-ahead journal. Recheck that exact collection here.
        if (!captured.ok) return captured;
        if (!expectedAppendBaseline ||
            !sameBlooketWriteVerificationBaseline(captured.baseline,
              expectedAppendBaseline))
          return { ok: true as const, baseline: null };
        // The question digest alone cannot detect a concurrent change to
        // set metadata while mutation pacing or media admission awaits.
        const detail = await getBlooketSet(blooket.session, blooket.secrets,
          blooket.sets, plan.target.remoteSetId, { readOnly: true });
        if (!detail.ok) return { ok: false as const,
          kind: "browser" as const,
          code: detail.code === "blooket-browser-unavailable" ||
            detail.code === "blooket-browser-incompatible"
            ? detail.code : "blooket-browser-failed" as const };
        if (detail.kind !== "set")
          return { ok: false as const, kind: "navigation" as const,
            state: detail.state };
        const expected = desiredPlan.operations[0];
        return expected?.kind === "set" &&
          detail.value.id === plan.target.remoteSetId &&
          detail.value.title === expected.title &&
          detail.value.description === expected.description &&
          detail.value.visibility === expected.visibility
          ? captured : { ok: true as const, baseline: null };
      },
    };
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
        const set = desiredPlan.operations[0];
        if (!set || set.kind !== "set" ||
            detail.value.title !== set.title ||
            detail.value.description !== set.description ||
            detail.value.visibility !== set.visibility ||
            !matchesQuestions(questions.value,
              desiredPlan.operations.slice(1), checkpoint.remoteSetId,
              expectedMedia) || (plan.schemaVersion === 2 &&
              !sameBlooketWriteVerificationBaseline(plan.target.baseline,
                questionBaselineFor(questions.value.slice(0,
                  plan.target.baseline.itemCount)))))
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
    // Re-admit all frozen prepared bytes before any new remote mutation.
    // Reconciliation and final verification above never read today's media.
    if (hasMedia(prepared.document) && attempt.kind === "missing" &&
        checkpoint.nextOperationIndex < plan.operations.length) {
      if (!host.preparedMedia || !expectedMedia)
        return fail("blooket-publication-media-unsupported");
      const current = await admitPreparedPublicationIdentities(
        prepared.document, host.preparedMedia, signal,
      );
      if (!current.ok) return fail(current.code);
      if (expectedMedia.items.length !== current.identities.items.length ||
          !expectedMedia.items.every(item => current.identities.items.some(
            candidate => samePreparedMediaIdentity(item, candidate))))
        return fail("blooket-media-stale");
    }
    if (plan.schemaVersion === 1 && attempt.kind === "missing" &&
        checkpoint.nextOperationIndex === 0 &&
        isBrowserWriteExecutionPort(writes) &&
        !await browserCreateSetConfirmationSupported(writes))
      return fail("blooket-browser-companion-update-required");
    // Admission is fresh for each new mutation. Already journaled attempts
    // need local recovery first and cannot create another remote write.
    if (attempt.kind === "missing" &&
        checkpoint.nextOperationIndex !== plan.operations.length) {
      if (currentCapabilities === undefined) {
        const capabilities = await inspectBlooketCapabilities(
          blooket.session, blooket.secrets, blooket.capabilities,
          { readOnly: true, textOnly: true },
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
    if (plan.schemaVersion === 1 && attempt.kind === "missing" &&
        checkpoint.nextOperationIndex === 0) {
      let others;
      try { others = await readOtherPublicationSnapshots(root, draftId); }
      catch { return fail("publication-storage-unavailable"); }
      for (const other of others) {
        const candidate = decodeSnapshot(other.data, other.draftId);
        if (!candidate)
          return fail("publication-storage-unavailable");
        if (candidate.plan.schemaVersion === 2) continue;
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
    if (plan.schemaVersion === 1 && attempt.kind === "missing" &&
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
    if (attempt.kind === "missing" &&
        (checkpoint.nextOperationIndex > 0 || plan.schemaVersion === 2) &&
        checkpoint.nextOperationIndex < plan.operations.length) {
      const expected = desiredPlan.operations[0];
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
        const completed = plan.schemaVersion === 2
          ? plan.target.baseline.itemCount + checkpoint.nextOperationIndex
          : checkpoint.nextOperationIndex - 1;
        const prior = desiredPlan.operations.slice(1, completed + 1);
        if (!matchesQuestions(existing.value, prior, checkpoint.remoteSetId,
              expectedMedia) || (plan.schemaVersion === 2 &&
              !sameBlooketWriteVerificationBaseline(plan.target.baseline,
                questionBaselineFor(existing.value.slice(0,
                  plan.target.baseline.itemCount)))))
          return fail("blooket-publication-remote-conflict");
        if (plan.schemaVersion === 2)
          expectedAppendBaseline = questionBaselineFor(existing.value);
      }
    }
    if (plan.schemaVersion === 2 && attempt.kind === "missing" &&
        checkpoint.nextOperationIndex < plan.operations.length) {
      const collision = await competingAppendState(root, draftId,
        plan.target.remoteSetId);
      if (collision !== "none") return fail(collision === "conflict"
        ? "blooket-publication-remote-conflict"
        : "publication-storage-unavailable");
    }
    const result = await executePersistedBlooketWrite(
      files, plan, blooket.session, blooket.secrets, writes, verifier, {
        requireVerificationBaseline: true,
        pacer, ...(signal ? { signal } : {}),
        ...(host.preparedMedia ? { media: host.preparedMedia } : {}),
        ...(expectedMedia ? { expectedMedia } : {}), budget: {
          path: files.budget,
          policy: {
            maximumStarts: Math.min(plan.operations.length + 5,
              publicationPolicy.maximumTaskStarts),
            maximumDurationMs: publicationPolicy.maximumTaskDurationMs,
          },
        },
      },
    );
    if (!result.ok)
      return fail("code" in result ? result.code
        : "blooket-publication-recovery-required");
    // A provider wait or human stop does not clear an attempted write.
    // Report the current observation alongside its uncertain checkpoint;
    // never convert it into permission to repeat the operation.
    const observedStop = result.kind === "reconciliation-required" &&
      "outcome" in result && result.outcome.ok && "state" in result.outcome
      ? result.outcome.state : undefined;
    return success({ ...progress, phase: result.kind,
      ...("state" in result ? { state: result.state } : {}),
      ...(observedStop === undefined ? {} : { state: observedStop }),
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

function matchesQuestions(
  actual: readonly BlooketQuestionRead[],
  operations: readonly BlooketWriteOperation[], remoteSetId: string,
  media?: PreparedMediaIdentities,
): boolean {
  return actual.length === operations.length && operations.every(
    (operation, index) => {
      const lowered = lowerBlooketWriteSubmission(operation, { remoteSetId });
      if (!lowered.ok || lowered.value.kind !== "add-question") return false;
      const imageId = lowered.value.image?.mediaId;
      return questionMatches(actual[index]!, lowered.value,
        imageId === undefined ? undefined : media?.items.find(item =>
          item.mediaId === imageId));
    },
  );
}

// A refused new append must not freeze an idle snapshot that later strands
// the active writer. Keep this admission and the resume gate identical.
async function competingAppendState(
  root: string, draftId: string, remoteSetId: string,
): Promise<"none" | "conflict" | "storage-unavailable"> {
  try {
    const others = await readOtherPublicationSnapshots(root, draftId);
    for (const other of others) {
      const candidate = decodeSnapshot(other.data, other.draftId);
      if (!candidate) return "storage-unavailable";
      const paths = await publicationFiles(root, other.draftId);
      const prior = await loadWriteCheckpointFile(paths.checkpoint,
        candidate.plan);
      const inFlight = await loadWriteAttemptFile(paths.attempt,
        candidate.plan);
      if (!prior.ok || !inFlight.ok) return "storage-unavailable";
      // A historical frozen but unused competing snapshot owns no write.
      if (prior.checkpoint.remoteSetId === remoteSetId &&
          (inFlight.kind === "record" ||
            (prior.checkpoint.nextOperationIndex > 0 &&
              prior.checkpoint.nextOperationIndex <
                candidate.plan.operations.length)))
        return "conflict";
    }
    return "none";
  } catch {
    return "storage-unavailable";
  }
}
