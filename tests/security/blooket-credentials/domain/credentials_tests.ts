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
//   - Behavioral tests for conditional Blooket credential retrieval.
// - Must-Not:
//   - Touch a real host secret store or print fixture credentials.
// - Allows:
//   - Inputs: Fake host-secret stores with deterministic reads.
//   - Outputs: Credential retrieval and secret-free failure verdicts.
//   - Side effects: In-memory read tracking only.
// - Split-When:
//   - Authentication methods need separate credential fixture suites.
// - Merge-When:
//   - Blooket stored credentials are removed.
// - Summary:
//   - Proves ordered minimal reads and exact non-secret failures.
// - Description:
//   - Mirrors src/security/blooket-credentials/domain/credentials.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - A missing login identifier prevents a password-store read.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOOKET_LOGIN_IDENTIFIER_SECRET,
  BLOOKET_PASSWORD_SECRET,
  readBlooketCredentials,
} from
  "../../../../src/security/blooket-credentials/domain/credentials.ts";
import type {
  HostSecretReadResult,
  HostSecretStore,
} from "../../../../src/security/host-secrets/domain/host-secret.ts";

function fakeStore(
  values: Readonly<Record<string, HostSecretReadResult>>,
  reads: string[],
): HostSecretStore {
  return {
    read: async (name) => {
      reads.push(name);
      return values[name] ?? { ok: true, kind: "missing" };
    },
    write: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
  };
}

test("credentials are read in identifier then password order", async () => {
  const reads: string[] = [];
  const result = await readBlooketCredentials(fakeStore({
    [BLOOKET_LOGIN_IDENTIFIER_SECRET]: {
      ok: true,
      kind: "found",
      secret: "teacher@example.test",
    },
    [BLOOKET_PASSWORD_SECRET]: {
      ok: true,
      kind: "found",
      secret: "fixture-password",
    },
  }, reads));

  assert.deepEqual(reads, [
    BLOOKET_LOGIN_IDENTIFIER_SECRET,
    BLOOKET_PASSWORD_SECRET,
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      loginIdentifier: "teacher@example.test",
      password: "fixture-password",
    },
  });
});

test("a missing identifier prevents a password read", async () => {
  const reads: string[] = [];
  const result = await readBlooketCredentials(
    fakeStore({}, reads),
  );

  assert.deepEqual(reads, [BLOOKET_LOGIN_IDENTIFIER_SECRET]);
  assert.deepEqual(result, {
    ok: false,
    code: "blooket-credentials-missing",
  });
});

test("a missing password returns the same secret-free failure", async () => {
  const reads: string[] = [];
  const result = await readBlooketCredentials(fakeStore({
    [BLOOKET_LOGIN_IDENTIFIER_SECRET]: {
      ok: true,
      kind: "found",
      secret: "teacher@example.test",
    },
  }, reads));

  assert.deepEqual(reads, [
    BLOOKET_LOGIN_IDENTIFIER_SECRET,
    BLOOKET_PASSWORD_SECRET,
  ]);
  assert.deepEqual(result, {
    ok: false,
    code: "blooket-credentials-missing",
  });
});

test("host-secret failures propagate without later reads", async () => {
  const reads: string[] = [];
  const result = await readBlooketCredentials(fakeStore({
    [BLOOKET_LOGIN_IDENTIFIER_SECRET]: {
      ok: false,
      code: "host-secret-store-unavailable",
    },
  }, reads));

  assert.deepEqual(reads, [BLOOKET_LOGIN_IDENTIFIER_SECRET]);
  assert.deepEqual(result, {
    ok: false,
    code: "host-secret-store-unavailable",
  });
});
