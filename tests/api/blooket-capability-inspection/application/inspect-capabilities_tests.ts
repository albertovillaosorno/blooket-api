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
//   - Behavioral tests for authenticated capability inspection.
// - Must-Not:
//   - Launch a browser, touch real credentials, or trust raw probe data.
// - Allows:
//   - Inputs: In-memory session, secret, and capability-probe doubles.
//   - Outputs: Validated capability and fail-closed verdicts.
//   - Side effects: In-memory call tracking only.
// - Split-When:
//   - Capability families require separate application tests.
// - Merge-When:
//   - Authenticated capability inspection is removed.
// - Summary:
//   - Proves session gating, strict decoding, and raw-data containment.
// - Description:
//   - Mirrors the Blooket capability inspection application.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Capability probing happens only after a ready session.
//
import assert from "node:assert/strict";
import test from "node:test";

import { inspectBlooketCapabilities } from
// jig-ignore-next-line: Static import path cannot be wrapped safely.
  "../../../../src/api/blooket-capability-inspection/application/inspect-capabilities.ts";
import type {
  BlooketCapabilityInspectionPort,
  BlooketCapabilityProbeResult,
} from
// jig-ignore-next-line: Static import path cannot be wrapped safely.
  "../../../../src/api/blooket-capability-inspection/contract/capability-inspection.ts";
import type {
  BlooketBrowserSessionPort,
  BlooketBrowserObservationResult,
} from "../../../../src/api/blooket-session/contract/browser-session.ts";
import {
  BLOOKET_LOGIN_IDENTIFIER_SECRET,
  BLOOKET_PASSWORD_SECRET,
} from
  "../../../../src/security/blooket-credentials/domain/credentials.ts";
import type {
  HostSecretReadResult,
  HostSecretStore,
} from "../../../../src/security/host-secrets/domain/host-secret.ts";

const LOGIN = "teacher@example.test";
const PASSWORD = "fixture-password";

const capabilities = {
  schemaVersion: 3,
  verifiedOn: "2026-10-05",
  evidence: [{
    kind: "browser-observation",
    reference: "fixture account inspection",
  }],
  questionTypes: {
    multipleChoice: {
      availability: "supported",
      minAnswers: 2,
      maxAnswers: 4,
      requiresQuestionText: true,
      allowsMultipleCorrect: true,
    },
    typingAnswer: {
      availability: "supported",
      matchModes: ["exact", "contains"],
    },
  },
  features: {
    questionImages: "supported",
    answerImages: "account-dependent",
    audio: "account-dependent",
  },
  setMetadata: {
    titleRequired: true,
    descriptionRequired: false,
    titleMaxLength: 75,
    descriptionMaxLength: 300,
    coverImageOptional: true,
    visibility: ["public", "private"],
  },
  upload: {
    maxBytes: null,
    canvasWidth: null,
    canvasHeight: null,
    maxPixels: null,
  },
};

function secretStore(
  reads: string[],
  overrides: Readonly<Record<string, HostSecretReadResult>> = {},
): HostSecretStore {
  const values: Readonly<Record<string, HostSecretReadResult>> = {
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
      return overrides[name] ?? values[name]
        ?? { ok: true, kind: "missing" };
    },
    write: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
  };
}

function browser(
  observations: readonly BlooketBrowserObservationResult[],
  calls: string[],
): BlooketBrowserSessionPort {
  let index = 0;
  return {
    observe: async () => {
      calls.push("observe");
      return observations[index++] ?? {
        ok: false,
        code: "blooket-browser-failed",
      };
    },
    authenticate: async () => {
      calls.push("authenticate");
      return { ok: true };
    },
  };
}

function capabilityProbe(
  result: BlooketCapabilityProbeResult | "throw",
  calls: string[],
): BlooketCapabilityInspectionPort {
  return {
    inspect: async () => {
      calls.push("inspect");
      if (result === "throw") {
        throw new Error("fixture capability failure");
      }
      return result;
    },
  };
}

test("ready reused sessions inspect and decode capabilities", async () => {
  const browserCalls: string[] = [];
  const secretReads: string[] = [];
  const probeCalls: string[] = [];
  const result = await inspectBlooketCapabilities(
    browser([{ ok: true, state: "dashboard" }], browserCalls),
    secretStore(secretReads),
    capabilityProbe({ ok: true, value: capabilities }, probeCalls),
  );

  assert.equal(result.ok, true);
  if (!result.ok || result.kind !== "capabilities") {
    return;
  }
  assert.deepEqual(result.session, {
    state: "dashboard",
    reused: true,
  });
  assert.equal(result.value.schemaVersion, 3);
  assert.deepEqual(browserCalls, ["observe"]);
  assert.deepEqual(secretReads, []);
  assert.deepEqual(probeCalls, ["inspect"]);
});

test(
  "read-only inspection never reads credentials or authenticates",
  async () => {
  const browserCalls: string[] = [];
  const secretReads: string[] = [];
  const probeCalls: string[] = [];
  const result = await inspectBlooketCapabilities(
    browser([{ ok: true, state: "signed-out" }], browserCalls),
    secretStore(secretReads),
    capabilityProbe({ ok: true, value: capabilities }, probeCalls),
    { readOnly: true },
  );

  assert.deepEqual(result, {
    ok: false,
    stage: "session",
    code: "blooket-authentication-required",
  });
  assert.deepEqual(browserCalls, ["observe"]);
  assert.deepEqual(secretReads, []);
  assert.deepEqual(probeCalls, []);
  },
);

test("signed-out sessions authenticate before capability probing", async () => {
  const browserCalls: string[] = [];
  const secretReads: string[] = [];
  const probeCalls: string[] = [];
  const result = await inspectBlooketCapabilities(
    browser([
      { ok: true, state: "signed-out" },
      { ok: true, state: "dashboard" },
    ], browserCalls),
    secretStore(secretReads),
    capabilityProbe({ ok: true, value: capabilities }, probeCalls),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(browserCalls, [
    "observe",
    "authenticate",
    "observe",
  ]);
  assert.deepEqual(secretReads, [
    BLOOKET_LOGIN_IDENTIFIER_SECRET,
    BLOOKET_PASSWORD_SECRET,
  ]);
  assert.deepEqual(probeCalls, ["inspect"]);
});

test("wait and human states stop before capability probing", async () => {
  for (const state of [
    "rate-limited",
    "security-challenge",
  ] as const) {
    const probeCalls: string[] = [];
    const result = await inspectBlooketCapabilities(
      browser([{ ok: true, state }], []),
      secretStore([]),
      capabilityProbe({ ok: true, value: capabilities }, probeCalls),
    );

    assert.equal(result.ok, true);
    assert.notEqual(result.kind, "capabilities");
    assert.deepEqual(probeCalls, []);
  }
});

test("missing credentials stop at the session stage", async () => {
  const probeCalls: string[] = [];
  const result = await inspectBlooketCapabilities(
    browser([{ ok: true, state: "signed-out" }], []),
    secretStore([], {
      [BLOOKET_LOGIN_IDENTIFIER_SECRET]: {
        ok: true,
        kind: "missing",
      },
    }),
    capabilityProbe({ ok: true, value: capabilities }, probeCalls),
  );

  assert.deepEqual(result, {
    ok: false,
    stage: "session",
    code: "blooket-credentials-missing",
  });
  assert.deepEqual(probeCalls, []);
});

test(
  "invalid capability data never crosses as a successful value",
  async () => {
  const rawSecret = "raw-browser-secret-value";
  const result = await inspectBlooketCapabilities(
    browser([{ ok: true, state: "dashboard" }], []),
    secretStore([]),
    capabilityProbe({
      ok: true,
      value: {
        schemaVersion: 2,
        password: rawSecret,
      },
    }, []),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "validation");
    assert.equal(
      JSON.stringify(result).includes(rawSecret),
      false,
    );
  }
  },
);

test(
  "probe failures and exceptions become stable inspection failures",
  async () => {
  for (const probeResult of [
    {
      ok: false,
      code: "blooket-browser-unavailable",
    } as const,
    "throw" as const,
  ]) {
    const result = await inspectBlooketCapabilities(
      browser([{ ok: true, state: "dashboard" }], []),
      secretStore([]),
      capabilityProbe(probeResult, []),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "inspection");
    }
  }
  },
);

test("malformed capability probe envelopes never expose data", async () => {
  for (const invalid of [
    { ok: false, code: "private-code", raw: "private-data" },
    { ok: false, code: "blooket-browser-failed", extra: "private-data" },
    { ok: true, value: capabilities, extra: "private-data" },
    { ok: "true", value: capabilities },
    null,
  ]) {
    const result = await inspectBlooketCapabilities(
      browser([{ ok: true, state: "dashboard" }], []),
      secretStore([]),
      capabilityProbe(invalid as BlooketCapabilityProbeResult, []),
    );
    assert.deepEqual(result, {
      ok: false, stage: "inspection", code: "blooket-browser-failed",
    });
  }
});

test("a challenge during capability probing becomes a human stop", async () => {
  for (const state of [
    "security-challenge", "organization-prompt", "rate-limited",
  ] as const) {
    const browserCalls: string[] = [];
    const secretReads: string[] = [];
    const probeCalls: string[] = [];
    const result = await inspectBlooketCapabilities(
      browser([
        { ok: true, state: "dashboard" },
        { ok: true, state },
      ], browserCalls),
      secretStore(secretReads),
      capabilityProbe({ ok: false, code: "blooket-browser-failed" },
        probeCalls),
      { readOnly: true },
    );
    assert.deepEqual(result, {
      ok: true,
      kind: state === "rate-limited" ? "wait" : "human-action-required",
      state,
    });
    assert.deepEqual(browserCalls, ["observe", "observe"]);
    assert.deepEqual(secretReads, []);
    assert.deepEqual(probeCalls, ["inspect"]);
  }
});

test(
  "a signed-out capability failure requires credentials, not login",
  async () => {
  const browserCalls: string[] = [];
  const secretReads: string[] = [];
  const probeCalls: string[] = [];
  const result = await inspectBlooketCapabilities(
    browser([
      { ok: true, state: "dashboard" },
      { ok: true, state: "signed-out" },
    ], browserCalls),
    secretStore(secretReads),
    capabilityProbe({ ok: false, code: "blooket-browser-failed" },
      probeCalls),
  );
  assert.deepEqual(result, {
    ok: false, stage: "session", code: "blooket-authentication-required",
  });
  assert.deepEqual(browserCalls, ["observe", "observe"]);
  assert.deepEqual(secretReads, []);
  assert.deepEqual(probeCalls, ["inspect"]);
  },
);

test(
  "unavailable capability transport skips additional session probing",
  async () => {
  const browserCalls: string[] = [];
  const probeCalls: string[] = [];
  const result = await inspectBlooketCapabilities(
    browser([{ ok: true, state: "dashboard" }], browserCalls),
    secretStore([]),
    capabilityProbe({ ok: false, code: "blooket-browser-unavailable" },
      probeCalls),
    { readOnly: true },
  );
  assert.deepEqual(result, {
    ok: false, stage: "inspection", code: "blooket-browser-unavailable",
  });
  assert.deepEqual(browserCalls, ["observe"]);
  assert.deepEqual(probeCalls, ["inspect"]);
  },
);

test(
  "an unconfirmed capability follow-up preserves the original failure",
  async () => {
    const calls: string[] = [];
    const result = await inspectBlooketCapabilities(
      browser([
        { ok: true, state: "dashboard" },
        { ok: false, code: "blooket-browser-unavailable" },
      ], calls),
      secretStore([]),
      capabilityProbe({ ok: false, code: "blooket-browser-failed" }, []),
      { readOnly: true },
    );
    assert.deepEqual(result, {
      ok: false, stage: "inspection", code: "blooket-browser-failed",
    });
    assert.deepEqual(calls, ["observe", "observe"]);
  },
);
