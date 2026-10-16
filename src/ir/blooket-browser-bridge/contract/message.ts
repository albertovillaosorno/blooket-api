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
//   - Versioned local WebExtension bridge commands and response decoding.
// - Must-Not:
//   - Store credentials, choose selectors, navigate, or trust extension
//     replies.
// - Allows:
//   - Inputs: Internal commands and unknown extension response candidates.
//   - Outputs: Exact bridge requests or validated stable response envelopes.
//   - Side effects: None.
// - Split-When:
//   - Browser writes need an incompatible protocol family.
// - Merge-When:
//   - Browser automation no longer crosses a local extension boundary.
// - Summary:
//   - Keeps local browser transport versioned and fail-closed.
// - Description:
//   - Authentication credentials are request-only and never part of responses.
// - Usage:
//   - Generate requests in the local service and decode every extension reply.
// - Defaults:
//   - Unknown fields, IDs, versions, and failure codes are rejected.
//
import type {
  DecodeResult,
  ValidationIssue,
} from "../../runtime-decoding/domain/decode-result.ts";
import {
  snapshotExactDenseArray,
  isRecord,
  ownDataField,
  requiredString,
  unknownFieldIssues,
} from "../../runtime-decoding/domain/exact-object.ts";
import {
  decodeBlooketPreparedImage, type BlooketPreparedImage,
} from "./prepared-image.ts";

export const BLOOKET_BROWSER_BRIDGE_VERSION = 1 as const;
export const BLOOKET_BROWSER_CLIENT_HEADER = "x-blooket-browser-client";

// Chrome may omit Origin on GET while sending it on POST. The bearer token
// remains the authority; this bounded transport label correlates both calls.
export function decodeBlooketBrowserClient(
  value: unknown,
): DecodeResult<string> {
  if (typeof value === "string" && value.length <= 200) {
    try {
      const url = new URL(value);
      if (["chrome-extension:", "safari-web-extension:"].includes(
        url.protocol,
      ) && /^[a-z0-9-]{1,128}$/iu.test(url.hostname) &&
          url.host === url.hostname && !url.username && !url.password &&
          url.pathname === "/" && !url.search &&
          (!url.hash || /^#[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
            .test(url.hash)) && url.href === value)
        return { ok: true, value };
    } catch { /* Invalid labels never become transport identities. */ }
  }
  return failure("$.client", "invalid-browser-client",
    "Expected a bounded extension root URL.");
}

export type BlooketBrowserBridgeOperation =
  | "browser.activate"
  | "session.observe"
  | "session.authenticate"
  | "capabilities.inspect"
  | "capabilities.inspect-text"
  | "writes.inspect"
  | "sets.list"
  | "sets.get"
  | "questions.list"
  | "sets.create"
  | "questions.create";

export type BlooketBrowserBridgeCommand =
  | { readonly kind: "browser.activate" }
  | { readonly kind: "session.observe" }
  | {
      readonly kind: "session.authenticate";
      readonly loginIdentifier: string;
      readonly password: string;
    }
  | { readonly kind: "capabilities.inspect" }
  | { readonly kind: "capabilities.inspect-text" }
  | { readonly kind: "writes.inspect" }
  | { readonly kind: "sets.list" }
  | { readonly kind: "sets.get"; readonly setId: string }
  | { readonly kind: "questions.list"; readonly setId: string }
  | {
      readonly kind: "sets.create";
      readonly title: string;
      readonly description: string;
      readonly private: boolean;
    }
  | {
      readonly kind: "questions.create";
      readonly setId: string;
      readonly number: number;
      readonly question: string;
      readonly answers: readonly {
        readonly text: string;
        readonly correct: boolean;
      }[];
      readonly qType: "mc" | "typing";
      readonly random: boolean;
      readonly answerTypes: readonly ("exactly" | "contains")[] | null;
      readonly timeLimit: number;
      readonly image?: BlooketPreparedImage;
    };

export interface BlooketBrowserBridgeRequest {
  readonly schemaVersion: typeof BLOOKET_BROWSER_BRIDGE_VERSION;
  readonly id: string;
  readonly command: BlooketBrowserBridgeCommand;
}

export type BlooketBrowserBridgeResponse =
  | {
      readonly schemaVersion: typeof BLOOKET_BROWSER_BRIDGE_VERSION;
      readonly id: string;
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly schemaVersion: typeof BLOOKET_BROWSER_BRIDGE_VERSION;
      readonly id: string;
      readonly ok: false;
      readonly code: "blooket-browser-unavailable" | "blooket-browser-failed";
    };

const SUCCESS_KEYS = new Set(["schemaVersion", "id", "ok", "value"]);
const FAILURE_KEYS = new Set(["schemaVersion", "id", "ok", "code"]);

export function decodeBlooketBrowserBridgeRequest(
  value: unknown,
): DecodeResult<BlooketBrowserBridgeRequest> {
  if (!isRecord(value))
    return failure("$", "expected-object", "Expected a browser request.");
  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(
      value,
      new Set(["schemaVersion", "id", "command"]),
      "$",
    ),
  ];
  if (ownDataField(value, "schemaVersion") !== BLOOKET_BROWSER_BRIDGE_VERSION)
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected browser bridge version 1.",
    });
  const id = requiredString(ownDataField(value, "id"), "$.id", issues);
  if (id && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id))
    issues.push({
      path: "$.id",
      code: "invalid-job-id",
      message: "Expected an opaque browser job UUID.",
    });
  const candidate = ownDataField(value, "command");
  if (!isRecord(candidate))
    return failure(
      "$.command",
      "expected-object",
      "Expected a browser command.",
    );
  const kind = ownDataField(candidate, "kind");
  let command: BlooketBrowserBridgeCommand | undefined;
  let keys = ["kind"];
  if (
    kind === "browser.activate" ||
    kind === "session.observe" ||
    kind === "capabilities.inspect" ||
    kind === "capabilities.inspect-text" ||
    kind === "writes.inspect" ||
    kind === "sets.list"
  )
    command = { kind };
  else if (kind === "sets.get" || kind === "questions.list") {
    keys = ["kind", "setId"];
    const setId = requiredString(
      ownDataField(candidate, "setId"), "$.command.setId", issues,
    );
    if (setId && setId.length <= 512 && !/[\x00-\x1f\x7f]/u.test(setId))
      command = { kind, setId };
    else
      issues.push({
        path: "$.command.setId",
        code: "invalid-set-id",
        message: "Expected a bounded opaque set ID.",
      });
  } else if (kind === "sets.create") {
    keys = ["kind", "title", "description", "private"];
    const title = requiredString(
      ownDataField(candidate, "title"), "$.command.title", issues,
    );
    const description = ownDataField(candidate, "description");
    const privateValue = ownDataField(candidate, "private");
    if (
      title && title.trim() &&
      title.length <= 1_000 &&
      !/[\x00-\x1f\x7f]/u.test(title) &&
      typeof description === "string" &&
      description.length <= 10_000 &&
      !/[\x00\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(description) &&
      !description.includes("\r") &&
      typeof privateValue === "boolean"
    ) {
      command = {
        kind,
        title,
        description,
        private: privateValue,
      };
    } else {
      issues.push({
        path: "$.command",
        code: "invalid-create-set-input",
        message: "Expected bounded text-only Create Set fields.",
      });
    }
  } else if (kind === "questions.create") {
    keys = [
      "kind",
      "setId",
      "number",
      "question",
      "answers",
      "qType",
      "random",
      "answerTypes",
      "timeLimit",
      "image",
    ];
    const setId = requiredString(
      ownDataField(candidate, "setId"), "$.command.setId", issues,
    );
    const question = requiredString(
      ownDataField(candidate, "question"),
      "$.command.question",
      issues,
    );
    const number = ownDataField(candidate, "number");
    const answersCandidate = ownDataField(candidate, "answers");
    const qType = ownDataField(candidate, "qType");
    const random = ownDataField(candidate, "random");
    const answerTypesCandidate = ownDataField(candidate, "answerTypes");
    const timeLimit = ownDataField(candidate, "timeLimit");
    const image = Object.hasOwn(candidate, "image")
      ? decodeBlooketPreparedImage(
          ownDataField(candidate, "image"), "$.command.image",
        )
      : undefined;
    if (image && !image.ok) issues.push(...image.issues);
    const answers: { text: string; correct: boolean }[] = [];
    const seen = new Set<string>();
    const ownedAnswers = snapshotExactDenseArray(answersCandidate, 100);
    if (ownedAnswers) {
      for (let index = 0; index < ownedAnswers.length; index++) {
        const answer = ownedAnswers[index];
        if (!isRecord(answer)) {
          issues.push({
            path: "$.command.answers[" + index + "]",
            code: "invalid-question-answer",
            message: "Expected one text answer object.",
          });
          continue;
        }
        issues.push(
          ...unknownFieldIssues(
            answer,
            new Set(["text", "correct"]),
            "$.command.answers[" + index + "]",
          ),
        );
        const text = requiredString(
          ownDataField(answer, "text"),
          "$.command.answers[" + index + "].text",
          issues,
        );
        const correct = ownDataField(answer, "correct");
        if (
          text && text.trim() &&
          text.length <= 10_000 &&
          !text.includes("\0") && !text.includes("\r") &&
          !text.includes("`*") && !text.includes("`~`") &&
          (qType !== "typing" || !text.includes("\n")) &&
          !seen.has(text) &&
          typeof correct === "boolean"
        ) {
          seen.add(text);
          answers.push({ text, correct });
        } else {
          issues.push({
            path: "$.command.answers[" + index + "]",
            code: "invalid-question-answer",
            message: "Expected one unique bounded text answer.",
          });
        }
      }
    } else {
      issues.push({
        path: "$.command.answers",
        code: "invalid-question-answers",
        message: "Expected a bounded text answer list.",
      });
    }
    const admittedModes = (): ("exactly" | "contains")[] | undefined => {
      const captured = snapshotExactDenseArray(answerTypesCandidate, 100);
      if (!captured) return undefined;
      const modes: ("exactly" | "contains")[] = [];
      for (let index = 0; index < captured.length; index++) {
        const match = captured[index];
        if (match !== "exactly" && match !== "contains") return undefined;
        modes.push(match);
      }
      return modes;
    };
    const answerTypes = answerTypesCandidate === null ? null
      : admittedModes();
    const correctCount = answers.filter((answer) => answer.correct).length;
    const typingValid =
      qType === "typing" &&
      random === true &&
      answers.length >= 1 &&
      correctCount === answers.length &&
      Array.isArray(answerTypes) &&
      answerTypes.length === answers.length;
    const mcValid =
      qType === "mc" &&
      typeof random === "boolean" &&
      answers.length >= 2 &&
      answers.length <= 4 &&
      correctCount >= 1 &&
      answerTypes === null;
    if (
      setId &&
      setId.length <= 512 &&
      !/[\x00-\x1f\x7f]/u.test(setId) &&
      question && question.trim() &&
      question.length <= 20_000 &&
      !question.includes("\0") && !question.includes("\r") &&
      !question.includes("`*") && !question.includes("`~`") &&
      Number.isSafeInteger(number) &&
      (number as number) >= 1 &&
      (number as number) <= 200 &&
      Number.isSafeInteger(timeLimit) &&
      (timeLimit as number) >= 1 &&
      (timeLimit as number) <= 86_400 &&
      (typingValid || mcValid)
    ) {
      command = {
        kind,
        setId,
        number: number as number,
        question,
        answers,
        qType: qType as "mc" | "typing",
        random: random as boolean,
        answerTypes: answerTypes as
          readonly ("exactly" | "contains")[] | null,
        timeLimit: timeLimit as number,
        ...(image?.ok ? { image: image.value } : {}),
      };
    } else {
      issues.push({
        path: "$.command",
        code: "invalid-create-question-input",
        message: "Expected bounded text-only Add Question fields.",
      });
    }
  } else if (kind === "session.authenticate") {
    keys = ["kind", "loginIdentifier", "password"];
    const loginIdentifier = requiredString(
      ownDataField(candidate, "loginIdentifier"),
      "$.command.loginIdentifier",
      issues,
    );
    const password = requiredString(
      ownDataField(candidate, "password"),
      "$.command.password",
      issues,
    );
    if (
      loginIdentifier &&
      password &&
      loginIdentifier.length <= 254 &&
      password.length <= 2048 &&
      !loginIdentifier.includes("\0") &&
      !password.includes("\0")
    )
      command = { kind, loginIdentifier, password };
    else
      issues.push({
        path: "$.command",
        code: "invalid-login-input",
        message: "Expected bounded authentication fields.",
      });
  } else
    issues.push({
      path: "$.command.kind",
      code: "unknown-browser-command",
      message: "Unsupported browser operation.",
    });
  issues.push(...unknownFieldIssues(candidate, new Set(keys), "$.command"));
  if (issues.length || !id || !command) return { ok: false, issues };
  return {
    ok: true,
    value: { schemaVersion: BLOOKET_BROWSER_BRIDGE_VERSION, id, command },
  };
}

export function decodeBlooketBrowserBridgeResponse(
  value: unknown,
  expectedId: string,
): DecodeResult<BlooketBrowserBridgeResponse> {
  if (!isRecord(value)) {
    return failure("$", "expected-object", "Expected a bridge response.");
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(
      value,
      ownDataField(value, "ok") === true ? SUCCESS_KEYS : FAILURE_KEYS,
      "$",
    ),
  ];
  if (ownDataField(value, "schemaVersion") !== BLOOKET_BROWSER_BRIDGE_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected Blooket browser bridge version 1.",
    });
  }
  const id = requiredString(ownDataField(value, "id"), "$.id", issues);
  if (id !== undefined && id !== expectedId) {
    issues.push({
      path: "$.id",
      code: "bridge-response-id-mismatch",
      message: "Bridge response does not match the pending request.",
    });
  }

  if (ownDataField(value, "ok") === true) {
    if (!Object.prototype.hasOwnProperty.call(value, "value")) {
      issues.push({
        path: "$.value",
        code: "missing-field",
        message: "Successful bridge responses require a value.",
      });
    }
    if (issues.length > 0 || id === undefined) {
      return { ok: false, issues };
    }
    return {
      ok: true,
      value: {
        schemaVersion: BLOOKET_BROWSER_BRIDGE_VERSION,
        id,
        ok: true,
        value: ownDataField(value, "value"),
      },
    };
  }

  if (ownDataField(value, "ok") !== false) {
    issues.push({
      path: "$.ok",
      code: "expected-boolean",
      message: "Expected true or false.",
    });
  }
  const code = ownDataField(value, "code");
  if (
    code !== "blooket-browser-unavailable" &&
    code !== "blooket-browser-failed"
  ) {
    issues.push({
      path: "$.code",
      code: "invalid-browser-failure-code",
      message: "Expected a stable Blooket browser failure code.",
    });
  }
  if (
    issues.length > 0 ||
    id === undefined ||
    (code !== "blooket-browser-unavailable" &&
      code !== "blooket-browser-failed")
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      schemaVersion: BLOOKET_BROWSER_BRIDGE_VERSION,
      id,
      ok: false,
      code,
    },
  };
}

function failure<T>(
  path: string,
  code: string,
  message: string,
): DecodeResult<T> {
  return { ok: false, issues: [{ path, code, message }] };
}
