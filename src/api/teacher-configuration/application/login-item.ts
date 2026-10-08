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
//   - Explicit reversible login-item preference orchestration.
// - Must-Not:
//   - Guess OS approval, enable persistence implicitly, or expose secrets.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Explicit OS registration/removal and guarded
//     preference saves.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Explicit reversible login-item preference orchestration.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { join } from "node:path";
import { decodeLoginItemStatus, type LoginItemStatus } from
  "../../../ir/login-item-state/contract/state.ts";
import type { LoginItemControl } from
  "../../../platforms/service-lifecycle/adapter-outbound/login-item.ts";
import { loadPreferences, savePreferences } from
  "../../../platforms/user-storage/adapter-outbound/root.ts";
import { tryAcquireFileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import { isRecord } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";

export async function inspectLoginItem(control: LoginItemControl) {
  const decoded = decodeLoginItemStatus(await control.inspect().catch(() =>
    ({ schemaVersion: 1, state: "unavailable" })));
  return decoded.ok ? decoded.value
    : { schemaVersion: 1 as const, state: "unavailable" as const };
}
export async function setLoginItemPreference(
  root: string, input: unknown, control: LoginItemControl,
) {
  if (!isRecord(input) || Object.keys(input).join() !== "enabled" ||
      typeof input["enabled"] !== "boolean")
    throw new Error("invalid-login-item-request");
  const enabled = input["enabled"];
  const failure = async (code: string) => ({ ok: false, code,
    settingsSaved: false, loginItem: await inspectLoginItem(control) });
  const acquired = await tryAcquireFileLock(join(root, ".configuration.lock"));
  if (!acquired.ok) return failure("configuration-" + acquired.reason);
  try {
    const preferences = await loadPreferences(root);
    const before = await inspectLoginItem(control);
    if (["unsupported", "unavailable", "not-found"].includes(before.state))
      return failure("login-item-unavailable");
    let status: LoginItemStatus;
    try {
      const decoded = decodeLoginItemStatus(await control.setEnabled(enabled));
      if (!decoded.ok || !admitted(decoded.value, enabled))
        return failure("login-item-change-failed");
      status = decoded.value;
    } catch { return failure("login-item-change-failed"); }
    try {
      await savePreferences(root, { ...preferences, service: {
        ...preferences.service, launchAtLogin: enabled,
      } });
    } catch {
      try {
        // Restore observed OS state, not a potentially stale saved preference.
        const restored = decodeLoginItemStatus(await control.setEnabled(
          before.state !== "not-registered",
        ));
        if (!restored.ok || !admitted(restored.value,
          before.state !== "not-registered"))
          return failure("login-item-recovery-required");
      } catch { return failure("login-item-recovery-required"); }
      return failure("settings-save-failed");
    }
    return { ok: true, settingsSaved: true, loginItem: status };
  } finally { await acquired.lock.release(); }
}
function admitted(status: LoginItemStatus, enabled: boolean) {
  return enabled
    ? status.state === "enabled" || status.state === "requires-approval"
    : status.state === "not-registered";
}
