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
//   - Ordinary teacher settings and explicit legacy migrations.
// - Must-Not:
//   - Store secrets or individual image adjustments.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Ordinary teacher settings and explicit legacy migrations.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { isAbsolute } from "node:path";
import {
  decodeLocalServiceSettings,
  defaultLocalServiceSettings,
  type LocalServiceSettings,
} from "../../local-service/domain/local-service-settings.ts";

export interface ExportDefaults {
  readonly width: number;
  readonly height: number;
  readonly gifFps: number;
  readonly compression: "lossless" | "compact";
}
export interface TeacherPreferences {
  readonly schemaVersion: 3;
  readonly service: LocalServiceSettings;
  readonly locale: "en" | "es";
  readonly email: string;
  readonly mediaRoot: string;
  readonly online: {
    readonly enabled: boolean;
    readonly publicUrl: string;
    readonly provider: "cloudflare";
  };
  readonly defaults: ExportDefaults;
}
export function defaultTeacherPreferences(
  mediaRoot: string,
): TeacherPreferences {
  return {
    schemaVersion: 3,
    service: defaultLocalServiceSettings(),
    locale: "es",
    email: "",
    mediaRoot,
    online: { enabled: false, publicUrl: "", provider: "cloudflare" },
    defaults: { width: 1280, height: 720, gifFps: 10, compression: "compact" },
  };
}
export function decodeTeacherPreferences(
  value: unknown,
  defaultRoot: string,
): TeacherPreferences {
  const record = object(value);
  if (record["schemaVersion"] === 1 || record["schemaVersion"] === 2) {
    const old = decodeLocalServiceSettings(value);
    if (!old.ok) throw new Error("invalid-settings");
    return { ...defaultTeacherPreferences(defaultRoot), service: old.value };
  }
  exact(record, [
    "schemaVersion",
    "service",
    "locale",
    "email",
    "mediaRoot",
    "online",
    "defaults",
  ]);
  const service = decodeLocalServiceSettings(record["service"]);
  const online = object(record["online"]);
  exact(online, ["enabled", "publicUrl", "provider"]);
  const defaults = object(record["defaults"]);
  exact(defaults, ["width", "height", "gifFps", "compression"]);
  if (
    record["schemaVersion"] !== 3 ||
    !service.ok ||
    (record["locale"] !== "en" && record["locale"] !== "es") ||
    typeof record["email"] !== "string" ||
    record["email"].length > 254 ||
    (record["email"] !== "" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(record["email"])) ||
    typeof record["mediaRoot"] !== "string" ||
    !isAbsolute(record["mediaRoot"]) ||
    record["mediaRoot"].includes("\0") ||
    typeof online["enabled"] !== "boolean" ||
    online["provider"] !== "cloudflare" ||
    typeof online["publicUrl"] !== "string" ||
    (online["publicUrl"] !== "" && !validMcpUrl(online["publicUrl"])) ||
    (online["enabled"] && online["publicUrl"] === "") ||
    !integer(defaults["width"], 16, 1920) ||
    !integer(defaults["height"], 16, 1920) ||
    typeof defaults["gifFps"] !== "number" ||
    ![1, 2, 5, 10, 20, 25, 50].includes(defaults["gifFps"]) ||
    (defaults["compression"] !== "lossless" &&
      defaults["compression"] !== "compact")
  )
    throw new Error("invalid-settings");
  return value as TeacherPreferences;
}
function validMcpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname === "/mcp" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid-object");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  )
    throw new Error("unknown-or-missing-field");
}
function integer(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}
