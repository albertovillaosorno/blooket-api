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
//   - Version-one settings for the local service and desktop startup behavior.
// - Must-Not:
//   - Bind sockets, select a new port, or expose the API beyond loopback.
// - Allows:
//   - Inputs: Unknown runtime settings candidates.
//   - Outputs: Strict local-service settings or validation failures.
//   - Side effects: None.
// - Split-When:
//   - Desktop lifecycle and local network settings evolve independently.
// - Merge-When:
//   - Local service configuration ceases to be persisted.
// - Summary:
//   - Defines safe configurable loopback service settings.
// - Description:
//   - Keeps preferred port, collision policy, and startup preferences explicit.
// - Usage:
//   - Decode settings before any platform or service adapter consumes them.
// - Defaults:
//   - The service starts on 127.0.0.1:2607 in fixed-port mode.
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

export const SETTINGS_SCHEMA_VERSION = 1 as const;
export const DEFAULT_BIND_ADDRESS = "127.0.0.1" as const;
export const DEFAULT_PORT = 2607 as const;

export interface LocalServiceSettings {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly bindAddress: string;
  readonly port: number;
  readonly portMode: "fixed" | "automatic";
  readonly launchAtLogin: boolean;
  readonly startMinimized: boolean;
  readonly startServiceOnLaunch: boolean;
}

const SETTINGS_KEYS = new Set([
  "schemaVersion",
  "bindAddress",
  "port",
  "portMode",
  "launchAtLogin",
  "startMinimized",
  "startServiceOnLaunch",
]);

export function defaultLocalServiceSettings(): LocalServiceSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    bindAddress: DEFAULT_BIND_ADDRESS,
    port: DEFAULT_PORT,
    portMode: "fixed",
    launchAtLogin: false,
    startMinimized: false,
    startServiceOnLaunch: true,
  };
}

export function decodeLocalServiceSettings(
  value: unknown,
): DecodeResult<LocalServiceSettings> {
  if (!isRecord(value)) {
    return decodeFailure("$", "expected-object", "Expected settings object.");
  }

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, SETTINGS_KEYS, "$"),
  ];
  const bindAddress = value["bindAddress"];
  const port = value["port"];
  const portMode = value["portMode"];
  const launchAtLogin = value["launchAtLogin"];
  const startMinimized = value["startMinimized"];
  const startServiceOnLaunch = value["startServiceOnLaunch"];

  if (value["schemaVersion"] !== SETTINGS_SCHEMA_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected settings schema version 1.",
    });
  }

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
