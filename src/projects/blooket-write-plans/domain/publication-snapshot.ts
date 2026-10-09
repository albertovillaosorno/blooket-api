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
import { isRecord } from
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
  if (!isRecord(value) || value["draftId"] !== draftId ||
      typeof value["revision"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value["revision"])) return undefined;
  const version = value["schemaVersion"];
  const keys = Object.keys(value).sort().join();
  if ((version === 1 && keys !==
        "capabilities,document,draftId,revision,schemaVersion") ||
      (version === 2 && keys !==
        "capabilities,document,draftId,expectedMedia,revision,schemaVersion") ||
      (version !== 1 && version !== 2)) return undefined;
  const document = decodeProjectDocument(value["document"]);
  const capabilities = decodeBlooketCapabilitySnapshot(value["capabilities"]);
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
    ? decodePreparedMediaIdentities(value["expectedMedia"]) : undefined;
  if (version === 2 && !expectedMedia) return undefined;
  const built = expectedMedia
    ? buildPreparedBlooketWritePlan(document.value, expectedMedia,
        capabilities.value)
    : buildBlooketWritePlan(JSON.stringify(document.value), "",
        capabilities.value);
  if (!built.ok) return undefined;
  return { document: document.value, revision: value["revision"],
    plan: built.value, expectedMedia };
}

export function publicationHasMedia(document: ProjectDocument): boolean {
  return document.coverImage !== null || document.questions.some(question =>
    question.image !== null || (question.type === "multiple-choice" &&
      question.answers.some(answer => answer.image !== null)),
  );
}
