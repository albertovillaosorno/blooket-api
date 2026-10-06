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
import type { DecodeResult, ValidationIssue } from
  "../../runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../runtime-decoding/domain/exact-object.ts";

export const BLOOKET_BROWSER_BRIDGE_VERSION = 1 as const;

export type BlooketBrowserBridgeOperation =
  | "session.observe"
  | "session.authenticate"
  | "capabilities.inspect"
  | "sets.list"
  | "sets.get"
  | "questions.list";

export type BlooketBrowserBridgeCommand =
  | { readonly kind: "session.observe" }
  | {
      readonly kind: "session.authenticate";
      readonly loginIdentifier: string;
      readonly password: string;
    }
  | { readonly kind: "capabilities.inspect" }
  | { readonly kind: "sets.list" }
  | { readonly kind: "sets.get"; readonly setId: string }
  | { readonly kind: "questions.list"; readonly setId: string };

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
      readonly code:
        | "blooket-browser-unavailable"
        | "blooket-browser-failed";
    };

const SUCCESS_KEYS = new Set(["schemaVersion", "id", "ok", "value"]);
const FAILURE_KEYS = new Set(["schemaVersion", "id", "ok", "code"]);

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
      value["ok"] === true ? SUCCESS_KEYS : FAILURE_KEYS,
      "$",
    ),
  ];
  if (value["schemaVersion"] !== BLOOKET_BROWSER_BRIDGE_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected Blooket browser bridge version 1.",
    });
  }
  const id = requiredString(value["id"], "$.id", issues);
  if (id !== undefined && id !== expectedId) {
    issues.push({
      path: "$.id",
      code: "bridge-response-id-mismatch",
      message: "Bridge response does not match the pending request.",
    });
  }

  if (value["ok"] === true) {
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
        value: value["value"],
      },
    };
  }

  if (value["ok"] !== false) {
    issues.push({
      path: "$.ok",
      code: "expected-boolean",
      message: "Expected true or false.",
    });
  }
  const code = value["code"];
  if (
    code !== "blooket-browser-unavailable"
    && code !== "blooket-browser-failed"
  ) {
    issues.push({
      path: "$.code",
      code: "invalid-browser-failure-code",
      message: "Expected a stable Blooket browser failure code.",
    });
  }
  if (
    issues.length > 0
    || id === undefined
    || (
      code !== "blooket-browser-unavailable"
      && code !== "blooket-browser-failed"
    )
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
