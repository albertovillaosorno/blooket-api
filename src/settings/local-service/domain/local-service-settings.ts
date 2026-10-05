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
//   - Current local-service settings and the version-one migration boundary.
// - Must-Not:
//   - Bind sockets, select a new port, persist files, or expose network access.
// - Allows:
//   - Inputs: Unknown version-one or version-two settings candidates.
//   - Outputs: Strict current settings or structured validation failures.
//   - Side effects: None.
// - Split-When:
//   - Desktop lifecycle and local network settings evolve independently.
// - Merge-When:
//   - Local service configuration ceases to be persisted.
// - Summary:
//   - Defines safe loopback settings with explicit schema migration.
// - Description:
//   - Version two adds theme behavior while preserving version-one settings.
// - Usage:
//   - Decode settings before any platform or service adapter consumes them.
// - Defaults:
//   - The service uses 127.0.0.1:2607 and follows the operating-system theme.
//
import {
  decodeFailure,
  type DecodeResult,
  type ValidationIssue,
} from "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";

export const SETTINGS_SCHEMA_VERSION = 2 as const;
export const DEFAULT_BIND_ADDRESS = "127.0.0.1" as const;
export const DEFAULT_PORT = 2607 as const;

export type ThemePreference = "system" | "light" | "dark";

export interface LocalServiceSettings {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly bindAddress: string;
  readonly port: number;
  readonly portMode: "fixed" | "automatic";
  readonly launchAtLogin: boolean;
  readonly startMinimized: boolean;
  readonly startServiceOnLaunch: boolean;
  readonly theme: ThemePreference;
}

const VERSION_ONE_KEYS = new Set([
  "schemaVersion",
  "bindAddress",
  "port",
  "portMode",
  "launchAtLogin",
  "startMinimized",
  "startServiceOnLaunch",
]);
const VERSION_TWO_KEYS = new Set([...VERSION_ONE_KEYS, "theme"]);

export function defaultLocalServiceSettings(): LocalServiceSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    bindAddress: DEFAULT_BIND_ADDRESS,
    port: DEFAULT_PORT,
    portMode: "fixed",
    launchAtLogin: false,
    startMinimized: false,
    startServiceOnLaunch: true,
    theme: "system",
  };
}

export function decodeLocalServiceSettings(
  value: unknown,
): DecodeResult<LocalServiceSettings> {
  if (!isRecord(value)) {
    return decodeFailure("$", "expected-object", "Expected settings object.");
  }

  if (value["schemaVersion"] === 1) {
    return decodeKnownVersion(value, VERSION_ONE_KEYS, "system");
  }
  if (value["schemaVersion"] === SETTINGS_SCHEMA_VERSION) {
    return decodeKnownVersion(value, VERSION_TWO_KEYS, value["theme"]);
  }

  return decodeFailure(
    "$.schemaVersion",
    "unsupported-version",
    "Expected settings schema version 1 or 2.",
  );
}

function decodeKnownVersion(
  value: Readonly<Record<string, unknown>>,
  keys: ReadonlySet<string>,
  themeValue: unknown,
): DecodeResult<LocalServiceSettings> {
  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, keys, "$"),
  ];
  const bindAddress = value["bindAddress"];
  const port = value["port"];
  const portMode = value["portMode"];
  const launchAtLogin = value["launchAtLogin"];
  const startMinimized = value["startMinimized"];
  const startServiceOnLaunch = value["startServiceOnLaunch"];
  const theme = decodeTheme(themeValue, issues);

  if (typeof bindAddress !== "string" || !isLoopbackAddress(bindAddress)) {
    issues.push({
      path: "$.bindAddress",
      code: "non-loopback-address",
      message: "Expected an IPv4 or IPv6 loopback address.",
    });
  }
  if (!isPort(port)) {
    issues.push({
      path: "$.port",
      code: "invalid-port",
      message: "Expected an integer TCP port from 1 through 65535.",
    });
  }
  if (portMode !== "fixed" && portMode !== "automatic") {
    issues.push({
      path: "$.portMode",
      code: "invalid-port-mode",
      message: 'Expected "fixed" or "automatic".',
    });
  }

  validateBoolean(launchAtLogin, "$.launchAtLogin", issues);
  validateBoolean(startMinimized, "$.startMinimized", issues);
  validateBoolean(startServiceOnLaunch, "$.startServiceOnLaunch", issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  if (
    typeof bindAddress !== "string"
    || typeof port !== "number"
    || (portMode !== "fixed" && portMode !== "automatic")
    || typeof launchAtLogin !== "boolean"
    || typeof startMinimized !== "boolean"
    || typeof startServiceOnLaunch !== "boolean"
    || theme === undefined
  ) {
    return decodeFailure("$", "decoder-invariant", "Decoder invariant failed.");
  }

  return {
    ok: true,
    value: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      bindAddress,
      port,
      portMode,
      launchAtLogin,
      startMinimized,
      startServiceOnLaunch,
      theme,
    },
  };
}

export function isLoopbackAddress(value: string): boolean {
  if (value === "::1") {
    return true;
  }
  const octets = value.split(".");
  if (octets.length !== 4) {
    return false;
  }
  const numbers = octets.map(parseIpv4Octet);
  return numbers.every((octet) => octet !== undefined)
    && numbers[0] === 127;
}

export function isPort(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= 65535;
}

function decodeTheme(
  value: unknown,
  issues: ValidationIssue[],
): ThemePreference | undefined {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }
  issues.push({
    path: "$.theme",
    code: "invalid-theme",
    message: 'Expected "system", "light", or "dark".',
  });
  return undefined;
}

function parseIpv4Octet(value: string): number | undefined {
  if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return parsed <= 255 ? parsed : undefined;
}

function validateBoolean(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== "boolean") {
    issues.push({
      path,
      code: "expected-boolean",
      message: "Expected true or false.",
    });
  }
}
