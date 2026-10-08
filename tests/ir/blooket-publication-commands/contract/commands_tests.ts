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
    const request = name.endsWith(".step")
      ? { draftId: "fixture.quiz", expectedRevision: "a".repeat(64) }
      : { draftId: "fixture.quiz" };
    assert.equal(decodeBlooketPublicationCommand(name, request).ok, true);
    for (const invalid of [null, [], {},
      { ...request, path: "/private/draft.json" },
      { ...request, draftId: "../fixture" },
      { ...request, draftId: "a".repeat(129) },
      { ...request, overrideRetry: true },
      { ...request, remoteSetId: "model-controlled" },
    ]) assert.equal(decodeBlooketPublicationCommand(name, invalid).ok, false);
  }
  for (const expectedRevision of [null, undefined, "", "A".repeat(64), 1])
    assert.equal(decodeBlooketPublicationCommand("blooket.publication.step",
      { draftId: "fixture", expectedRevision }).ok, false);
});
