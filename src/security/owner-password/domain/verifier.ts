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
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { validateHostSecretValue } from
  "../../host-secrets/domain/host-secret.ts";

export const OWNER_VERIFIER_SECRET = "mcp.owner-verifier";
const PREFIX = "scrypt-v1$16384$8$1$";

export async function createOwnerPasswordVerifier(password: string) {
  if (!validateHostSecretValue(password).ok)
    throw new Error("invalid-owner-password");
  const salt = randomBytes(16);
  const digest = await derive(password, salt);
  return (
    PREFIX + salt.toString("base64url") + "$" + digest.toString("base64url")
  );
}

export async function verifyOwnerPassword(password: string, verifier: string) {
  if (!validateHostSecretValue(password).ok || !verifier.startsWith(PREFIX))
    return false;
  const pieces = verifier.slice(PREFIX.length).split("$");
  const saltText = pieces[0],
    digestText = pieces[1];
  if (
    pieces.length !== 2 ||
    !saltText ||
    !digestText ||
    !/^[A-Za-z0-9_-]{22}$/u.test(saltText) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(digestText)
  )
    return false;
  const salt = Buffer.from(saltText, "base64url");
  const digest = Buffer.from(digestText, "base64url");
  if (
    salt.toString("base64url") !== saltText ||
    digest.toString("base64url") !== digestText
  )
    return false;
  const candidate = await derive(password, salt);
  return timingSafeEqual(digest, candidate);
}

function derive(password: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      32,
      {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) =>
        error ? reject(new Error("owner-verifier-failed")) : resolve(key),
    );
  });
}
