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
//   - Host user-data paths and atomic preference file persistence.
// - Must-Not:
//   - Persist passwords, tunnel credentials, or browser cookies.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Host user-data paths and atomic preference file persistence.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import {
  defaultTeacherPreferences,
  decodeTeacherPreferences,
  type TeacherPreferences,
} from "../../../settings/teacher-preferences/domain/preferences.ts";
import {
  writeAtomicFile,
  writeDurableFileIfAbsent,
} from "../../atomic-files/adapter-outbound/atomic-file.ts";
import { tryAcquireFileLock } from
  "../../file-locks/adapter-outbound/file-lock.ts";

export function userDataRoot(): string {
  const override = process.env["BLOOKET_DATA_HOME"];
  if (override !== undefined) {
    if (!isAbsolute(override)) throw new Error("invalid-user-data-root");
    return override;
  }
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "blooket-api")
    : join(homedir(), ".local", "share", "blooket-api");
}
export async function loadPreferences(
  root = userDataRoot(),
): Promise<TeacherPreferences> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    return decodeTeacherPreferences(
      JSON.parse(await readFile(join(root, "settings.json"), "utf8")),
      join(root, "media"),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new Error("settings-unreadable");
    const defaults = defaultTeacherPreferences(join(root, "media"));
    await writeDurableFileIfAbsent(
      join(root, "settings.json"),
      JSON.stringify(defaults, null, 2) + "\n",
    );
    return loadPreferences(root);
  }
}
export async function savePreferences(
  root: string,
  settings: TeacherPreferences,
): Promise<void> {
  decodeTeacherPreferences(settings, join(root, "media"));
  const acquired = await tryAcquireFileLock(join(root, ".settings.lock"));
  if (!acquired.ok) throw new Error("settings-" + acquired.reason);
  try {
    await writeAtomicFile(
      join(root, "settings.json"),
      JSON.stringify(settings, null, 2) + "\n",
      { backupPath: join(root, "settings.previous.json") },
    );
  } finally {
    await acquired.lock.release();
  }
}
