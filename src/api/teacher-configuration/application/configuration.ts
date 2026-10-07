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
//   - Local settings saves and lightweight first-use diagnostics.
// - Must-Not:
//   - Return stored secrets or mutate Blooket during diagnostics.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Local settings saves and lightweight first-use diagnostics.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import { join } from "node:path";
import { mkdir, access, open, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  object,
  exact,
  text,
} from "../../../media/library-metadata/domain/metadata.ts";
import { decodeTeacherPreferences } from
  "../../../settings/teacher-preferences/domain/preferences.ts";
import {
  loadPreferences,
  savePreferences,
} from "../../../platforms/user-storage/adapter-outbound/root.ts";
import { initializeLibrary } from
  "../../../platforms/user-library/adapter-outbound/files.ts";
import { createHostSecretStore } from
  "../../../platforms/host-secret-store/adapter-outbound/host-secret-store.ts";
import {
  validateHostSecretValue,
  type HostSecretStore,
} from "../../../security/host-secrets/domain/host-secret.ts";
import { tryAcquireFileLock } from
  "../../../platforms/file-locks/adapter-outbound/file-lock.ts";
import { writeAtomicFile } from
  "../../../platforms/atomic-files/adapter-outbound/atomic-file.ts";
import { loadSharp } from
  "../../../media/sharp-runtime/adapter-outbound/sharp-runtime.ts";
import { decodeImageIsolated } from
  "../../../platforms/native-media/adapter-outbound/process.ts";
import { safeCode } from "../../teacher-library/application/library.ts";
import {
  createOwnerPasswordVerifier,
  OWNER_VERIFIER_SECRET,
} from "../../../security/owner-password/domain/verifier.ts";
import {
  decodeFirstUseDiagnostic,
  DIAGNOSTIC_MAX_BYTES,
  DIAGNOSTIC_LOG,
  type DiagnosticCheck,
  type FirstUseDiagnostic,
} from "../../../ir/first-use-diagnostics/contract/state.ts";

export async function configurationStatus(
  root: string,
  secrets: HostSecretStore = createHostSecretStore(),
) {
  const preferences = await loadPreferences(root);
  const [password, tunnel, owner] = await Promise.all([
    secrets.read("blooket.password"),
    secrets.read("cloudflare-tunnel"),
    secrets.read(OWNER_VERIFIER_SECRET),
  ]);
  return {
    preferences,
    secrets: {
      passwordConfigured: password.ok && password.kind === "found",
      tunnelConfigured: tunnel.ok && tunnel.kind === "found",
      ownerPasswordConfigured: owner.ok && owner.kind === "found",
      storeAvailable: password.ok && tunnel.ok && owner.ok,
    },
  };
}
export async function saveConfiguration(
  root: string,
  input: unknown,
  secrets: HostSecretStore = createHostSecretStore(),
) {
  const request = object(input);
  exact(request, [
    "preferences",
    "password",
    "tunnelToken",
    ...("ownerPassword" in request ? ["ownerPassword"] : []),
  ]);
  if ("ownerPassword" in request && !text(request["ownerPassword"], 2048))
    throw new Error("invalid-secret-replacement");
  if (!text(request["password"], 2048) || !text(request["tunnelToken"], 2048))
    throw new Error("invalid-secret-replacement");
  for (const field of ["password", "tunnelToken", "ownerPassword"] as const) {
    const value = (request[field] ?? "") as string;
    if (value !== "" && !validateHostSecretValue(value).ok)
      throw new Error("invalid-secret-replacement");
  }
  const preferences = decodeTeacherPreferences(
    request["preferences"],
    join(root, "media"),
  );
  const acquired = await tryAcquireFileLock(join(root, ".configuration.lock"));
  if (!acquired.ok)
    return {
      ok: false,
      code: "configuration-" + acquired.reason,
      secretsSaved: [],
      settingsSaved: false,
    };
  try {
    return await saveValidatedConfiguration(
      root,
      preferences,
      request,
      secrets,
    );
  } finally {
    await acquired.lock.release();
  }
}
async function saveValidatedConfiguration(
  root: string,
  preferences: ReturnType<typeof decodeTeacherPreferences>,
  request: Record<string, unknown>,
  secrets: HostSecretStore,
) {
  try {
    await initializeLibrary(preferences.mediaRoot);
  } catch {
    return {
      ok: false,
      code: "media-root-unavailable",
      secretsSaved: [],
      settingsSaved: false,
    };
  }
  const written: string[] = [];
  let ownerVerifier: string | undefined;
  if (request["ownerPassword"]) {
    try {
      ownerVerifier = await createOwnerPasswordVerifier(
        request["ownerPassword"] as string,
      );
    } catch {
      return {
        ok: false,
        code: "owner-verifier-failed",
        secretsSaved: written,
        settingsSaved: false,
      };
    }
  }
  for (const [field, key] of [
    ["password", "blooket.password"],
    ["tunnelToken", "cloudflare-tunnel"],
  ] as const) {
    const secret = request[field] as string;
    if (secret !== "") {
      const result = await secrets.write(key, secret).catch(() => ({
        ok: false as const,
        code: "host-secret-store-failed" as const,
      }));
      if (!result.ok)
        return {
          ok: false,
          code: result.code,
          secretsSaved: written,
          settingsSaved: false,
        };
      written.push(field);
    }
  }
  if (ownerVerifier) {
    const saved = await secrets
      .write(OWNER_VERIFIER_SECRET, ownerVerifier)
      .catch(() => ({
        ok: false as const,
        code: "host-secret-store-failed" as const,
      }));
    if (!saved.ok)
      return {
        ok: false,
        code: saved.code,
        secretsSaved: written,
        settingsSaved: false,
      };
    written.push("ownerPassword");
  }
  try {
    await savePreferences(root, preferences);
  } catch {
    return {
      ok: false,
      code: "settings-save-failed",
      secretsSaved: written,
      settingsSaved: false,
    };
  }
  return {
    ok: true,
    secretsSaved: written,
    settingsSaved: true,
    restartRequired: true,
  };
}
export async function chooseMediaFolder(): Promise<string> {
  if (process.platform !== "darwin")
    throw new Error("folder-picker-macos-only");
  const result = await promisify(execFile)(
    "/usr/bin/osascript",
    [
      "-e",
      'POSIX path of (choose folder with prompt "Choose ' +
        'your media library")',
    ],
    { timeout: 120_000, maxBuffer: 4096 },
  );
  return result.stdout.trim();
}
export async function runFirstUseDiagnostics(
  root: string,
  rerun = false,
): Promise<FirstUseDiagnostic> {
  const acquired = await tryAcquireFileLock(join(root, ".diagnostics.lock"));
  if (!acquired.ok) throw new Error("diagnostics-" + acquired.reason);
  try {
    return await inspectFirstUseDiagnostics(root, rerun);
  } finally {
    await acquired.lock.release();
  }
}
async function inspectFirstUseDiagnostics(root: string, rerun: boolean) {
  const statePath = join(root, "diagnostics.json");
  if (!rerun) {
    try {
      const state = decodeFirstUseDiagnostic(
        JSON.parse(await boundedDiagnostic(statePath)),
      );
      if (!state.ok) throw new Error("diagnostics-unreadable");
      return state.value;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw new Error("diagnostics-unreadable");
    }
  }
  const checks: DiagnosticCheck[] = [];
  checks.push({
    name: "runtime",
    status:
      Number(process.versions.node.split(".")[0]) >= 24 ? "passed" : "failed",
    code: "node-24-required",
  });
  checks.push({
    name: "macos",
    status: process.platform === "darwin" ? "passed" : "unverified",
    code:
      process.platform === "darwin"
        ? "macos-" + process.arch
        : "development-host",
  });
  try {
    const preferences = await loadPreferences(root);
    checks.push({ name: "settings", status: "passed", code: "settings-valid" });
    await initializeLibrary(preferences.mediaRoot);
    const probe = join(preferences.mediaRoot, ".diagnostic-write");
    await writeAtomicFile(probe, "storage-probe");
    await rm(probe);
    checks.push({
      name: "storage",
      status: "passed",
      code: "storage-writable",
    });
    checks.push({
      name: "online",
      status: preferences.online.enabled ? "unverified" : "unconfigured",
      code: preferences.online.enabled
        ? "connection-verification-required"
        : "online-disabled",
    });
  } catch (error) {
    checks.push({ name: "storage", status: "failed", code: safeCode(error) });
  }
  try {
    const sharp = await loadSharp();
    const png = await sharp(new Uint8Array([0, 0, 0, 255]), {
      raw: { width: 1, height: 1, channels: 4 },
    })
      .png()
      .toBuffer();
    const decoded = await decodeImageIsolated(png, 16);
    checks.push({
      name: "native-image",
      status: decoded.ok ? "passed" : "failed",
      code: decoded.ok ? "native-image-ready" : decoded.code,
    });
  } catch {
    checks.push({
      name: "native-image",
      status: "failed",
      code: "native-image-unavailable",
    });
  }
  try {
    await access(
      process.platform === "darwin"
        ? "/usr/bin/security"
        : "/usr/bin/secret-tool",
    );
    checks.push({
      name: "secret-store-client",
      status: "passed",
      code: "secret-client-present",
    });
  } catch {
    checks.push({
      name: "secret-store-client",
      status: "unconfigured",
      code: "secret-client-unavailable",
    });
  }
  const decoded = decodeFirstUseDiagnostic({
    schemaVersion: 1,
    checkVersion: 1,
    at: new Date().toISOString(),
    outcome: checks.some((check) => check.status === "failed")
      ? "failed"
      : "passed",
    checks,
    log: DIAGNOSTIC_LOG,
  });
  if (!decoded.ok) throw new Error("diagnostics-invalid-result");
  const state = decoded.value;
  await mkdir(join(root, "logs"), { recursive: true, mode: 0o700 });
  await writeAtomicFile(
    join(root, state.log),
    JSON.stringify(state, null, 2) + "\n",
  );
  await writeAtomicFile(statePath, JSON.stringify(state, null, 2) + "\n");
  return state;
}

async function boundedDiagnostic(path: string): Promise<string> {
  const handle = await open(
    path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > DIAGNOSTIC_MAX_BYTES)
      throw new Error("diagnostics-unreadable");
    const bytes = Buffer.alloc(DIAGNOSTIC_MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > DIAGNOSTIC_MAX_BYTES)
      throw new Error("diagnostics-unreadable");
    return bytes.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
}
