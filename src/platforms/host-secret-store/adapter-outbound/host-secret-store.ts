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
//   - macOS Keychain and Linux Secret Service persistence for host secrets.
// - Must-Not:
//   - Put secret material in process argv or expose command stderr to callers.
// - Allows:
//   - Inputs: Untrusted secret names and bounded trusted secret values.
//   - Outputs: Secret reads or stable secret-free result codes.
//   - Side effects: Reads, writes, and deletes OS-owned secret-store items.
// - Split-When:
//   - Windows Credential Manager gains an independently reviewed adapter.
// - Merge-When:
//   - All supported operating systems share one native secret API.
// - Summary:
//   - Stores credentials in the host's standard user secret store.
// - Description:
//   - Uses fixed system clients with encoded secret payloads passed via stdin.
// - Usage:
//   - Keep returned secrets inside trusted security/application boundaries.
// - Defaults:
//   - Service identity is blooket-api; unsupported hosts fail closed.
//
import {
  decodeHostSecretName,
  type HostSecretName,
  validateHostSecretValue,
} from "../../../security/host-secrets/domain/host-secret.ts";
import {
  runSecretCommand,
  type SecretCommandResult,
  type SecretCommandRunner,
} from "./command-runner.ts";

const SERVICE = "blooket-api";
const STORED_PREFIX = "v1.";
const MAC_SECURITY = "/usr/bin/security";
const LINUX_SECRET_TOOL = "/usr/bin/secret-tool";
const MAC_NOT_FOUND = 44;

export type HostSecretFailureCode =
  | "invalid-host-secret-name"
  | "host-secret-empty"
  | "host-secret-too-large"
  | "host-secret-store-unsupported"
  | "host-secret-store-unavailable"
  | "host-secret-store-failed"
  | "host-secret-data-invalid";

export type HostSecretReadResult =
  | { readonly ok: true; readonly kind: "found"; readonly secret: string }
  | { readonly ok: true; readonly kind: "missing" }
  | { readonly ok: false; readonly code: HostSecretFailureCode };

export type HostSecretMutationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: HostSecretFailureCode };

export interface HostSecretStoreOptions {
  readonly platform?: NodeJS.Platform;
  readonly runner?: SecretCommandRunner;
}

export async function readHostSecret(
  name: unknown,
  options: HostSecretStoreOptions = {},
): Promise<HostSecretReadResult> {
  const decoded = decodeHostSecretName(name);
  if (!decoded.ok) {
    return { ok: false, code: "invalid-host-secret-name" };
  }
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? runSecretCommand;
  if (platform === "darwin") {
    return await readMacSecret(decoded.value, runner);
  }
  if (platform === "linux") {
    return await readLinuxSecret(decoded.value, runner);
  }
  return { ok: false, code: "host-secret-store-unsupported" };
}

export async function writeHostSecret(
  name: unknown,
  secret: string,
  options: HostSecretStoreOptions = {},
): Promise<HostSecretMutationResult> {
  const decoded = decodeHostSecretName(name);
  if (!decoded.ok) {
    return { ok: false, code: "invalid-host-secret-name" };
  }
  const valid = validateHostSecretValue(secret);
  if (!valid.ok) {
    return { ok: false, code: valid.code };
  }
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? runSecretCommand;
  const stored = encodeStoredSecret(secret);
  const written = platform === "darwin"
    ? await writeMacSecret(decoded.value, stored, runner)
    : platform === "linux"
      ? await writeLinuxSecret(decoded.value, stored, runner)
      : { ok: false, code: "host-secret-store-unsupported" } as const;
  if (!written.ok) {
    return written;
  }
  const verified = await readHostSecret(decoded.value, { platform, runner });
  return verified.ok
    && verified.kind === "found"
    && verified.secret === secret
    ? { ok: true }
    : { ok: false, code: "host-secret-store-failed" };
}

export async function deleteHostSecret(
  name: unknown,
  options: HostSecretStoreOptions = {},
): Promise<HostSecretMutationResult> {
  const decoded = decodeHostSecretName(name);
  if (!decoded.ok) {
    return { ok: false, code: "invalid-host-secret-name" };
  }
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? runSecretCommand;
  if (platform === "darwin") {
    const result = await runner({
      command: MAC_SECURITY,
      args: [
        "delete-generic-password", "-a", decoded.value, "-s", SERVICE,
      ],
    });
    if (!result.ok) {
      return commandFailure(result);
    }
    return result.exitCode === 0 || result.exitCode === MAC_NOT_FOUND
      ? { ok: true }
      : { ok: false, code: "host-secret-store-failed" };
  }
  if (platform === "linux") {
    const result = await runner({
      command: LINUX_SECRET_TOOL,
      args: linuxIdentityArgs("clear", decoded.value),
    });
    if (!result.ok) {
      return commandFailure(result);
    }
    return result.exitCode === 0
      ? { ok: true }
      : { ok: false, code: "host-secret-store-failed" };
  }
  return { ok: false, code: "host-secret-store-unsupported" };
}

async function readMacSecret(
  name: HostSecretName,
  runner: SecretCommandRunner,
): Promise<HostSecretReadResult> {
  const result = await runner({
    command: MAC_SECURITY,
    args: ["find-generic-password", "-a", name, "-s", SERVICE, "-w"],
  });
  if (!result.ok) {
    return commandFailure(result);
  }
  if (result.exitCode === MAC_NOT_FOUND) {
    return { ok: true, kind: "missing" };
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    return { ok: false, code: "host-secret-store-failed" };
  }
  return decodeCommandSecret(result.stdout);
}

async function writeMacSecret(
  name: HostSecretName,
  stored: string,
  runner: SecretCommandRunner,
): Promise<HostSecretMutationResult> {
  const probe = await runner({
    command: MAC_SECURITY,
    args: ["find-generic-password", "-a", name, "-s", SERVICE],
  });
  if (!probe.ok) {
    return commandFailure(probe);
  }
  const update = probe.exitCode === 0
    ? true
    : probe.exitCode === MAC_NOT_FOUND
      ? false
      : undefined;
  if (update === undefined) {
    return { ok: false, code: "host-secret-store-failed" };
  }
  const result = await runner({
    command: MAC_SECURITY,
    args: ["-i"],
    stdin: Buffer.from(macWriteCommand(name, stored, update), "utf8"),
  });
  if (!result.ok) {
    return commandFailure(result);
  }
  return result.exitCode === 0 && result.signal === null
    ? { ok: true }
    : { ok: false, code: "host-secret-store-failed" };
}

async function readLinuxSecret(
  name: HostSecretName,
  runner: SecretCommandRunner,
): Promise<HostSecretReadResult> {
  const result = await runner({
    command: LINUX_SECRET_TOOL,
    args: linuxIdentityArgs("lookup", name),
  });
  if (!result.ok) {
    return commandFailure(result);
  }
  if (
    result.exitCode === 1
    && result.stdout.byteLength === 0
    && result.stderrBytes === 0
  ) {
    return { ok: true, kind: "missing" };
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    return { ok: false, code: "host-secret-store-failed" };
  }
  return decodeCommandSecret(result.stdout);
}

async function writeLinuxSecret(
  name: HostSecretName,
  stored: string,
  runner: SecretCommandRunner,
): Promise<HostSecretMutationResult> {
  const result = await runner({
    command: LINUX_SECRET_TOOL,
    args: [
      "store",
      "--label",
      SERVICE + ": " + name,
      "application",
      SERVICE,
      "key",
      name,
    ],
    stdin: Buffer.from(stored, "utf8"),
  });
  if (!result.ok) {
    return commandFailure(result);
  }
  return result.exitCode === 0 && result.signal === null
    ? { ok: true }
    : { ok: false, code: "host-secret-store-failed" };
}

function linuxIdentityArgs(
  operation: "lookup" | "clear",
  name: HostSecretName,
): readonly string[] {
  return [operation, "application", SERVICE, "key", name];
}

function macWriteCommand(
  name: HostSecretName,
  stored: string,
  update: boolean,
): string {
  const args = [
    "add-generic-password",
    "-a",
    name,
    "-s",
    SERVICE,
    "-l",
    SERVICE + "-" + name,
    ...(update ? ["-U"] : ["-T", MAC_SECURITY]),
    "-w",
    stored,
  ];
  return args.join(" ") + "\n";
}

function encodeStoredSecret(secret: string): string {
  return STORED_PREFIX
    + Buffer.from(secret, "utf8").toString("base64url");
}

function decodeCommandSecret(
  output: Uint8Array,
): HostSecretReadResult {
  const stored = stripOneLineEnding(Buffer.from(output).toString("utf8"));
  if (!stored.startsWith(STORED_PREFIX)) {
    return { ok: false, code: "host-secret-data-invalid" };
  }
  const payload = stored.slice(STORED_PREFIX.length);
  const decoded = Buffer.from(payload, "base64url");
  if (decoded.toString("base64url") !== payload) {
    return { ok: false, code: "host-secret-data-invalid" };
  }
  const secret = decoded.toString("utf8");
  if (!Buffer.from(secret, "utf8").equals(decoded)) {
    return { ok: false, code: "host-secret-data-invalid" };
  }
  return validateHostSecretValue(secret).ok
    ? { ok: true, kind: "found", secret }
    : { ok: false, code: "host-secret-data-invalid" };
}

function stripOneLineEnding(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function commandFailure(
  result: Extract<SecretCommandResult, { readonly ok: false }>,
): Extract<HostSecretReadResult, { readonly ok: false }> {
  return {
    ok: false,
    code: result.code === "secret-command-unavailable"
      ? "host-secret-store-unavailable"
      : "host-secret-store-failed",
  };
}
