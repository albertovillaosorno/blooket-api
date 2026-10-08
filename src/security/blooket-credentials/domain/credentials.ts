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
//   - Canonical host-secret keys and retrieval of Blooket login credentials.
// - Must-Not:
//   - Log, serialize, persist outside the host store, or authenticate remotely.
// - Allows:
//   - Inputs: A trusted host-secret store and optional validated saved email.
//   - Outputs: In-process credentials or stable secret-free failures.
//   - Side effects: Reads at most two host-secret entries.
// - Split-When:
//   - Authentication methods need independent credential shapes.
// - Merge-When:
//   - Blooket login no longer uses stored credentials.
// - Summary:
//   - Retrieves login material only through the security-domain secret port.
// - Description:
//   - Uses ordinary saved email when supplied, preserving legacy key reads.
// - Usage:
//   - Call only when the navigation policy says authentication is required.
// - Defaults:
//   - Missing credentials are one non-secret failure regardless of which key.
//
import type {
  HostSecretFailureCode,
  HostSecretStore,
} from "../../host-secrets/domain/host-secret.ts";

export const BLOOKET_LOGIN_IDENTIFIER_SECRET = "blooket.login";
export const BLOOKET_PASSWORD_SECRET = "blooket.password";

export interface BlooketCredentials {
  readonly loginIdentifier: string;
  readonly password: string;
}

export type BlooketCredentialReadResult =
  | {
      readonly ok: true;
      readonly value: BlooketCredentials;
    }
  | {
      readonly ok: false;
      readonly code: "blooket-credentials-missing" | HostSecretFailureCode;
    };

export async function readBlooketCredentials(
  store: HostSecretStore,
  loginIdentifier?: string,
): Promise<BlooketCredentialReadResult> {
  const identifier =
    loginIdentifier === undefined
      ? await store.read(BLOOKET_LOGIN_IDENTIFIER_SECRET)
      : loginIdentifier === ""
        ? ({ ok: true, kind: "missing" } as const)
        : ({ ok: true, kind: "found", secret: loginIdentifier } as const);
  if (!identifier.ok) {
    return identifier;
  }
  if (identifier.kind === "missing" ||
      !validLoginIdentifier(identifier.secret)) {
    return {
      ok: false,
      code: "blooket-credentials-missing",
    };
  }

  const password = await store.read(BLOOKET_PASSWORD_SECRET);
  if (!password.ok) {
    return password;
  }
  if (password.kind === "missing" ||
      password.secret.length < 1 || password.secret.length > 2048 ||
      password.secret.includes("\0")) {
    return {
      ok: false,
      code: "blooket-credentials-missing",
    };
  }

  return {
    ok: true,
    value: {
      loginIdentifier: identifier.secret,
      password: password.secret,
    },
  };
}

function validLoginIdentifier(value: string): boolean {
  return value.length >= 1 && value.length <= 254 &&
    !value.includes("\0");
}
