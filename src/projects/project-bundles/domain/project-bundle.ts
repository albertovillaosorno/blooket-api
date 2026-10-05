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
//   - Cross-file validation and canonical serialization of lesson projects.
// - Must-Not:
//   - Read directories, write files, migrate schema versions, or call Blooket.
// - Allows:
//   - Inputs: Untrusted project JSON text and media JSON Lines text.
//   - Outputs: Validated project bundles or canonical serialized bundle text.
//   - Side effects: None.
// - Split-When:
//   - Project schema migrations require independently versioned bundle readers.
// - Merge-When:
//   - Project metadata and media indexes become one persisted document.
// - Summary:
//   - Makes project.json and media.jsonl one validated semantic unit.
// - Description:
//   - Composes syntax, document, media-index, and media-reference validation.
// - Usage:
//   - Decode before persistence, execution planning, or transport summaries.
// - Defaults:
//   - Canonical project JSON is indented and terminated by one newline.
//
import { parseJson } from "../../../ir/json-syntax/domain/json.ts";
import {
  type DecodeResult,
  type ValidationIssue,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  decodeMediaJsonLines,
  serializeMediaJsonLines,
} from "../../../media/media-index/domain/json-lines.ts";
import type { MediaRecord } from
  "../../../media/media-records/domain/media-record.ts";
import {
  decodeProjectDocument,
  type ProjectDocument,
} from "../../project-documents/domain/project.ts";
import { validateProjectMediaReferences } from
  "../../project-validation/domain/media-references.ts";

export interface ProjectBundle {
  readonly project: ProjectDocument;
  readonly media: readonly MediaRecord[];
}

export interface SerializedProjectBundle {
  readonly projectJson: string;
  readonly mediaJsonl: string;
}

export function decodeProjectBundle(
  projectJson: string,
  mediaJsonl: string,
): DecodeResult<ProjectBundle> {
  const parsedProject = parseJson(projectJson);
  if (!parsedProject.ok) {
    return {
      ok: false,
      issues: [
        {
          path: "$.project",
          code: "invalid-json",
          message: parsedProject.message,
        },
      ],
    };
  }

  const project = decodeProjectDocument(parsedProject.value);
  if (!project.ok) {
    return { ok: false, issues: rebaseIssues(project.issues, "$.project") };
  }

  const media = decodeMediaJsonLines(mediaJsonl);
  if (!media.ok) {
    return { ok: false, issues: rebaseIssues(media.issues, "$.media") };
  }

  const referenceIssues = validateProjectMediaReferences(
    project.value,
    media.value,
  );
  if (referenceIssues.length > 0) {
    return {
      ok: false,
      issues: rebaseIssues(referenceIssues, "$.project"),
    };
  }

  return {
    ok: true,
    value: {
      project: project.value,
      media: media.value,
    },
  };
}

export function serializeProjectBundle(
  bundle: ProjectBundle,
): SerializedProjectBundle {
  return {
    projectJson: `${JSON.stringify(bundle.project, null, 2)}\n`,
    mediaJsonl: serializeMediaJsonLines(bundle.media),
  };
}

function rebaseIssues(
  issues: readonly ValidationIssue[],
  root: string,
): readonly ValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: `${root}${issue.path === "$" ? "" : issue.path.slice(1)}`,
  }));
}
