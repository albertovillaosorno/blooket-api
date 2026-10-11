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
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
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
      JSON.parse(await readPreferenceText(join(root, "settings.json"))),
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

// Settings are bounded before allocation; no read may follow a switched
// symlink after pathname inspection or silently treat it as a missing file.
const MAX_PREFERENCE_BYTES = 65_536;

async function readPreferenceText(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) ||
        before.size > MAX_PREFERENCE_BYTES)
      throw new Error("settings-unreadable");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    let complete = false;
    while (length < bytes.length) {
      const part = await handle.read(bytes, length,
        bytes.length - length, null);
      if (part.bytesRead === 0) {
        complete = true;
        break;
      }
      length += part.bytesRead;
    }
    const after = await handle.stat();
    if (!complete || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs)
      throw new Error("settings-unreadable");
    return bytes.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
}
