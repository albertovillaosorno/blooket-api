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
//   - Canonical publication admission and transport regression coverage.
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
//   - Canonical publication admission and transport regression coverage.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { BLOOKET_PUBLICATION_COMMANDS, decodeBlooketPublicationCommand } from
  "../../../../src/ir/blooket-publication-commands/contract/commands.ts";

test("publication payloads admit logical IDs and exact saved revisions", () => {
  for (const name of BLOOKET_PUBLICATION_COMMANDS) {
    const request = (name.endsWith(".step") || name.endsWith(".append"))
      ? { draftId: "fixture.quiz", expectedRevision: "a".repeat(64),
          ...(name.endsWith(".append") ? { remoteSetId: "remote-set" } : {}) }
      : { draftId: "fixture.quiz" };
    assert.equal(decodeBlooketPublicationCommand(name, request).ok, true);
    for (const invalid of [null, [], {},
      { ...request, path: "/private/draft.json" },
      { ...request, draftId: "../fixture" },
      { ...request, draftId: "a".repeat(129) },
      { ...request, overrideRetry: true },
      { ...request, remoteSetId: "" },
    ]) assert.equal(decodeBlooketPublicationCommand(name, invalid).ok, false);
  }
  for (const expectedRevision of [null, undefined, "", "A".repeat(64), 1])
    assert.equal(decodeBlooketPublicationCommand("blooket.publication.step",
      { draftId: "fixture", expectedRevision }).ok, false);
});


test("publication admission never evaluates or tolerates extra own fields",
  () => {
  for (const name of BLOOKET_PUBLICATION_COMMANDS) {
    const step = (name.endsWith(".step") || name.endsWith(".append"));
    const input = step ? { draftId: "fixture",
      expectedRevision: "a".repeat(64),
      ...(name.endsWith(".append") ? { remoteSetId: "remote-set" } : {})
    } : { draftId: "fixture" };
    let getterCalls = 0;
    const accessor = Object.defineProperty({ ...input }, "draftId", {
      enumerable: true, get() { getterCalls++; return "fixture"; },
    });
    const hidden = Object.defineProperty({ ...input }, "extra", {
      enumerable: false, value: "untrusted",
    });
    const symbol = { ...input, [Symbol("extra")]: true };
    const inherited = Object.create({ draftId: "fixture" }) as
      Record<string, unknown>;
    if (step) inherited.expectedRevision = "a".repeat(64);
    const throwing = new Proxy(input, {
      ownKeys() { throw new Error("untrusted key trap"); },
    });
    for (const value of [accessor, hidden, symbol, inherited, throwing])
      assert.equal(decodeBlooketPublicationCommand(name, value).ok, false);
    assert.equal(getterCalls, 0);
    const admitted = decodeBlooketPublicationCommand(name, input);
    assert.equal(admitted.ok, true);
    if (admitted.ok) assert.equal(Object.getPrototypeOf(admitted.value),
      Object.prototype);
  }
  },
);
