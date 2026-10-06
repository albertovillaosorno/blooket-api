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
//   - Development-only credential and local-port reads from an injected env.
// - Must-Not:
//   - Read process.env implicitly, mutate environment state, or serve
//     production.
// - Allows:
//   - Inputs: Explicit environment mappings supplied by tests/development
//     tools.
//   - Outputs: Host-secret reads and validated optional local-port overrides.
//   - Side effects: None.
// - Split-When:
//   - Additional development-only configuration needs independent policy.
// - Merge-When:
//   - Development tests no longer need environment-backed inputs.
// - Summary:
//   - Adapts explicit dev/test environment values to existing application
//     ports.
// - Description:
//   - EMAIL/PASSWORD map only to canonical Blooket secret names.
// - Usage:
//   - Pass process.env explicitly from development entry points only.
// - Defaults:
//   - Missing or blank variables are treated as not configured.
//
import {
  BLOOKET_LOGIN_IDENTIFIER_SECRET,
  BLOOKET_PASSWORD_SECRET,
} from "../../../security/blooket-credentials/domain/credentials.ts";
import {
  decodeHostSecretName,
  type HostSecretMutationResult,
  type HostSecretReadResult,
  type HostSecretStore,
  validateHostSecretValue,
} from "../../../security/host-secrets/domain/host-secret.ts";
import { isPort } from
  "../../../settings/local-service/domain/local-service-settings.ts";

export interface DevelopmentEnvironment {
  readonly EMAIL?: string;
  readonly PASSWORD?: string;
  readonly LOCAL_PORT?: string;
  readonly [name: string]: string | undefined;
}

export type DevelopmentLocalPortResult =
  | {
      readonly ok: true;
      readonly kind: "missing";
    }
  | {
      readonly ok: true;
      readonly kind: "found";
      readonly port: number;
    }
  | {
      readonly ok: false;
      readonly code: "invalid-development-local-port";
    };

export function createDevelopmentEnvironmentSecretStore(
  environment: DevelopmentEnvironment,
): HostSecretStore {
  return {
    read: async (name) => readDevelopmentSecret(environment, name),
    write: async () => unsupportedMutation(),
    delete: async () => unsupportedMutation(),
  };
}

export function readDevelopmentLocalPort(
  environment: DevelopmentEnvironment,
): DevelopmentLocalPortResult {
  const raw = environment.LOCAL_PORT;
  if (raw === undefined || raw === "") {
    return { ok: true, kind: "missing" };
  }
  if (!/^[0-9]+$/u.test(raw)) {
    return {
      ok: false,
      code: "invalid-development-local-port",
    };
  }
  const port = Number(raw);
  if (!isPort(port)) {
    return {
      ok: false,
      code: "invalid-development-local-port",
    };
  }
  return {
    ok: true,
    kind: "found",
    port,
  };
}

async function readDevelopmentSecret(
  environment: DevelopmentEnvironment,
  name: string,
): Promise<HostSecretReadResult> {
  const decoded = decodeHostSecretName(name);
  if (!decoded.ok) {
    return {
      ok: false,
      code: "invalid-host-secret-name",
    };
  }

  const variable = decoded.value === BLOOKET_LOGIN_IDENTIFIER_SECRET
    ? "EMAIL"
    : decoded.value === BLOOKET_PASSWORD_SECRET
      ? "PASSWORD"
      : undefined;
  if (variable === undefined) {
    return { ok: true, kind: "missing" };
  }

  const secret = environment[variable];
  if (secret === undefined || secret === "") {
    return { ok: true, kind: "missing" };
  }
  const valid = validateHostSecretValue(secret);
  if (!valid.ok) {
    return {
      ok: false,
      code: "host-secret-data-invalid",
    };
  }
  return {
    ok: true,
    kind: "found",
    secret,
  };
}

function unsupportedMutation(): HostSecretMutationResult {
  return {
    ok: false,
    code: "host-secret-store-unsupported",
  };
}
