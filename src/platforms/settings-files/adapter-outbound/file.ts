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
//   - Durable loading and replacement of local service settings files.
// - Must-Not:
//   - Choose product paths, bind sockets, or interpret settings semantics.
// - Allows:
//   - Inputs: Trusted settings paths and current validated settings values.
//   - Outputs: Current settings, defaults, or stable I/O and validation
//     failures.
//   - Side effects: Reads settings and atomically replaces files with backups.
// - Split-When:
//   - Host-specific settings locations require independent path providers.
// - Merge-When:
//   - Settings cease to use local JSON persistence.
// - Summary:
//   - Persists versioned settings through the repository atomic-file adapter.
// - Description:
//   - Missing files return defaults and version-one files migrate on decode.
// - Usage:
//   - Call after a platform path provider selects the settings file location.
// - Defaults:
//   - Successful saves retain one previous-value `.bak` file when available.
//
import {
  lstat,
  readFile,
} from "node:fs/promises";

import {
  decodeLocalServiceSettings,
  defaultLocalServiceSettings,
  type LocalServiceSettings,
} from "../../../settings/local-service/domain/local-service-settings.ts";
import { writeAtomicFile } from
  "../../atomic-files/adapter-outbound/atomic-file.ts";

export type SettingsFileLoadResult =
  | {
      readonly ok: true;
      readonly settings: LocalServiceSettings;
      readonly source: "default" | "file";
    }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code: "settings-file-unsafe" | "settings-file-unreadable";
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly {
        readonly path: string;
        readonly code: string;
        readonly message: string;
      }[];
    };

export type SettingsFileSaveResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code: "settings-file-unsafe" | "settings-write-failed";
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly {
        readonly path: string;
        readonly code: string;
        readonly message: string;
      }[];
    };

export async function loadSettingsFile(
  path: string,
): Promise<SettingsFileLoadResult> {
  const read = await readOwnedTextFile(path);
  if (read.kind === "missing") {
    return {
      ok: true,
      settings: defaultLocalServiceSettings(),
      source: "default",
    };
  }
  if (read.kind === "unsafe") {
    return ioLoadFailure("settings-file-unsafe");
  }
  if (read.kind === "unreadable") {
    return ioLoadFailure("settings-file-unreadable");
  }

  let value: unknown;
  try {
    value = JSON.parse(read.value);
  } catch {
    return {
      ok: false,
      kind: "invalid",
      issues: [
        {
          path: "$",
          code: "invalid-json",
          message: "Settings file contains invalid JSON.",
        },
      ],
    };
  }

  const decoded = decodeLocalServiceSettings(value);
  if (!decoded.ok) {
    return { ok: false, kind: "invalid", issues: decoded.issues };
  }
  return { ok: true, settings: decoded.value, source: "file" };
}

export async function saveSettingsFile(
  path: string,
  settings: LocalServiceSettings,
): Promise<SettingsFileSaveResult> {
  const decoded = decodeLocalServiceSettings(settings);
  if (!decoded.ok) {
    return { ok: false, kind: "invalid", issues: decoded.issues };
  }

  const existing = await readOwnedTextFile(path);
  if (existing.kind === "unsafe" || existing.kind === "unreadable") {
    return ioSaveFailure("settings-file-unsafe");
  }

  const contents = `${JSON.stringify(decoded.value, null, 2)}\n`;
  try {
    await writeAtomicFile(
      path,
      contents,
      existing.kind === "text" ? { backupPath: `${path}.bak` } : {},
    );
    return { ok: true };
  } catch {
    return ioSaveFailure("settings-write-failed");
  }
}

async function readOwnedTextFile(path: string): Promise<
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unsafe" }
  | { readonly kind: "unreadable" }
> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return { kind: "unsafe" };
    }
    return { kind: "text", value: await readFile(path, "utf8") };
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return { kind: "missing" };
    }
    return { kind: "unreadable" };
  }
}

function ioLoadFailure(
  code: "settings-file-unsafe" | "settings-file-unreadable",
): SettingsFileLoadResult {
  return { ok: false, kind: "io", code };
}

function ioSaveFailure(
  code: "settings-file-unsafe" | "settings-write-failed",
): SettingsFileSaveResult {
  return { ok: false, kind: "io", code };
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}
