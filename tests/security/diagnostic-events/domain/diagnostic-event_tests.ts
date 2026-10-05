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
//   - Behavioral tests for no-secret structured diagnostic events.
// - Must-Not:
//   - Persist logs or inspect secret stores.
// - Allows:
//   - Inputs: Fixed event fields containing safe and sensitive values.
//   - Outputs: Deterministic Node test verdicts and serialized JSON Lines.
//   - Side effects: None.
// - Split-When:
//   - Persistent diagnostic sink behavior gains independent fixtures.
// - Merge-When:
//   - Canonical diagnostic events are removed.
// - Summary:
//   - Verifies stable event validation and secret-free serialization.
// - Description:
//   - Mirrors src/security/diagnostic-events/domain/diagnostic-event.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Events contain codes and redacted fields, not arbitrary messages.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  createDiagnosticEvent,
  serializeDiagnosticEvent,
} from "../../../../src/security/diagnostic-events/domain/diagnostic-event.ts";

test("diagnostic events redact key-based and embedded secrets", () => {
  const result = createDiagnosticEvent({
    at: "2026-10-05T10:45:00.000Z",
    level: "error",
    code: "browser.request.failed",
    operationId: "browser:request-1",
    fields: {
      authorization: "Bearer first-secret",
      detail: "upstream token=second-secret",
      state: "authenticated",
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    const serialized = serializeDiagnosticEvent(result.value);
    assert.equal(serialized.includes("first-secret"), false);
    assert.equal(serialized.includes("second-secret"), false);
    assert.match(serialized, /"state":"authenticated"/u);
    assert.equal(serialized.endsWith("\n"), true);
  }
});

test("diagnostic events reject arbitrary diagnostic codes", () => {
  const result = createDiagnosticEvent({
    at: "2026-10-05T10:45:00Z",
    level: "info",
    code: "Contains Spaces",
  });

  assert.equal(result.ok, false);
});

test("diagnostic events reject invalid operation identifiers", () => {
  const result = createDiagnosticEvent({
    at: "2026-10-05T10:45:00Z",
    level: "warn",
    code: "operation.failed",
    operationId: "Uppercase Is Rejected",
  });

  assert.equal(result.ok, false);
});

test("diagnostic events reject impossible timestamps", () => {
  const result = createDiagnosticEvent({
    at: "not-a-time",
    level: "debug",
    code: "debug.event",
  });

  assert.equal(result.ok, false);
});
