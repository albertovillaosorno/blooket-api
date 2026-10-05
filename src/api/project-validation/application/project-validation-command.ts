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
//   - The project.validate command payload and application operation.
// - Must-Not:
//   - Read files, mutate projects, or perform Blooket writes.
// - Allows:
//   - Inputs: Project JSON text and media JSONL text in one command payload.
//   - Outputs: Canonical validation results and a compact project summary.
//   - Side effects: None.
// - Split-When:
//   - Capability validation becomes independently callable from schema checks.
// - Merge-When:
//   - Project validation is no longer exposed through command execution.
// - Summary:
//   - Validates complete local project content before any platform operation.
// - Description:
//   - Composes syntax, project, media-index, and media-reference validation.
// - Usage:
//   - Supply file contents rather than arbitrary filesystem paths.
// - Defaults:
//   - Unresolved image requests are reported in the success summary.
//
import { parseJson } from "../../../ir/json-syntax/domain/json.ts";
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";
import type { CommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import type { ResultEnvelope } from
  "../../../ir/wire-envelopes/contract/result-envelope.ts";
import { decodeMediaJsonLines } from
  "../../../media/media-index/domain/json-lines.ts";
import { decodeProjectDocument } from
  "../../../projects/project-documents/domain/project.ts";
import {
  countUnresolvedProjectImages,
  validateProjectMediaReferences,
} from
  "../../../projects/project-validation/domain/media-references.ts";
import { commandFailure, commandSuccess } from
  "../../command-execution/application/result.ts";

const PAYLOAD_KEYS = new Set(["projectJson", "mediaJsonl"]);

export function executeProjectValidationCommand(
  command: CommandEnvelope,
): ResultEnvelope {
  const payload = decodePayload(command.payload);
  if (!payload.ok) {
    return commandFailure(command.operationId, payload.issues);
  }

  const parsedProject = parseJson(payload.projectJson);
  if (!parsedProject.ok) {
    return commandFailure(command.operationId, [
      {
        path: "$.project",
        code: "invalid-json",
        message: parsedProject.message,
      },
    ]);
  }

  const project = decodeProjectDocument(parsedProject.value);
  if (!project.ok) {
    return commandFailure(command.operationId, project.issues);
  }

  const media = decodeMediaJsonLines(payload.mediaJsonl);
  if (!media.ok) {
    return commandFailure(command.operationId, media.issues);
  }

  const referenceIssues = validateProjectMediaReferences(
    project.value,
    media.value,
  );
  if (referenceIssues.length > 0) {
    return commandFailure(command.operationId, referenceIssues);
  }

  return commandSuccess(command.operationId, {
    title: project.value.title,
    visibility: project.value.visibility,
    questionCount: project.value.questions.length,
    mediaCount: media.value.length,
    unresolvedImageCount: countUnresolvedProjectImages(project.value),
  });
}

type DecodedPayload =
  | {
      readonly ok: true;
      readonly projectJson: string;
      readonly mediaJsonl: string;
    }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

function decodePayload(value: unknown): DecodedPayload {
  if (!isRecord(value)) {
    return failure(
      "$.payload",
      "expected-object",
      "Expected project validation payload.",
    );
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, PAYLOAD_KEYS, "$.payload"),
  ];
  const projectJson = value["projectJson"];
  const mediaJsonl = value["mediaJsonl"];

  if (typeof projectJson !== "string" || projectJson.length === 0) {
    issues.push({
      path: "$.payload.projectJson",
      code: "expected-project-json",
      message: "Expected non-empty project JSON text.",
    });
  }
  if (typeof mediaJsonl !== "string") {
    issues.push({
      path: "$.payload.mediaJsonl",
      code: "expected-string",
      message: "Expected media JSON Lines text.",
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (typeof projectJson !== "string" || typeof mediaJsonl !== "string") {
    return failure(
      "$.payload",
      "decoder-invariant",
      "Decoder invariant failed.",
    );
  }

  return { ok: true, projectJson, mediaJsonl };
}

function failure(
  path: string,
  code: string,
  message: string,
): { readonly ok: false; readonly issues: readonly ValidationIssue[] } {
  return { ok: false, issues: [{ path, code, message }] };
}
