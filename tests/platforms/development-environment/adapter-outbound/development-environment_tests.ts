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
//   - Behavioral tests for explicit development-environment adaptation.
// - Must-Not:
//   - Read the real process environment or persist secret values.
// - Allows:
//   - Inputs: Fixed in-memory environment maps.
//   - Outputs: Secret/port adapter verdicts.
//   - Side effects: None.
// - Split-When:
//   - Development environment surfaces gain independent lifecycles.
// - Merge-When:
//   - Environment-backed development inputs are removed.
// - Summary:
//   - Proves dev-only values cannot expand production secret semantics.
// - Description:
//   - Covers canonical secret mapping and strict local-port parsing.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Empty variables are equivalent to absent development configuration.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  createDevelopmentEnvironmentSecretStore,
  readDevelopmentLocalPort,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/development-environment/adapter-outbound/development-environment.ts";
import {
  BLOOKET_LOGIN_IDENTIFIER_SECRET,
  BLOOKET_PASSWORD_SECRET,
} from
  "../../../../src/security/blooket-credentials/domain/credentials.ts";
import { HOST_SECRET_MAX_BYTES } from
  "../../../../src/security/host-secrets/domain/host-secret.ts";

test(
  "development credentials map only to canonical Blooket secrets",
  async () => {
  const store = createDevelopmentEnvironmentSecretStore({
    EMAIL: "teacher@example.test",
    PASSWORD: "fixture-password",
    OTHER_SECRET: "must-not-cross",
  });

  assert.deepEqual(await store.read(BLOOKET_LOGIN_IDENTIFIER_SECRET), {
    ok: true,
    kind: "found",
    secret: "teacher@example.test",
  });
  assert.deepEqual(await store.read(BLOOKET_PASSWORD_SECRET), {
    ok: true,
    kind: "found",
    secret: "fixture-password",
  });
  assert.deepEqual(await store.read("other.secret"), {
    ok: true,
    kind: "missing",
  });
  },
);

test("blank development credentials are treated as missing", async () => {
  const store = createDevelopmentEnvironmentSecretStore({
    EMAIL: "",
    PASSWORD: "",
  });

  assert.deepEqual(await store.read(BLOOKET_LOGIN_IDENTIFIER_SECRET), {
    ok: true,
    kind: "missing",
  });
  assert.deepEqual(await store.read(BLOOKET_PASSWORD_SECRET), {
    ok: true,
    kind: "missing",
  });
});

test(
  "invalid names and oversized development secrets fail closed",
  async () => {
  const store = createDevelopmentEnvironmentSecretStore({
    EMAIL: "x".repeat(HOST_SECRET_MAX_BYTES + 1),
  });

  assert.deepEqual(await store.read("INVALID"), {
    ok: false,
    code: "invalid-host-secret-name",
  });
  assert.deepEqual(await store.read(BLOOKET_LOGIN_IDENTIFIER_SECRET), {
    ok: false,
    code: "host-secret-data-invalid",
  });
  },
);

test("development secret stores are read-only", async () => {
  const store = createDevelopmentEnvironmentSecretStore({});

  assert.deepEqual(
    await store.write(BLOOKET_PASSWORD_SECRET, "new-value"),
    {
      ok: false,
      code: "host-secret-store-unsupported",
    },
  );
  assert.deepEqual(await store.delete(BLOOKET_PASSWORD_SECRET), {
    ok: false,
    code: "host-secret-store-unsupported",
  });
});

test("development local ports are optional and strict", () => {
  assert.deepEqual(readDevelopmentLocalPort({}), {
    ok: true,
    kind: "missing",
  });
  assert.deepEqual(readDevelopmentLocalPort({ LOCAL_PORT: "" }), {
    ok: true,
    kind: "missing",
  });
  assert.deepEqual(readDevelopmentLocalPort({ LOCAL_PORT: "2607" }), {
    ok: true,
    kind: "found",
    port: 2607,
  });
});

test("invalid development local ports fail closed", () => {
  for (const LOCAL_PORT of [
    "0",
    "65536",
    "2607.0",
    " 2607",
    "abc",
    "-1",
  ]) {
    assert.deepEqual(readDevelopmentLocalPort({ LOCAL_PORT }), {
      ok: false,
      code: "invalid-development-local-port",
    });
  }
});
