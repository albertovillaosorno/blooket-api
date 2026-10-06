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
//   - Salted owner-password verifiers and bounded in-process checking.
// - Must-Not:
//   - Persist secrets, choose an operating-system backend, or emit diagnostics.
// - Allows:
//   - Inputs: Bounded passwords and untrusted verifier strings.
//   - Outputs: Opaque salted verifiers and boolean verification results.
//   - Side effects: Random salts and bounded asynchronous cryptographic work.
// - Split-When:
//   - Different secret classes require independent lifetime or size policies.
// - Merge-When:
//   - Host secret storage is removed.
// - Summary:
//   - Verifies local consent passwords without retaining plaintext.
// - Description:
//   - Only fixed scrypt parameters and canonical encodings are admitted.
// - Usage:
//   - Generate a verifier before writing through the OS secret-store
//     adapter.
// - Defaults:
//   - Passwords are nonempty and limited to 2048 UTF-8 bytes.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerPasswordVerifier,
  verifyOwnerPassword,
} from "../../../../src/security/owner-password/domain/verifier.ts";

test(
  "owner verifiers use distinct salts and " +
    "preserve Unicode passwords",
  async () => {
  const password = "fixture-password Ç";
  const first = await createOwnerPasswordVerifier(password);
  const second = await createOwnerPasswordVerifier(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyOwnerPassword(password, first), true);
  assert.equal(await verifyOwnerPassword("incorrect", first), false);
  for (const invalid of [
    first.replace("16384", "1073741824"),
    first + "$extra",
    "plaintext",
    "scrypt-v1$16384$8$1$bad$bad",
  ])
    assert.equal(await verifyOwnerPassword(password, invalid), false);
  await assert.rejects(createOwnerPasswordVerifier("é".repeat(1025)));
});
