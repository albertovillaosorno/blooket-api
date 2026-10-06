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
//   - Mapping tests from bridge commands to existing Blooket application ports.
// - Must-Not:
//   - Launch a browser, inspect DOM, or retain synthetic credentials.
// - Allows:
//   - Inputs: Deterministic in-memory transport replies.
//   - Outputs: Port results and exact recorded bridge commands.
//   - Side effects: In-memory call recording only.
// - Split-When:
//   - Session and read adapters need independent bridge contracts.
// - Merge-When:
//   - Blooket application ports are removed.
// - Summary:
//   - Proves concrete bridge adapters preserve IDs and fail malformed states.
// - Description:
//   - Read values remain unknown for the application IR decoders.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Thrown transport errors become stable browser failures.
//
import assert from "node:assert/strict";
import test from "node:test";

import type { BlooketBrowserBridgeCommand } from
  "../../../../src/ir/blooket-browser-bridge/contract/message.ts";
import { createBlooketBrowserBridgeAdapters } from
  "../../../../src/api/blooket-browser-bridge/adapter-outbound/adapters.ts";
import type {
  BlooketBrowserBridgeTransport,
  BlooketBrowserBridgeTransportResult,
} from
  "../../../../src/platforms/blooket-browser/contract/bridge-transport.ts";

function transport(
  replies: readonly BlooketBrowserBridgeTransportResult[],
  commands: BlooketBrowserBridgeCommand[],
): BlooketBrowserBridgeTransport {
  let index = 0;
  return {
    request: async (command) => {
      commands.push(command);
      return replies[index++] ?? {
        ok: false,
        code: "blooket-browser-failed",
      };
    },
  };
}

test("bridge adapters map session and opaque read calls exactly", async () => {
  const commands: BlooketBrowserBridgeCommand[] = [];
  const adapters = createBlooketBrowserBridgeAdapters(transport([
    { ok: true, value: "my-sets" },
    { ok: true, value: null },
    { ok: true, value: [{ remote: "set" }] },
    { ok: true, value: { remote: "detail" } },
    { ok: true, value: [{ remote: "question" }] },
  ], commands));

  assert.deepEqual(await adapters.session.observe(), {
    ok: true,
    state: "my-sets",
  });
  assert.deepEqual(await adapters.session.authenticate({
    loginIdentifier: "teacher@example.test",
    password: "synthetic-password",
  }), { ok: true });
  assert.deepEqual(await adapters.sets.list(), {
    ok: true,
    value: [{ remote: "set" }],
  });
  assert.deepEqual(await adapters.sets.get("opaque/set id?"), {
    ok: true,
    value: { remote: "detail" },
  });
  assert.deepEqual(await adapters.questions.list("opaque/set id?"), {
    ok: true,
    value: [{ remote: "question" }],
  });

  assert.deepEqual(commands, [
    { kind: "session.observe" },
    {
      kind: "session.authenticate",
      loginIdentifier: "teacher@example.test",
      password: "synthetic-password",
    },
    { kind: "sets.list" },
    { kind: "sets.get", setId: "opaque/set id?" },
    { kind: "questions.list", setId: "opaque/set id?" },
  ]);
});

test("invalid states and transport exceptions fail closed", async () => {
  const invalid = createBlooketBrowserBridgeAdapters({
    request: async () => ({ ok: true, value: "authenticated" }),
  });
  assert.deepEqual(await invalid.session.observe(), {
    ok: false,
    code: "blooket-browser-failed",
  });

  const thrown = createBlooketBrowserBridgeAdapters({
    request: async () => {
      throw new Error("private extension detail");
    },
  });
  assert.deepEqual(await thrown.capabilities.inspect(), {
    ok: false,
    code: "blooket-browser-failed",
  });
});
