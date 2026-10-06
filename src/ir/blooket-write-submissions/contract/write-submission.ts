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
//   - Provider-specific semantic submissions for observed Blooket write forms.
// - Must-Not:
//   - Encode selectors, server-action hashes, filesystem paths, or credentials.
// - Allows:
//   - Inputs: Validated write-plan values and opaque remote/media identifiers.
//   - Outputs: Exact set/question semantics for a browser-facing runtime.
//   - Side effects: None.
// - Split-When:
//   - Create Set and Add Question gain incompatible browser lifecycles.
// - Merge-When:
//   - Blooket no longer requires browser-form write semantics.
// - Summary:
//   - Fixes observed Blooket field semantics before DOM mechanics.
// - Description:
//   - Media remain opaque slots until the browser runtime resolves uploads.
// - Usage:
//   - Lower canonical write operations before invoking concrete browser forms.
// - Defaults:
//   - Question media slots never invent URLs or local filesystem locations.
//
export const BLOOKET_WRITE_SUBMISSION_VERSION = 1 as const;

export interface BlooketSubmissionMedia {
  readonly mediaId: string;
}

export interface BlooketCreateSetSubmission {
  readonly schemaVersion: typeof BLOOKET_WRITE_SUBMISSION_VERSION;
  readonly kind: "create-set";
  readonly title: string;
  readonly description: string;
  readonly private: boolean;
  readonly coverImage: BlooketSubmissionMedia | null;
}

export type BlooketQuestionAnswerSubmission =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly correct: boolean;
    }
  | {
      readonly kind: "image";
      readonly image: BlooketSubmissionMedia;
      readonly correct: boolean;
    };

export interface BlooketAddQuestionSubmission {
  readonly schemaVersion: typeof BLOOKET_WRITE_SUBMISSION_VERSION;
  readonly kind: "add-question";
  readonly remoteSetId: string;
  readonly number: number;
  readonly question: string;
  readonly answers: readonly BlooketQuestionAnswerSubmission[];
  readonly image: BlooketSubmissionMedia | null;
  readonly audio: "";
  readonly qType: "mc" | "typing";
  readonly random: boolean;
  readonly answerTypes: readonly ("exactly" | "contains")[] | null;
  readonly timeLimit: number;
}

export type BlooketWriteSubmission =
  | BlooketCreateSetSubmission
  | BlooketAddQuestionSubmission;
