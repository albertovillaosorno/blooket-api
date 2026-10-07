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
import { decodeBlooketReadCommand } from
  "../../../../src/ir/blooket-read-commands/contract/commands.ts";

test("Blooket read payloads reject credentials, paths and coercion", () => {
  for (const payload of [
    null,
    [],
    "",
    { token: "test" },
    { setId: "test" },
    { path: "/private" },
  ]) {
    assert.equal(
      decodeBlooketReadCommand("blooket.sets.list", payload).ok,
      false,
    );
  }
  for (const command of [
    "blooket.sets.get",
    "blooket.questions.list",
  ] as const) {
    for (const setId of [undefined, 1, "", "a\n", "x".repeat(513)])
      assert.equal(
        decodeBlooketReadCommand(command, { setId }).ok,
        false,
      );
    assert.equal(
      decodeBlooketReadCommand(command, {
        setId: "opaque ID: unchanged",
      }).ok,
      true,
    );
  }
  assert.equal(
    decodeBlooketReadCommand("blooket.session.inspect", {}).ok,
    true,
  );
});
