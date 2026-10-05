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
//   - Resolving persisted local-service settings before server startup.
// - Must-Not:
//   - Start the HTTP server, expose non-loopback listeners, or change port
//     mode.
// - Allows:
//   - Inputs: A trusted settings-file path.
//   - Outputs: Resolved settings or stable settings/port failure codes.
//   - Side effects: Loads settings and persists an automatic replacement port.
// - Split-When:
//   - Server lifecycle orchestration requires independently versioned behavior.
// - Merge-When:
//   - Port selection moves entirely into one localhost server application.
// - Summary:
//   - Makes fixed collisions explicit and automatic alternatives durable.
// - Description:
//   - Persists a newly selected port only when automatic mode changed it.
// - Usage:
//   - Resolve immediately before the authoritative localhost server bind.
// - Defaults:
//   - The server bind remains authoritative because availability probes can
//     race.
//
import { loadSettingsFile, saveSettingsFile } from
  "../../../platforms/settings-files/adapter-outbound/file.ts";
import { resolveConfiguredTcpPort } from
  "../../../platforms/tcp-ports/adapter-outbound/tcp-port.ts";
import type { LocalServiceSettings } from
  "../../../settings/local-service/domain/local-service-settings.ts";

export type ResolvedLocalServiceSettings =
  | { readonly ok: true; readonly settings: LocalServiceSettings }
  | {
      readonly ok: false;
      readonly code:
        | "settings-load-failed"
        | "configured-port-in-use"
        | "port-allocation-failed"
        | "settings-save-failed";
    };

export async function resolvePersistedLocalServiceSettings(
  settingsPath: string,
): Promise<ResolvedLocalServiceSettings> {
  const loaded = await loadSettingsFile(settingsPath);
  if (!loaded.ok) {
    return { ok: false, code: "settings-load-failed" };
  }

  const resolved = await resolveConfiguredTcpPort(loaded.settings);
  if (!resolved.ok) {
    return resolved;
  }

  if (resolved.changed) {
    const saved = await saveSettingsFile(settingsPath, resolved.settings);
    if (!saved.ok) {
      return { ok: false, code: "settings-save-failed" };
    }
  }

  return { ok: true, settings: resolved.settings };
}
