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
//   - Behavioral tests for structured diagnostic redaction.
// - Must-Not:
//   - Emit logs or test platform secret stores.
// - Allows:
//   - Inputs: Fixed safe, secret, cyclic, and accessor-bearing fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Diagnostic structure limits need independent fixture suites.
// - Merge-When:
//   - Structured diagnostic redaction is removed.
// - Summary:
//   - Verifies that observability boundaries fail closed around secrets.
// - Description:
//   - Mirrors src/security/diagnostic-redaction/domain/redacted-value.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Known secret-bearing key names never preserve their values.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  containsSensitiveDiagnosticText,
  isSensitiveDiagnosticKey,
  redactDiagnosticValue,
} from "../../../../src/security/diagnostic-redaction/domain/redacted-value.ts";

test("secret-bearing fields are redacted recursively", () => {
  const value = redactDiagnosticValue({
    account: {
      password: "teacher-password",
      accessToken: "token-value",
      displayName: "Teacher",
    },
    headers: {
      Authorization: "Bearer secret",
      Cookie: "session=secret",
    },
  });

  assert.deepEqual(value, {
    account: {
      accessToken: "[REDACTED]",
      displayName: "Teacher",
      password: "[REDACTED]",
    },
    headers: {
      Authorization: "[REDACTED]",
      Cookie: "[REDACTED]",
    },
  });
});

test("sensitive key detection is punctuation and case insensitive", () => {
  assert.equal(isSensitiveDiagnosticKey("X-API-Key"), true);
  assert.equal(isSensitiveDiagnosticKey("session_secret"), true);
  assert.equal(isSensitiveDiagnosticKey("questionId"), false);
});

test("diagnostics do not execute property getters", () => {
  let accessed = false;
  const source = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      accessed = true;
      return "unsafe";
    },
  });

  assert.deepEqual(redactDiagnosticValue(source), {
    value: "[ACCESSOR OMITTED]",
  });
  assert.equal(accessed, false);
});

test("diagnostics replace cycles instead of traversing them", () => {
  const source: { self?: unknown } = {};
  source.self = source;

  assert.deepEqual(redactDiagnosticValue(source), {
    self: "[CIRCULAR]",
  });
});


test("secret-looking free text is redacted even under safe keys", () => {
  const value = redactDiagnosticValue({
    detail: "request failed: authorization=Bearer secret-token",
    note: "ordinary diagnostic text",
  });

  assert.deepEqual(value, {
    detail: "[REDACTED]",
    note: "ordinary diagnostic text",
  });
  assert.equal(containsSensitiveDiagnosticText("Bearer abcdef"), true);
  assert.equal(containsSensitiveDiagnosticText("session=abcdef"), true);
  assert.equal(containsSensitiveDiagnosticText("question failed"), false);
});
