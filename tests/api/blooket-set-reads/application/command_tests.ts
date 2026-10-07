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
    secrets: { read: secret, write: secret, delete: secret },
    sets: {
      list: async () => {
        reads++;
        return {
          ok: true,
          value: [{ schemaVersion: 1, id: "fixture", title: "Synthetic quiz" }],
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
      value: [{ schemaVersion: 1, id: "fixture", title: "Synthetic quiz" }],
    });
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
  assert.equal(fixture.reads(), 2);
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
    assert.equal(fixture.reads(), 0);
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
