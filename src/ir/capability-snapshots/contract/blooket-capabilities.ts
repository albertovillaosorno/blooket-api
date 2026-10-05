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
//   - Version-one snapshots of verified Blooket and account capabilities.
// - Must-Not:
//   - Probe Blooket, infer account tier, or invent unknown capability values.
// - Allows:
//   - Inputs: Unknown runtime capability-snapshot candidates.
//   - Outputs: Strict snapshots or structured validation failures.
//   - Side effects: None.
// - Split-When:
//   - Platform and account capabilities require independent snapshot
//     lifecycles.
// - Merge-When:
//   - Blooket execution no longer needs explicit capability evidence.
// - Summary:
//   - Versions capability facts separately from project and command schemas.
// - Description:
//   - Keeps unsupported, account-dependent, and unknown facts distinguishable.
// - Usage:
//   - Validate a snapshot before admitting account-dependent project features.
// - Defaults:
//   - Unknown upload limits remain null instead of being guessed.
//
import {
  decodeFailure,
  type DecodeResult,
  type ValidationIssue,
} from "../../runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../runtime-decoding/domain/exact-object.ts";

export const BLOOKET_CAPABILITIES_VERSION = 1 as const;

export type CapabilityAvailability =
  | "supported"
  | "unsupported"
  | "account-dependent"
  | "unknown";

export interface CapabilityEvidence {
  readonly kind: "official-doc" | "browser-observation";
  readonly reference: string;
}

export interface BlooketCapabilitySnapshot {
  readonly schemaVersion: typeof BLOOKET_CAPABILITIES_VERSION;
  readonly verifiedOn: string;
  readonly evidence: readonly CapabilityEvidence[];
  readonly questionTypes: {
    readonly multipleChoice: {
      readonly availability: CapabilityAvailability;
      readonly minAnswers: number | null;
      readonly maxAnswers: number | null;
      readonly requiresQuestionText: boolean | null;
      readonly allowsMultipleCorrect: boolean | null;
    };
    readonly typingAnswer: {
      readonly availability: CapabilityAvailability;
      readonly matchModes: readonly ("exact" | "contains")[];
    };
  };
  readonly features: {
    readonly questionImages: CapabilityAvailability;
    readonly answerImages: CapabilityAvailability;
    readonly audio: CapabilityAvailability;
  };
  readonly setMetadata: {
    readonly titleRequired: boolean | null;
    readonly descriptionRequired: boolean | null;
    readonly coverImageOptional: boolean | null;
    readonly visibility: readonly ("public" | "private")[];
  };
  readonly upload: {
    readonly maxBytes: number | null;
  };
}

const ROOT_KEYS = new Set([
  "schemaVersion",
  "verifiedOn",
  "evidence",
  "questionTypes",
  "features",
  "setMetadata",
  "upload",
]);
const EVIDENCE_KEYS = new Set(["kind", "reference"]);
const QUESTION_TYPE_KEYS = new Set(["multipleChoice", "typingAnswer"]);
const MULTIPLE_CHOICE_KEYS = new Set([
  "availability",
  "minAnswers",
  "maxAnswers",
  "requiresQuestionText",
  "allowsMultipleCorrect",
]);
const TYPING_ANSWER_KEYS = new Set(["availability", "matchModes"]);
const FEATURE_KEYS = new Set(["questionImages", "answerImages", "audio"]);
const SET_METADATA_KEYS = new Set([
  "titleRequired",
  "descriptionRequired",
  "coverImageOptional",
  "visibility",
]);
const UPLOAD_KEYS = new Set(["maxBytes"]);

export function decodeBlooketCapabilitySnapshot(
  value: unknown,
): DecodeResult<BlooketCapabilitySnapshot> {
  if (!isRecord(value)) {
    return decodeFailure(
      "$",
      "expected-object",
      "Expected capability snapshot.",
    );
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, ROOT_KEYS, "$"),
  ];
  if (value["schemaVersion"] !== BLOOKET_CAPABILITIES_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected Blooket capability schema version 1.",
    });
  }

  const verifiedOn = decodeIsoDate(value["verifiedOn"], "$.verifiedOn", issues);
  const evidence = decodeEvidence(value["evidence"], issues);
  const questionTypes = decodeQuestionTypes(value["questionTypes"], issues);
  const features = decodeFeatures(value["features"], issues);
  const setMetadata = decodeSetMetadata(value["setMetadata"], issues);
  const upload = decodeUpload(value["upload"], issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  if (
    verifiedOn === undefined
    || evidence === undefined
    || questionTypes === undefined
    || features === undefined
    || setMetadata === undefined
    || upload === undefined
  ) {
    return decodeFailure("$", "decoder-invariant", "Decoder invariant failed.");
  }

  return {
    ok: true,
    value: {
      schemaVersion: BLOOKET_CAPABILITIES_VERSION,
      verifiedOn,
      evidence,
      questionTypes,
      features,
      setMetadata,
      upload,
    },
  };
}

function decodeEvidence(
  value: unknown,
  issues: ValidationIssue[],
): readonly CapabilityEvidence[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({
      path: "$.evidence",
      code: "expected-evidence",
      message: "Expected at least one capability evidence item.",
    });
    return undefined;
  }

  const evidence: CapabilityEvidence[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `$.evidence[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({
        path,
        code: "expected-object",
        message: "Expected evidence.",
      });
      continue;
    }
    issues.push(...unknownFieldIssues(candidate, EVIDENCE_KEYS, path));
    const kind = candidate["kind"];
    const reference = requiredString(
      candidate["reference"],
      `${path}.reference`,
      issues,
    );
    if (kind !== "official-doc" && kind !== "browser-observation") {
      issues.push({
        path: `${path}.kind`,
        code: "invalid-evidence-kind",
        message: 'Expected "official-doc" or "browser-observation".',
      });
    }
    if (
      reference !== undefined
      && (kind === "official-doc" || kind === "browser-observation")
    ) {
      evidence.push({ kind, reference });
    }
  }
  return evidence;
}

function decodeQuestionTypes(
  value: unknown,
  issues: ValidationIssue[],
): BlooketCapabilitySnapshot["questionTypes"] | undefined {
  if (!isRecord(value)) {
    issues.push({
      path: "$.questionTypes",
      code: "expected-object",
      message: "Expected question type capabilities.",
    });
    return undefined;
  }
  issues.push(
    ...unknownFieldIssues(value, QUESTION_TYPE_KEYS, "$.questionTypes"),
  );

  const multipleChoice = decodeMultipleChoice(value["multipleChoice"], issues);
  const typingAnswer = decodeTypingAnswer(value["typingAnswer"], issues);
  if (multipleChoice === undefined || typingAnswer === undefined) {
    return undefined;
  }
  return { multipleChoice, typingAnswer };
}

function decodeMultipleChoice(
  value: unknown,
  issues: ValidationIssue[],
): BlooketCapabilitySnapshot["questionTypes"]["multipleChoice"] | undefined {
  const path = "$.questionTypes.multipleChoice";
  if (!isRecord(value)) {
    issues.push({
      path,
      code: "expected-object",
      message: "Expected capabilities.",
    });
    return undefined;
  }
  issues.push(...unknownFieldIssues(value, MULTIPLE_CHOICE_KEYS, path));

  const availability = decodeAvailability(
    value["availability"],
    `${path}.availability`,
    issues,
  );
  const minAnswers = decodeNullablePositiveInteger(
    value["minAnswers"],
    `${path}.minAnswers`,
    issues,
  );
  const maxAnswers = decodeNullablePositiveInteger(
    value["maxAnswers"],
    `${path}.maxAnswers`,
    issues,
  );
  const requiresQuestionText = decodeNullableBoolean(
    value["requiresQuestionText"],
    `${path}.requiresQuestionText`,
    issues,
  );
  const allowsMultipleCorrect = decodeNullableBoolean(
    value["allowsMultipleCorrect"],
    `${path}.allowsMultipleCorrect`,
    issues,
  );

  if (
    minAnswers !== undefined
    && minAnswers !== null
    && maxAnswers !== undefined
    && maxAnswers !== null
    && minAnswers > maxAnswers
  ) {
    issues.push({
      path,
      code: "invalid-answer-range",
      message: "Minimum answers may not exceed maximum answers.",
    });
  }

  if (
    availability === undefined
    || minAnswers === undefined
    || maxAnswers === undefined
    || requiresQuestionText === undefined
    || allowsMultipleCorrect === undefined
  ) {
    return undefined;
  }
  return {
    availability,
    minAnswers,
    maxAnswers,
    requiresQuestionText,
    allowsMultipleCorrect,
  };
}

function decodeTypingAnswer(
  value: unknown,
  issues: ValidationIssue[],
): BlooketCapabilitySnapshot["questionTypes"]["typingAnswer"] | undefined {
  const path = "$.questionTypes.typingAnswer";
  if (!isRecord(value)) {
    issues.push({
      path,
      code: "expected-object",
      message: "Expected capabilities.",
    });
    return undefined;
  }
  issues.push(...unknownFieldIssues(value, TYPING_ANSWER_KEYS, path));
  const availability = decodeAvailability(
    value["availability"],
    `${path}.availability`,
    issues,
  );
  const matchModes = decodeEnumArray(
    value["matchModes"],
    `${path}.matchModes`,
    new Set(["exact", "contains"]),
    issues,
  ) as readonly ("exact" | "contains")[] | undefined;
  if (availability === undefined || matchModes === undefined) {
    return undefined;
  }
  return { availability, matchModes };
}

function decodeFeatures(
  value: unknown,
  issues: ValidationIssue[],
): BlooketCapabilitySnapshot["features"] | undefined {
  if (!isRecord(value)) {
    issues.push({
      path: "$.features",
      code: "expected-object",
      message: "Expected feature capabilities.",
    });
    return undefined;
  }
  issues.push(...unknownFieldIssues(value, FEATURE_KEYS, "$.features"));
  const questionImages = decodeAvailability(
    value["questionImages"],
    "$.features.questionImages",
    issues,
  );
  const answerImages = decodeAvailability(
    value["answerImages"],
    "$.features.answerImages",
    issues,
  );
  const audio = decodeAvailability(value["audio"], "$.features.audio", issues);
  if (
    questionImages === undefined
    || answerImages === undefined
    || audio === undefined
  ) {
    return undefined;
  }
  return { questionImages, answerImages, audio };
}

function decodeSetMetadata(
  value: unknown,
  issues: ValidationIssue[],
): BlooketCapabilitySnapshot["setMetadata"] | undefined {
  if (!isRecord(value)) {
    issues.push({
      path: "$.setMetadata",
      code: "expected-object",
      message: "Expected set metadata capabilities.",
    });
    return undefined;
  }
  issues.push(...unknownFieldIssues(value, SET_METADATA_KEYS, "$.setMetadata"));
  const titleRequired = decodeNullableBoolean(
    value["titleRequired"],
    "$.setMetadata.titleRequired",
    issues,
  );
  const descriptionRequired = decodeNullableBoolean(
    value["descriptionRequired"],
    "$.setMetadata.descriptionRequired",
    issues,
  );
  const coverImageOptional = decodeNullableBoolean(
    value["coverImageOptional"],
    "$.setMetadata.coverImageOptional",
    issues,
  );
  const visibility = decodeEnumArray(
    value["visibility"],
    "$.setMetadata.visibility",
    new Set(["public", "private"]),
    issues,
  ) as readonly ("public" | "private")[] | undefined;
  if (
    titleRequired === undefined
    || descriptionRequired === undefined
    || coverImageOptional === undefined
    || visibility === undefined
  ) {
    return undefined;
  }
  return {
    titleRequired,
    descriptionRequired,
    coverImageOptional,
    visibility,
  };
}

function decodeUpload(
  value: unknown,
  issues: ValidationIssue[],
): BlooketCapabilitySnapshot["upload"] | undefined {
  if (!isRecord(value)) {
    issues.push({
      path: "$.upload",
      code: "expected-object",
      message: "Expected upload capabilities.",
    });
    return undefined;
  }
  issues.push(...unknownFieldIssues(value, UPLOAD_KEYS, "$.upload"));
  const maxBytes = decodeNullablePositiveInteger(
    value["maxBytes"],
    "$.upload.maxBytes",
    issues,
  );
  return maxBytes === undefined ? undefined : { maxBytes };
}

function decodeAvailability(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): CapabilityAvailability | undefined {
  if (
    value === "supported"
    || value === "unsupported"
    || value === "account-dependent"
    || value === "unknown"
  ) {
    return value;
  }
  issues.push({
    path,
    code: "invalid-availability",
    message: "Expected a known capability availability value.",
  });
  return undefined;
}

function decodeNullableBoolean(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): boolean | null | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  issues.push({
    path,
    code: "expected-nullable-boolean",
    message: "Expected boolean or null.",
  });
  return undefined;
}

function decodeNullablePositiveInteger(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  issues.push({
    path,
    code: "expected-nullable-positive-integer",
    message: "Expected a positive safe integer or null.",
  });
  return undefined;
}

function decodeEnumArray(
  value: unknown,
  path: string,
  admitted: ReadonlySet<string>,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      code: "expected-array",
      message: "Expected an array.",
    });
    return undefined;
  }
  const decoded: string[] = [];
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== "string" || !admitted.has(candidate)) {
      issues.push({
        path: `${path}[${index}]`,
        code: "invalid-enum-value",
        message: "Value is not admitted by this capability contract.",
      });
      continue;
    }
    decoded.push(candidate);
  }
  if (new Set(decoded).size !== decoded.length) {
    issues.push({
      path,
      code: "duplicate-enum-value",
      message: "Capability values must be unique.",
    });
  }
  return decoded;
}

function decodeIsoDate(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    issues.push({
      path,
      code: "invalid-date",
      message: "Expected YYYY-MM-DD.",
    });
    return undefined;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    issues.push({
      path,
      code: "invalid-date",
      message: "Expected YYYY-MM-DD.",
    });
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) {
    issues.push({
      path,
      code: "invalid-date",
      message: "Expected a real date.",
    });
    return undefined;
  }
  return value;
}
