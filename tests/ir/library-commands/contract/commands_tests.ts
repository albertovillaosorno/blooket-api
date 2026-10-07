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
//   - Verification of exact teacher-library command decoding.
// - Must-Not:
//   - Read files, execute commands, or weaken enrichment authority.
// - Allows:
//   - Inputs: Untrusted library command payloads.
//   - Outputs: Decoded bounded payloads or stable validation failures.
//   - Side effects: None.
// - Split-When:
//   - Another command family needs independent validation policy.
// - Merge-When:
//   - Library commands no longer have an independent IR boundary.
// - Summary:
//   - Proves enrichment requires explicit AI-owned language analysis.
// - Description:
//   - Rejects missing, malformed, or extra enrichment fields.
// - Usage:
//   - Run with the repository Node test suite.
// - Defaults:
//   - Unknown fields and invalid language tags fail closed.
//
import test from "node:test";
import assert from "node:assert/strict";
import { decodeLibraryCommand } from
  "../../../../src/ir/library-commands/contract/commands.ts";

test("library enrichment requires bounded detected language", () => {
  const payload = {
    id: "photo-1",
    revision: 2,
    name: "Orange cat",
    description: "An orange cat sitting beside a window.",
    language: "es-MX",
    topics: ["cat", "window"],
  };
  assert.deepEqual(decodeLibraryCommand("library.enrich", payload), {
    kind: "enrich",
    ...payload,
  });
  for (const language of ["", "english", "en_US", "x".repeat(36), 1]) {
    assert.throws(
      () => decodeLibraryCommand("library.enrich", { ...payload, language }),
      /invalid-enrichment/u,
    );
  }
  assert.throws(
    () => decodeLibraryCommand("library.enrich", {
      ...payload,
      path: "photos/private.png",
    }),
    /unknown-or-missing-field/u,
  );
  const { language: _language, ...missing } = payload;
  assert.throws(
    () => decodeLibraryCommand("library.enrich", missing),
    /unknown-or-missing-field/u,
  );
});
