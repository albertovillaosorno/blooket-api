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
//   - Local owner-password approval with a shared bounded attempt budget.
// - Must-Not:
//   - Return stored secrets or mutate Blooket during diagnostics.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Host-secret reads and bounded password verification.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Local owner-password approval with a shared bounded attempt budget.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerApprovalGuard } from
  "../../../../src/api/teacher-configuration/application/owner-approval.ts";
import { createOwnerPasswordVerifier } from
  "../../../../src/security/owner-password/domain/verifier.ts";

test(
  "local approval has a shared bounded attempt " +
    "budget and never echoes",
  async () => {
  let now = 1000;
  const password = "fixture-owner-password";
  const verifier = await createOwnerPasswordVerifier(password);
  const guard = createOwnerApprovalGuard(
    {
      read: async () => ({ ok: true, kind: "found", secret: verifier }),
      write: async () => ({ ok: true }),
      delete: async () => ({ ok: true }),
    },
    () => now,
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(guard("wrong"), (error: Error) => {
      assert.equal(error.message, "owner-password-invalid");
      assert.equal(error.message.includes(password), false);
      return true;
    });
  }
  await assert.rejects(guard(password), /owner-approval-rate-limited/u);
  now += 60_000;
  assert.equal(await guard(password), undefined);
});

test("missing owner verifier cannot approve a connection", async () => {
  const guard = createOwnerApprovalGuard({
    read: async () => ({ ok: true, kind: "missing" }),
    write: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
  });
  await assert.rejects(guard("fixture"), /owner-password-unavailable/u);
});
