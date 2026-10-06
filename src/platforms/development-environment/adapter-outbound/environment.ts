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
//   - Explicit development configuration and ephemeral secret overrides.
// - Must-Not:
//   - Persist development credentials or enable production dotenv loading.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Explicit development configuration and ephemeral secret overrides.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import {
  decodeTeacherPreferences,
  type TeacherPreferences,
} from "../../../settings/teacher-preferences/domain/preferences.ts";
import {
  validateHostSecretValue,
  type HostSecretStore,
} from "../../../security/host-secrets/domain/host-secret.ts";

export function developmentConfiguration(
  preferences: TeacherPreferences,
  environment: Readonly<Record<string, string | undefined>>,
  host: HostSecretStore,
): { preferences: TeacherPreferences; secrets: HostSecretStore } {
  if (environment["CLOUDLFARE_TOKEN"])
    throw new Error("misspelled-cloudflare-token");
  const email =
    setting(environment, "BLOOKET_EMAIL", "EMAIL") || preferences.email;
  const localPort = setting(environment, "LOCAL_HTTP_PORT", "LOCAL_PORT");
  if (localPort && !/^[1-9][0-9]{0,4}$/u.test(localPort))
    throw new Error("invalid-development-port");
  const publicUrl =
    setting(environment, "MCP_PUBLIC_URL", "ONLINE_DOMAIN") ||
    preferences.online.publicUrl;
  const ephemeral = new Map<string, string>();
  for (const [variable, legacy, key] of [
    ["BLOOKET_PASSWORD", "PASSWORD", "blooket.password"],
    ["CLOUDFLARE_TUNNEL_TOKEN", "CLOUDFLARE_TOKEN", "cloudflare-tunnel"],
  ] as const) {
    const secret = setting(environment, variable, legacy);
    if (secret) {
      if (!validateHostSecretValue(secret).ok)
        throw new Error("invalid-development-secret");
      ephemeral.set(key, secret);
    }
  }
  const decoded = decodeTeacherPreferences(
    {
      ...preferences,
      email,
      service: {
        ...preferences.service,
        port: localPort ? Number(localPort) : preferences.service.port,
      },
      online: {
        ...preferences.online,
        publicUrl,
        enabled:
          Boolean(publicUrl && ephemeral.has("cloudflare-tunnel")) ||
          preferences.online.enabled,
      },
    },
    preferences.mediaRoot,
  );
  return {
    preferences: decoded,
    secrets: {
      async read(name) {
        const secret = ephemeral.get(name);
        return secret === undefined
          ? await host.read(name)
          : { ok: true, kind: "found", secret };
      },
      async write(name, secret) {
        const result = await host.write(name, secret);
        if (result.ok) ephemeral.delete(name);
        return result;
      },
      async delete(name) {
        const result = await host.delete(name);
        if (result.ok) ephemeral.delete(name);
        return result;
      },
    },
  };
}
export async function readDevelopmentEnvironment(
  path: string,
): Promise<Readonly<Record<string, string | undefined>>> {
  try {
    const bytes = await readFile(path);
    if (bytes.length > 65_536) throw new Error("development-env-too-large");
    return parseEnv(bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return {};
    throw new Error("development-env-unreadable");
  }
}

function setting(
  environment: Readonly<Record<string, string | undefined>>,
  canonical: string,
  legacy: string,
): string | undefined {
  const current = environment[canonical];
  const previous = environment[legacy];
  if (current && previous && current !== previous)
    throw new Error("conflicting-development-setting");
  return current || previous;
}
