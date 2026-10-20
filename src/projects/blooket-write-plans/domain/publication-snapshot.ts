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
//   - Exact durable publication snapshots and legacy text compatibility.
// - Must-Not:
//   - Store bytes, paths, URLs, credentials, or infer provider identity.
// - Allows:
//   - Inputs: Versioned frozen draft, capability, and expected-media
//     candidates.
//   - Outputs: Validated plans and expected identities without filesystem
//     authority.
//   - Side effects: None.
// - Split-When:
//   - Providers require incompatible baseline families.
// - Merge-When:
//   - Write recovery no longer compares pre/post provider collections.
// - Summary:
//   - Binds frozen drafts and byte identities to recoverable plan identities.
// - Description:
//   - Decodes both versions without resolving the current media library.
// - Usage:
//   - Decode persisted snapshots before reads, writes, or reconciliation.
// - Defaults:
//   - Unknown fields, duplicate IDs, and malformed identities fail closed.
//
import { exactOwnData } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";
import { decodeProjectDocument, type ProjectDocument } from
  "../../project-documents/domain/project.ts";
import { decodeBlooketCapabilitySnapshot } from
  "../../../ir/capability-snapshots/contract/blooket-capabilities.ts";
import { decodePreparedMediaIdentities } from "./prepared-media-identities.ts";
import { buildBlooketWritePlan, buildPreparedBlooketWritePlan } from
  "./write-plan.ts";
import { buildBlooketReplacementPlan } from "./replacement-plan.ts";
import { buildBlooketAppendPlan } from "./write-plan.ts";
import { decodeBlooketSetId } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";
import { decodeBlooketWriteVerificationBaseline } from
  "./verification-baseline.ts";

export function decodeBlooketPublicationSnapshot(
  value: unknown, draftId: string,
) {
  const append = exactOwnData(value, ["capabilities", "document",
    "draftId", "expectedMedia", "revision", "schemaVersion", "target"]);
  const current = append === undefined ? exactOwnData(value,
    ["capabilities", "document",
    "draftId", "expectedMedia", "revision", "schemaVersion"])
    : undefined;
  const legacy = append === undefined && current === undefined
    ? exactOwnData(value, ["capabilities", "document", "draftId",
      "revision", "schemaVersion"]) : undefined;
  const owned = append ?? current ?? legacy;
  if (!owned || owned["draftId"] !== draftId ||
      typeof owned["revision"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(owned["revision"]) ||
      (append ? owned["schemaVersion"] !== 3 && owned["schemaVersion"] !== 4 :
        current ? owned["schemaVersion"] !== 2 :
        owned["schemaVersion"] !== 1)) return undefined;
  const version = owned["schemaVersion"];
  // Both nested decoders remain the authority for their respective
  // versions. Never let a malformed caller-supplied object escape this
  // public snapshot boundary as an exception.
  let document: ReturnType<typeof decodeProjectDocument>;
  let capabilities: ReturnType<typeof decodeBlooketCapabilitySnapshot>;
  try {
    document = decodeProjectDocument(owned["document"]);
    capabilities = decodeBlooketCapabilitySnapshot(owned["capabilities"]);
  } catch { return undefined; }
  if (!document.ok || !capabilities.ok) return undefined;
  if (version === 1 && publicationHasMedia(document.value)) return undefined;
  // Remote reads cannot establish cover or answer-image byte identity yet.
  // Do not admit a snapshot whose final verifier could ignore those effects.
  if (version !== 1 && (document.value.coverImage !== null ||
      document.value.questions.some(question =>
        question.type === "multiple-choice" &&
        question.answers.some(answer => answer.image !== null))))
    return undefined;
  const expectedMedia = version !== 1
    ? decodePreparedMediaIdentities(owned["expectedMedia"]) : undefined;
  if (version !== 1 && !expectedMedia) return undefined;
  const built = expectedMedia
    ? buildPreparedBlooketWritePlan(document.value, expectedMedia,
        capabilities.value)
    : buildBlooketWritePlan(JSON.stringify(document.value), "",
        capabilities.value);
  if (!built.ok) return undefined;
  let plan = built.value;
  if (append) {
    const target = exactOwnData(owned["target"], version === 4
      ? ["remoteSetId", "baseline", "previous"]
      : ["remoteSetId", "baseline"]);
    if (!target) return undefined;
    const id = decodeBlooketSetId(target["remoteSetId"]);
    const baseline = decodeBlooketWriteVerificationBaseline(
      target["baseline"], "question-list",
    );
    if (!id.ok || !baseline.ok) return undefined;
    const binding = { remoteSetId: id.value, baseline: baseline.value };
    const bound = version === 4
      ? buildBlooketReplacementPlan(plan, binding, target["previous"])
      : buildBlooketAppendPlan(plan, binding);
    if (!bound) return undefined;
    if (bound.schemaVersion === 3) {
      const operation = bound.operations[0];
      const previous = operation.previous, desired = operation.question;
      if (previous.hasImage || previous.hasAudio ||
          previous.equation !== null || desired.imageMediaId !== null ||
          previous.qType !== (desired.type === "multiple-choice"
            ? "mc" : "typing") || previous.answers.length !==
            (desired.type === "multiple-choice" ? desired.answers.length : 1))
        return undefined;
    }
    plan = bound;
  }
  return { document: document.value, revision: owned["revision"],
    plan, desiredPlan: built.value, expectedMedia };
}

export function publicationHasMedia(document: ProjectDocument): boolean {
  return document.coverImage !== null || document.questions.some(question =>
    question.image !== null || (question.type === "multiple-choice" &&
      question.answers.some(answer => answer.image !== null)),
  );
}
