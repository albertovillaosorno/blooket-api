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
//   - Behavioral tests for Blooket session reuse and login orchestration.
// - Must-Not:
//   - Launch a browser, touch real credentials, or encode page selectors.
// - Allows:
//   - Inputs: In-memory browser and secret-store doubles.
//   - Outputs: Secret-free session decision verdicts.
//   - Side effects: In-memory call tracking only.
// - Split-When:
//   - Concrete browser adapters require independent integration tests.
// - Merge-When:
//   - Session reuse/login orchestration is removed.
// - Summary:
//   - Proves reuse-first behavior, conditional secrets, and human stops.
// - Description:
//   - Mirrors src/api/blooket-session/application/ensure-session.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Fixture credentials must never appear in session results.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureBlooketSession,
  ensureConfiguredBlooketSession,
} from "../../../../src/api/blooket-session/application/ensure-session.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPreferences,
  savePreferences,
} from "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import type {
  BlooketBrowserAuthenticationResult,
  BlooketBrowserObservationResult,
  BlooketBrowserSessionPort,
} from "../../../../src/api/blooket-session/contract/browser-session.ts";
import {
  BLOOKET_LOGIN_IDENTIFIER_SECRET,
  BLOOKET_PASSWORD_SECRET,
  type BlooketCredentials,
} from "../../../../src/security/blooket-credentials/domain/credentials.ts";
import type {
  HostSecretReadResult,
  HostSecretStore,
} from "../../../../src/security/host-secrets/domain/host-secret.ts";

const LOGIN = "teacher@example.test";
const PASSWORD = "fixture-password";

test(
  "configured login uses saved email without changing legacy secrets",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "configured-session-"));
  try {
    await savePreferences(root, {
      ...(await loadPreferences(root)),
      email: "configured@example.test",
    });
    const reads: string[] = [];
    const credentials: BlooketCredentials[] = [];
    const result = await ensureConfiguredBlooketSession(
      browserDouble(
        {
          observations: [
            { ok: true, state: "signed-out" },
            { ok: true, state: "dashboard" },
          ],
        },
        [],
        credentials,
      ),
      root,
      secretStore(reads),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(reads, [BLOOKET_PASSWORD_SECRET]);
    assert.equal(credentials[0]!.loginIdentifier, "configured@example.test");
    assert.equal(JSON.stringify(result).includes(PASSWORD), false);
    assert.equal(JSON.stringify(result).includes("configured@"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function secretStore(
  reads: string[],
  overrides: Readonly<Record<string, HostSecretReadResult>> = {},
): HostSecretStore {
  const defaults: Readonly<Record<string, HostSecretReadResult>> = {
    [BLOOKET_LOGIN_IDENTIFIER_SECRET]: {
      ok: true,
      kind: "found",
      secret: LOGIN,
    },
    [BLOOKET_PASSWORD_SECRET]: {
      ok: true,
      kind: "found",
      secret: PASSWORD,
    },
  };
  return {
    read: async (name) => {
      reads.push(name);
      return overrides[name] ?? defaults[name] ?? { ok: true, kind: "missing" };
    },
    write: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
  };
}

interface BrowserDoubleOptions {
  readonly observations: readonly BlooketBrowserObservationResult[];
  readonly authentication?: BlooketBrowserAuthenticationResult;
  readonly throwOnObserve?: boolean;
  readonly throwOnAuthenticate?: boolean;
}

function browserDouble(
  options: BrowserDoubleOptions,
  calls: string[],
  credentials: BlooketCredentials[],
): BlooketBrowserSessionPort {
  let observationIndex = 0;
  return {
    observe: async () => {
      calls.push("observe");
      if (options.throwOnObserve) {
        throw new Error("browser fixture failure");
      }
      const result = options.observations[observationIndex];
      observationIndex += 1;
      return (
        result ?? {
          ok: false,
          code: "blooket-browser-failed",
        }
      );
    },
    authenticate: async (value) => {
      calls.push("authenticate");
      credentials.push(value);
      if (options.throwOnAuthenticate) {
        throw new Error("authentication fixture failure");
      }
      return options.authentication === undefined
        ? { ok: true }
        : options.authentication;
    },
  };
}

test("confirmed dashboard sessions reuse without reading secrets", async () => {
  const reads: string[] = [];
  const calls: string[] = [];
  const credentials: BlooketCredentials[] = [];
  const result = await ensureBlooketSession(
    browserDouble(
      {
        observations: [{ ok: true, state: "dashboard" }],
      },
      calls,
      credentials,
    ),
    secretStore(reads),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "ready",
    state: "dashboard",
    reused: true,
  });
  assert.deepEqual(calls, ["observe"]);
  assert.deepEqual(reads, []);
  assert.deepEqual(credentials, []);
});

test("signed-out sessions read credentials only when needed", async () => {
  const reads: string[] = [];
  const calls: string[] = [];
  const credentials: BlooketCredentials[] = [];
  const result = await ensureBlooketSession(
    browserDouble(
      {
        observations: [
          { ok: true, state: "signed-out" },
          { ok: true, state: "dashboard" },
        ],
      },
      calls,
      credentials,
    ),
    secretStore(reads),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "ready",
    state: "dashboard",
    reused: false,
  });
  assert.deepEqual(calls, ["observe", "authenticate", "observe"]);
  assert.deepEqual(reads, [
    BLOOKET_LOGIN_IDENTIFIER_SECRET,
    BLOOKET_PASSWORD_SECRET,
  ]);
  assert.deepEqual(credentials, [
    {
      loginIdentifier: LOGIN,
      password: PASSWORD,
    },
  ]);
});

test("expired sessions follow the same explicit login path", async () => {
  const reads: string[] = [];
  const calls: string[] = [];
  const credentials: BlooketCredentials[] = [];
  const result = await ensureBlooketSession(
    browserDouble(
      {
        observations: [
          { ok: true, state: "expired-session" },
          { ok: true, state: "edit" },
        ],
      },
      calls,
      credentials,
    ),
    secretStore(reads),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "ready",
    state: "edit",
    reused: false,
  });
  assert.equal(reads.length, 2);
  assert.equal(credentials.length, 1);
});

test("rate limiting waits without reading credentials", async () => {
  const reads: string[] = [];
  const calls: string[] = [];
  const result = await ensureBlooketSession(
    browserDouble(
      {
        observations: [{ ok: true, state: "rate-limited" }],
      },
      calls,
      [],
    ),
    secretStore(reads),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "wait",
    state: "rate-limited",
  });
  assert.deepEqual(calls, ["observe"]);
  assert.deepEqual(reads, []);
});

test("security and organization states require human action", async () => {
  for (const state of [
    "organization-prompt",
    "security-challenge",
    "unexpected-page",
  ] as const) {
    const reads: string[] = [];
    const result = await ensureBlooketSession(
      browserDouble(
        {
          observations: [{ ok: true, state }],
        },
        [],
        [],
      ),
      secretStore(reads),
    );

    assert.deepEqual(result, {
      ok: true,
      kind: "human-action-required",
      state,
    });
    assert.deepEqual(reads, []);
  }
});

test("missing credentials stop before browser authentication", async () => {
  const reads: string[] = [];
  const calls: string[] = [];
  const result = await ensureBlooketSession(
    browserDouble(
      {
        observations: [{ ok: true, state: "signed-out" }],
      },
      calls,
      [],
    ),
    secretStore(reads, {
      [BLOOKET_LOGIN_IDENTIFIER_SECRET]: {
        ok: true,
        kind: "missing",
      },
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    code: "blooket-credentials-missing",
  });
  assert.deepEqual(calls, ["observe"]);
  assert.deepEqual(reads, [BLOOKET_LOGIN_IDENTIFIER_SECRET]);
});

test("post-login challenges stop without reporting login success", async () => {
  const result = await ensureBlooketSession(
    browserDouble(
      {
        observations: [
          { ok: true, state: "signed-out" },
          { ok: true, state: "security-challenge" },
        ],
      },
      [],
      [],
    ),
    secretStore([]),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "human-action-required",
    state: "security-challenge",
  });
});

test("remaining signed out after login fails explicitly", async () => {
  const result = await ensureBlooketSession(
    browserDouble(
      {
        observations: [
          { ok: true, state: "signed-out" },
          { ok: true, state: "signed-out" },
        ],
      },
      [],
      [],
    ),
    secretStore([]),
  );

  assert.deepEqual(result, {
    ok: false,
    code: "blooket-authentication-not-established",
  });
});

test("browser exceptions become stable secret-free failures", async () => {
  const observeFailure = await ensureBlooketSession(
    browserDouble(
      {
        observations: [],
        throwOnObserve: true,
      },
      [],
      [],
    ),
    secretStore([]),
  );
  const authenticationFailure = await ensureBlooketSession(
    browserDouble(
      {
        observations: [{ ok: true, state: "signed-out" }],
        throwOnAuthenticate: true,
      },
      [],
      [],
    ),
    secretStore([]),
  );

  assert.deepEqual(observeFailure, {
    ok: false,
    code: "blooket-browser-failed",
  });
  assert.deepEqual(authenticationFailure, {
    ok: false,
    code: "blooket-browser-failed",
  });
  const serialized = JSON.stringify([observeFailure, authenticationFailure]);
  assert.equal(serialized.includes(LOGIN), false);
  assert.equal(serialized.includes(PASSWORD), false);
});

test(
  "browser-declared failures propagate without secret material",
  async () => {
  const result = await ensureBlooketSession(
    browserDouble(
      {
        observations: [{ ok: true, state: "signed-out" }],
        authentication: {
          ok: false,
          code: "blooket-browser-unavailable",
        },
      },
      [],
      [],
    ),
    secretStore([]),
  );

  assert.deepEqual(result, {
    ok: false,
    code: "blooket-browser-unavailable",
  });
  assert.equal(JSON.stringify(result).includes(PASSWORD), false);
});

test("malformed login adapter replies never establish a session", async () => {
  for (const authentication of [
    { ok: true, unexpected: "sensitive" },
    Object.defineProperty({ ok: true }, "secret",
      { value: "private" }),
    { ok: true, [Symbol("secret")]: "private" },
    { ok: false, code: "other", unexpected: "sensitive" },
    { ok: false, code: "blooket-browser-failed", extra: "sensitive" },
    null,
  ]) {
    const calls: string[] = [];
    const result = await ensureBlooketSession(
      browserDouble({
        observations: [
          { ok: true, state: "signed-out" },
          { ok: true, state: "dashboard" },
        ],
        authentication: authentication as BlooketBrowserAuthenticationResult,
      }, calls, []), secretStore([]),
    );
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.deepEqual(calls, ["observe", "authenticate"]);
  }
});
