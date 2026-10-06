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
//   - Behavioral tests for host-secret names and value bounds.
// - Must-Not:
//   - Invoke Keychain, Secret Service, or subprocesses.
// - Allows:
//   - Inputs: Fixed valid and invalid names and UTF-8 secret values.
//   - Outputs: Deterministic validation verdicts.
//   - Side effects: None.
// - Split-When:
//   - Secret-name and secret-value policies need separate fixture suites.
// - Merge-When:
//   - Host-secret validation is removed.
// - Summary:
//   - Verifies command-safe identifiers and byte-accurate value limits.
// - Description:
//   - Mirrors src/security/host-secrets/domain/host-secret.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - UTF-8 byte length, not JavaScript code-unit length, owns the size limit.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeHostSecretName,
  HOST_SECRET_MAX_BYTES,
  validateHostSecretValue,
} from "../../../../src/security/host-secrets/domain/host-secret.ts";

test("host-secret names admit stable lowercase identifiers", () => {
  for (const value of [
    "blooket-password",
    "session.refresh_token",
    "account_2",
    "a",
  ]) {
    assert.equal(decodeHostSecretName(value).ok, true);
  }
});

test("host-secret names reject command separators and ambiguous forms", () => {
  for (const value of [
    "",
    "-leading",
    "trailing-",
    "Uppercase",
    "contains space",
    "line\nbreak",
    "semi;colon",
    "slash/name",
    "a".repeat(65),
  ]) {
    assert.equal(decodeHostSecretName(value).ok, false);
  }
});

test("host-secret values reject empty and oversized data", () => {
  assert.deepEqual(validateHostSecretValue(""), {
    ok: false,
    code: "host-secret-empty",
  });
  assert.deepEqual(
    validateHostSecretValue("x".repeat(HOST_SECRET_MAX_BYTES + 1)),
    {
      ok: false,
      code: "host-secret-too-large",
    },
  );
});

test("host-secret value limits count UTF-8 bytes", () => {
  const twoByte = "é";
  assert.deepEqual(
    validateHostSecretValue(
      twoByte.repeat(HOST_SECRET_MAX_BYTES / 2),
    ),
    { ok: true },
  );
  assert.deepEqual(
    validateHostSecretValue(
      twoByte.repeat(HOST_SECRET_MAX_BYTES / 2 + 1),
    ),
    {
      ok: false,
      code: "host-secret-too-large",
    },
  );
});
