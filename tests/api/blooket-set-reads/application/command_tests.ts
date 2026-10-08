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
//   - Canonical read admission and transport regression coverage.
// - Must-Not:
//   - Expose configuration through the online MCP gateway.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Canonical read admission and transport regression coverage.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { executeCommand } from
  "../../../../src/api/command-execution/application/execute-command.ts";
import type { BlooketReadDependencies } from
  "../../../../src/api/blooket-set-reads/application/command.ts";
import type { ObservedBlooketNavigationStateKind } from
  "../../../../src/ir/blooket-navigation/domain/navigation-state.ts";

function dependencies(state: ObservedBlooketNavigationStateKind) {
  let reads = 0;
  const secret = async (): Promise<never> => {
    throw new Error("Credentials must not be read by read-only commands.");
  };
  const ports: BlooketReadDependencies = {
    session: {
      observe: async () => ({ ok: true, state }),
      authenticate: secret,
    },
    capabilities: {
      inspect: async () => {
        reads++;
        return {
          ok: true,
          value: {
            schemaVersion: 3,
            verifiedOn: "2026-10-07",
            evidence: [{
              kind: "browser-observation",
              reference: "synthetic capability fixture",
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
              answerImages: "unsupported",
              audio: "unsupported",
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
              maxBytes: 2_500_000,
              canvasWidth: null,
              canvasHeight: null,
              maxPixels: null,
            },
          },
        };
      },
    },
    secrets: { read: secret, write: secret, delete: secret },
    questions: {
      list: async () => {
        reads++;
        return {
          ok: true,
          value: [{
            schemaVersion: 1,
            number: 1,
            question: "Type sun.",
            qType: "typing",
            random: true,
            timeLimit: 15,
            answers: ["sun"],
            correctAnswers: ["sun"],
            answerTypes: ["exactly"],
            hasImage: false,
            hasAudio: false,
          }],
        };
      },
    },
    sets: {
      list: async () => {
        reads++;
        return {
          ok: true,
          value: [{ schemaVersion: 1, id: "fixture", title: "Synthetic quiz" }],
          completeness: "unknown" as const,
        };
      },
      get: async (setId) => {
        reads++;
        return {
          ok: true,
          value: {
            schemaVersion: 1,
            id: setId,
            title: "Synthetic quiz",
            description: "Synthetic fixture",
            visibility: "private",
          },
        };
      },
    },
  };
  return { ports, reads: () => reads };
}
const envelope = (command: string, payload: unknown = {}) => ({
  version: 1 as const,
  operationId: "cli:read-test",
  command,
  payload,
});

test("canonical reads reuse a ready session without secret access",
  async () => {
  const fixture = dependencies("my-sets");
  const list = await executeCommand(
    envelope("blooket.sets.list"),
    undefined,
    fixture.ports,
  );
  assert.equal(list.ok, true);
  if (list.ok)
    assert.deepEqual(list.value, {
      ok: true,
      kind: "sets",
      session: { state: "my-sets", reused: true },
      completeness: "unknown",
      value: [{ schemaVersion: 1, id: "fixture", title: "Synthetic quiz" }],
    });
  const capabilities = await executeCommand(
    envelope("blooket.capabilities.inspect"),
    undefined,
    fixture.ports,
  );
  assert.equal(capabilities.ok, true);
  if (capabilities.ok) {
    const value = capabilities.value as {
      readonly kind?: string;
      readonly value?: { readonly features?: { readonly audio?: string } };
    };
    assert.equal(value.kind, "capabilities");
    assert.equal(value.value?.features?.audio, "unsupported");
  }
  assert.equal(
    (
      await executeCommand(
        envelope("blooket.sets.get", { setId: "fixture" }),
        undefined,
        fixture.ports,
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await executeCommand(
        envelope("blooket.questions.list", { setId: "fixture" }),
        undefined,
        fixture.ports,
      )
    ).ok,
    true,
  );
  assert.equal(fixture.reads(), 4);
});

test("closed and challenged sessions stop before reads or secrets",
  async () => {
  for (const state of [
    "signed-out",
    "expired-session",
    "security-challenge",
    "organization-prompt",
    "unexpected-page",
    "rate-limited",
  ] as const) {
    const fixture = dependencies(state);
    const result = await executeCommand(
      envelope("blooket.sets.list"),
      undefined,
      fixture.ports,
    );
    const questions = await executeCommand(
      envelope("blooket.questions.list", { setId: "fixture" }),
      undefined,
      fixture.ports,
    );
    const capabilities = await executeCommand(
      envelope("blooket.capabilities.inspect"),
      undefined,
      fixture.ports,
    );
    assert.equal(fixture.reads(), 0);
    assert.equal(questions.ok, result.ok);
    assert.equal(capabilities.ok, result.ok);
    if (state === "signed-out" || state === "expired-session") {
      assert.equal(result.ok, false);
      if (!result.ok)
        assert.equal(result.issues[0]?.code, "blooket-authentication-required");
    } else {
      assert.equal(result.ok, true);
      if (result.ok)
        assert.equal((result.value as { state: string }).state, state);
    }
  }
});

test("exact payload and provider decoders guard canonical reads",
  async () => {
  const fixture = dependencies("my-sets");
  const malformed = await executeCommand(
    envelope("blooket.sets.get", {
      setId: "fixture",
      password: "not-admitted",
    }),
    undefined,
    fixture.ports,
  );
  assert.equal(malformed.ok, false);
  assert.equal(fixture.reads(), 0);
  const bad = {
    ...fixture.ports,
    sets: {
      ...fixture.ports.sets,
      list: async () => ({
        ok: true as const,
        value: [
          {
            schemaVersion: 1,
            id: "fixture",
            title: "Synthetic",
            cookie: "must-not-leak",
          },
        ],
      }),
    },
  };
  const invalid = await executeCommand(
    envelope("blooket.sets.list"),
    undefined,
    bad,
  );
  assert.equal(invalid.ok, false);
  assert.equal(JSON.stringify(invalid).includes("must-not-leak"), false);
  const unavailable = await executeCommand(envelope("blooket.sets.list"));
  assert.equal(unavailable.ok, false);
});

test(
  "canonical commands preserve human stops arising during browser probes",
  async () => {
    for (const command of [
      "blooket.sets.list",
      "blooket.sets.get",
      "blooket.questions.list",
      "blooket.capabilities.inspect",
    ] as const) {
      const fixture = dependencies("my-sets");
      let observations = 0;
      let probes = 0;
      const stopped: BlooketReadDependencies = {
        ...fixture.ports,
        session: {
          observe: async () => ({
            ok: true as const,
            state: (observations++ === 0
              ? "my-sets" : "security-challenge") as const,
          }),
          authenticate: async () => {
            throw new Error("unexpected-authentication");
          },
        },
        sets: {
          list: async () => {
            probes++;
            return { ok: false, code: "blooket-browser-failed" };
          },
          get: async () => {
            probes++;
            return { ok: false, code: "blooket-browser-failed" };
          },
        },
        questions: {
          list: async () => {
            probes++;
            return { ok: false, code: "blooket-browser-failed" };
          },
        },
        capabilities: {
          inspect: async () => {
            probes++;
            return { ok: false, code: "blooket-browser-failed" };
          },
        },
      };
      const payload = command.endsWith(".get") ||
          command === "blooket.questions.list"
        ? { setId: "fixture" }
        : {};
      const result = await executeCommand(
        envelope(command, payload), undefined, stopped,
      );
      assert.equal(result.ok, true);
      if (result.ok)
        assert.deepEqual(result.value, {
          ok: true,
          kind: "human-action-required",
          state: "security-challenge",
        });
      assert.equal(observations, 2);
      assert.equal(probes, 1);
      assert.equal(fixture.reads(), 0);
    }
  },
);
