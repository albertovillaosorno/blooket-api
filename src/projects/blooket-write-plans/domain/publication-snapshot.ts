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

export function decodeBlooketPublicationSnapshot(
  value: unknown, draftId: string,
) {
  const current = exactOwnData(value, ["capabilities", "document",
    "draftId", "expectedMedia", "revision", "schemaVersion"]);
  const legacy = current === undefined
    ? exactOwnData(value, ["capabilities", "document", "draftId",
      "revision", "schemaVersion"]) : undefined;
  const owned = current ?? legacy;
  if (!owned || owned["draftId"] !== draftId ||
      typeof owned["revision"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(owned["revision"]) ||
      (current ? owned["schemaVersion"] !== 2 :
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
  if (version === 2 && (document.value.coverImage !== null ||
      document.value.questions.some(question =>
        question.type === "multiple-choice" &&
        question.answers.some(answer => answer.image !== null))))
    return undefined;
  const expectedMedia = version === 2
    ? decodePreparedMediaIdentities(owned["expectedMedia"]) : undefined;
  if (version === 2 && !expectedMedia) return undefined;
  const built = expectedMedia
    ? buildPreparedBlooketWritePlan(document.value, expectedMedia,
        capabilities.value)
    : buildBlooketWritePlan(JSON.stringify(document.value), "",
        capabilities.value);
  if (!built.ok) return undefined;
  return { document: document.value, revision: owned["revision"],
    plan: built.value, expectedMedia };
}

export function publicationHasMedia(document: ProjectDocument): boolean {
  return document.coverImage !== null || document.questions.some(question =>
    question.image !== null || (question.type === "multiple-choice" &&
      question.answers.some(answer => answer.image !== null)),
  );
}
