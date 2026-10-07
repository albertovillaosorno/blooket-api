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
//   - Behavioral tests for authenticated Blooket set metadata reads.
// - Must-Not:
//   - Launch a browser, use real credentials, or assert undocumented fields.
// - Allows:
//   - Inputs: In-memory browser, secret-store, and set-read doubles.
//   - Outputs: Validated list/get and fail-closed verdicts.
//   - Side effects: In-memory call tracking only.
// - Split-When:
//   - Full question reads gain independent application behavior.
// - Merge-When:
//   - Set read orchestration is removed.
// - Summary:
//   - Proves request-first validation, session gating, and exact IDs.
// - Description:
//   - Mirrors src/api/blooket-set-reads/application/read-sets.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Invalid IDs cause zero browser, secret, or set-read calls.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  getBlooketSet,
  listBlooketQuestions,
  listBlooketSets,
} from "../../../../src/api/blooket-set-reads/application/read-sets.ts";
import type {
  BlooketSetProbeResult,
  BlooketSetReadPort,
} from "../../../../src/api/blooket-set-reads/contract/set-reads.ts";
import type { BlooketQuestionReadPort } from
  "../../../../src/api/blooket-set-reads/contract/question-reads.ts";
import type {
  BlooketBrowserObservationResult,
  BlooketBrowserSessionPort,
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

function secretStore(
  calls: string[],
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
      calls.push("secret:" + name);
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
      calls.push("browser:observe");
      return observations[index++] ?? {
        ok: false,
        code: "blooket-browser-failed",
      };
    },
    authenticate: async () => {
      calls.push("browser:authenticate");
      return { ok: true };
    },
  };
}

interface ReadDouble {
  readonly port: BlooketSetReadPort;
  readonly calls: string[];
}

function readPort(
  listResult: BlooketSetProbeResult | "throw",
  getResult: BlooketSetProbeResult | "throw",
): ReadDouble {
  const calls: string[] = [];
  return {
    calls,
    port: {
      list: async () => {
        calls.push("sets:list");
        if (listResult === "throw") {
          throw new Error("fixture list failure");
        }
        return listResult.ok
          ? { ...listResult, completeness: "unknown" as const }
          : listResult;
      },
      get: async (setId) => {
        calls.push("sets:get:" + setId);
        if (getResult === "throw") {
          throw new Error("fixture get failure");
        }
        return getResult;
      },
    },
  };
}

test("ready sessions list strictly decoded set summaries", async () => {
  const calls: string[] = [];
  const reads = readPort({
    ok: true,
    value: [
      { schemaVersion: 1, id: "set-a", title: "Fractions" },
      { schemaVersion: 1, id: "set-b", title: "Vocabulary" },
    ],
  }, {
    ok: false,
    code: "blooket-browser-failed",
  });
  const result = await listBlooketSets(
    browser([{ ok: true, state: "my-sets" }], calls),
    secretStore(calls),
    reads.port,
  );

  assert.equal(result.ok, true);
  if (result.ok && result.kind === "sets") {
    assert.equal(result.completeness, "unknown");
    assert.equal(result.value.length, 2);
    assert.deepEqual(result.session, {
      state: "my-sets",
      reused: true,
    });
  }
  assert.deepEqual(calls, ["browser:observe"]);
  assert.deepEqual(reads.calls, ["sets:list"]);
});

test("complete empty-account evidence survives application validation",
  async () => {
  const calls: string[] = [];
  const reads: BlooketSetReadPort = {
    list: async () => ({
      ok: true,
      value: [],
      completeness: "complete",
    }),
    get: async () => ({ ok: false, code: "blooket-browser-failed" }),
  };
  const result = await listBlooketSets(
    browser([{ ok: true, state: "my-sets" }], calls),
    secretStore(calls),
    reads,
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "sets",
    session: { state: "my-sets", reused: true },
    completeness: "complete",
    value: [],
  });
  assert.deepEqual(calls, ["browser:observe"]);
  },
);

test("signed-out list reads authenticate before the set probe", async () => {
  const calls: string[] = [];
  const reads = readPort({
    ok: true,
    value: [],
  }, {
    ok: false,
    code: "blooket-browser-failed",
  });
  const result = await listBlooketSets(
    browser([
      { ok: true, state: "signed-out" },
      { ok: true, state: "dashboard" },
    ], calls),
    secretStore(calls),
    reads.port,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    "browser:observe",
    "secret:" + BLOOKET_LOGIN_IDENTIFIER_SECRET,
    "secret:" + BLOOKET_PASSWORD_SECRET,
    "browser:authenticate",
    "browser:observe",
  ]);
  assert.deepEqual(reads.calls, ["sets:list"]);
});

test("wait and human states stop before set listing", async () => {
  for (const state of [
    "rate-limited",
    "organization-prompt",
  ] as const) {
    const reads = readPort(
      { ok: true, value: [] },
      { ok: false, code: "blooket-browser-failed" },
    );
    const result = await listBlooketSets(
      browser([{ ok: true, state }], []),
      secretStore([]),
      reads.port,
    );

    assert.equal(result.ok, true);
    assert.notEqual(result.kind, "sets");
    assert.deepEqual(reads.calls, []);
  }
});

test("invalid list payloads fail without exposing raw values", async () => {
  const rawSecret = "raw-set-page-secret";
  const reads = readPort({
    ok: true,
    value: [{
      schemaVersion: 1,
      id: "set-a",
      title: "Fractions",
      password: rawSecret,
    }],
  }, {
    ok: false,
    code: "blooket-browser-failed",
  });
  const result = await listBlooketSets(
    browser([{ ok: true, state: "dashboard" }], []),
    secretStore([]),
    reads.port,
  );

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(rawSecret), false);
});

test(
  "invalid list completeness fails closed before exposing rows",
  async () => {
  const rawSecret = "raw-completeness-secret";
  const reads = {
    list: async () => ({
      ok: true,
      value: [{
        schemaVersion: 1,
        id: "set-a",
        title: rawSecret,
      }],
      completeness: "partial",
    }),
    get: async () => ({ ok: false, code: "blooket-browser-failed" }),
  } as unknown as BlooketSetReadPort;
  const result = await listBlooketSets(
    browser([{ ok: true, state: "my-sets" }], []),
    secretStore([]),
    reads,
  );

  assert.deepEqual(result, {
    ok: false,
    stage: "read",
    code: "blooket-browser-failed",
  });
  assert.equal(JSON.stringify(result).includes(rawSecret), false);
  },
);

test("invalid set IDs fail before all side effects", async () => {
  const browserCalls: string[] = [];
  const secretCalls: string[] = [];
  const reads = readPort(
    { ok: true, value: [] },
    { ok: true, value: {} },
  );
  const result = await getBlooketSet(
    browser([], browserCalls),
    secretStore(secretCalls),
    reads.port,
    "",
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "request");
  }
  assert.deepEqual(browserCalls, []);
  assert.deepEqual(secretCalls, []);
  assert.deepEqual(reads.calls, []);
});

test("detail reads preserve opaque IDs exactly", async () => {
  const opaqueId = "opaque/REMOTE id?";
  const reads = readPort(
    { ok: true, value: [] },
    {
      ok: true,
      value: {
        schemaVersion: 1,
        id: opaqueId,
        title: "Fractions",
        description: "Review.",
        visibility: "private",
      },
    },
  );
  const result = await getBlooketSet(
    browser([{ ok: true, state: "dashboard" }], []),
    secretStore([]),
    reads.port,
    opaqueId,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(reads.calls, ["sets:get:" + opaqueId]);
  if (result.ok && result.kind === "set") {
    assert.equal(result.value.id, opaqueId);
  }
});

test("detail reads reject a returned ID for a different set", async () => {
  const reads = readPort(
    { ok: true, value: [] },
    {
      ok: true,
      value: {
        schemaVersion: 1,
        id: "other-set",
        title: "Fractions",
        description: "Review.",
        visibility: "public",
      },
    },
  );
  const result = await getBlooketSet(
    browser([{ ok: true, state: "dashboard" }], []),
    secretStore([]),
    reads.port,
    "requested-set",
  );

  assert.deepEqual(result, {
    ok: false,
    stage: "validation",
    code: "set-id-mismatch",
  });
});

test("set adapter failures and exceptions remain stable", async () => {
  for (const listResult of [
    {
      ok: false,
      code: "blooket-browser-unavailable",
    } as const,
    "throw" as const,
  ]) {
    const reads = readPort(
      listResult,
      { ok: false, code: "blooket-browser-failed" },
    );
    const result = await listBlooketSets(
      browser([{ ok: true, state: "dashboard" }], []),
      secretStore([]),
      reads.port,
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "read");
    }
  }
});

test(
  "ready sessions list strictly decoded questions for the exact set",
  async () => {
  const calls: string[] = [];
  const questionCalls: string[] = [];
  const reads: BlooketQuestionReadPort = {
    list: async (setId) => {
      questionCalls.push(setId);
      return {
        ok: true,
        value: [{
          schemaVersion: 1,
          number: 1,
          question: "Type sun.",
          qType: "typing",
          random: true,
          timeLimit: 10,
          answers: ["sun"],
          correctAnswers: ["sun"],
          answerTypes: ["exactly"],
          hasImage: false,
          hasAudio: false,
        }],
      };
    },
  };
  const result = await listBlooketQuestions(
    browser([{ ok: true, state: "edit" }], calls),
    secretStore(calls),
    reads,
    "opaque/set id?",
  );

  assert.equal(result.ok, true);
  if (result.ok && result.kind === "questions") {
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0]?.question, "Type sun.");
    assert.deepEqual(result.session, { state: "edit", reused: true });
  }
  assert.deepEqual(questionCalls, ["opaque/set id?"]);
  assert.deepEqual(calls, ["browser:observe"]);
  },
);

test(
  "normalized answer-image reads preserve kind without provider identity",
  async () => {
  const result = await listBlooketQuestions(
    browser([{ ok: true, state: "edit" }], []),
    secretStore([]),
    {
      list: async () => ({
        ok: true,
        value: [{
          schemaVersion: 2,
          number: 1,
          question: "Pick the image.",
          qType: "mc",
          random: false,
          timeLimit: 20,
          answers: [
            { kind: "image", content: null, correct: true, match: null },
            {
              kind: "text",
              content: "Moon",
              correct: false,
              match: null,
            },
          ],
          hasImage: false,
          hasAudio: false,
        }],
      }),
    },
    "set-a",
  );

  assert.equal(result.ok, true);
  if (result.ok && result.kind === "questions") {
    assert.deepEqual(result.value[0]?.answers, [
      { kind: "image", content: null, correct: true, match: null },
      { kind: "text", content: "Moon", correct: false, match: null },
    ]);
  }
  },
);

test(
  "invalid question set IDs fail before browser and secret access",
  async () => {
  const browserCalls: string[] = [];
  const secretCalls: string[] = [];
  let read = false;
  const result = await listBlooketQuestions(
    browser([], browserCalls),
    secretStore(secretCalls),
    {
      list: async () => {
        read = true;
        return { ok: true, value: [] };
      },
    },
    "",
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.stage, "request");
  assert.equal(read, false);
  assert.deepEqual(browserCalls, []);
  assert.deepEqual(secretCalls, []);
  },
);

test("invalid question payloads do not expose raw adapter values", async () => {
  const rawSecret = "raw-question-page-secret";
  const result = await listBlooketQuestions(
    browser([{ ok: true, state: "edit" }], []),
    secretStore([]),
    {
      list: async () => ({
        ok: true,
        value: [{
          schemaVersion: 1,
          number: 1,
          question: "Safe prompt",
          qType: "typing",
          random: true,
          timeLimit: 10,
          answers: ["safe"],
          correctAnswers: ["safe"],
          answerTypes: ["exactly"],
          hasImage: false,
          hasAudio: false,
          password: rawSecret,
        }],
      }),
    },
    "set-a",
  );

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(rawSecret), false);
});
