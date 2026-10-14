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
//   - Native Apple assessment of staged and retained application bundles.
// - Must-Not:
//   - Extract, install, launch, alter quarantine, or accept unsigned code.
// - Allows:
//   - Inputs: Local bundle path, publisher trust, and signed new-release
//     context or the captured previously installed version.
//   - Outputs: Bounded verification results requiring safe installation.
//   - Side effects: Bounded native read-only verification processes.
// - Split-When:
//   - Transactional bundle replacement needs an independent authority.
// - Merge-When:
//   - Apple assessment becomes part of one native installation boundary.
// - Summary:
//   - Checks publisher identity, bundle versions, and notarized OS acceptance.
// - Description:
//   - Signature validity alone cannot admit a different Apple publisher.
// - Usage:
//   - Assess immutable new staging or retained old code during installation.
// - Defaults:
//   - Unsupported hosts, absent trust, and unavailable tools fail closed.
//
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { appleBuildVersion, decodeProductVersion } from
  "../../../ir/product-version/contract/version.ts";
import { UPDATE_BUNDLE_ID, isAdmittedMinimumMacos } from
  "../../../ir/update-manifests/contract/manifest.ts";
import { verifySignedUpdateManifest } from "./verify.ts";

const executeFile = promisify(execFile);
export type AppleAssessmentCommand = (
  executable: string,
  arguments_: readonly string[],
  signal: AbortSignal,
) => Promise<{ readonly stdout: string; readonly stderr: string }>;
export interface AppleBundleVerificationOptions {
  readonly bundlePath: string;
  readonly publisherTeamId: string;
  readonly verification: Parameters<typeof verifySignedUpdateManifest>[0];
  readonly signal?: AbortSignal;
  // Trusted composition/test dependencies; none are remote command arguments.
  readonly host?: { readonly platform: string; readonly architecture: string };
  readonly execute?: AppleAssessmentCommand;
  readonly timeoutMs?: number;
}
export interface AppleInstalledBundleVerificationOptions extends
  Omit<AppleBundleVerificationOptions, "verification"> {
  readonly version: string;
}
type VerificationReason =
  | "manifest" | "publisher" | "unsupported-host" | "bundle"
  | "metadata" | "incompatible-os" | "architecture" | "signature" | "gatekeeper"
  | "timeout" | "cancelled";
export type AppleBundleVerificationResult =
  | {
      readonly status: "verified";
      readonly version: string;
      readonly requiresTransactionalInstallation: true;
    }
  | {
      readonly status: "verification-failed";
      readonly reason: VerificationReason;
    };

// This never substitutes for authenticated archive bytes or safe extraction.
// Staging ownership and immutability remain the caller's responsibility.
export async function verifyAppleUpdateBundle(
  options: AppleBundleVerificationOptions,
): Promise<AppleBundleVerificationResult> {
  const fail = (reason: VerificationReason): AppleBundleVerificationResult =>
    ({ status: "verification-failed", reason });
  const verified = verifySignedUpdateManifest(options.verification);
  if (!verified.ok) return fail("manifest");
  return await assessAppleBundle(options, {
    version: verified.manifest.version,
    bundleId: verified.manifest.bundleId,
    minimumMacos: verified.manifest.minimumMacos,
  });
}

// A retained, previously installed bundle may predate update manifests. Only
// trusted local installation composition supplies its captured old version.
// Reassess Apple identity and notarization directly; never use this entrypoint
// to admit a downloaded candidate instead of its signed release context.
export async function verifyAppleInstalledBundle(
  options: AppleInstalledBundleVerificationOptions,
): Promise<AppleBundleVerificationResult> {
  try { decodeProductVersion(options.version); }
  catch { return { status: "verification-failed", reason: "metadata" }; }
  return await assessAppleBundle(options, {
    version: options.version, bundleId: UPDATE_BUNDLE_ID,
  });
}

async function assessAppleBundle(
  options: Omit<AppleBundleVerificationOptions, "verification">,
  identity: { readonly version: string; readonly bundleId: string;
    readonly minimumMacos?: string },
): Promise<AppleBundleVerificationResult> {
  const fail = (reason: VerificationReason): AppleBundleVerificationResult =>
    ({ status: "verification-failed", reason });
  if (typeof options.publisherTeamId !== "string" ||
      !/^[A-Z0-9]{10}$/u.test(options.publisherTeamId))
    return fail("publisher");
  const host = options.host ?? {
    platform: process.platform, architecture: process.arch,
  };
  if (host.platform !== "darwin" || host.architecture !== "arm64")
    return fail("unsupported-host");
  if (typeof options.bundlePath !== "string" ||
      !isAbsolute(options.bundlePath) || options.bundlePath.length > 4_096 ||
      /[\x00-\x1f\x7f]/u.test(options.bundlePath) ||
      basename(options.bundlePath) !== "Blooket API.app")
    return fail("bundle");
  const timeout = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000)
    throw new Error("invalid-apple-verification-timeout");
  if (options.signal?.aborted) return fail("cancelled");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeout);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const execute: AppleAssessmentCommand = options.execute ??
    (async (file, args, commandSignal) => await executeFile(file, [...args], {
      signal: commandSignal,
      killSignal: "SIGKILL",
      maxBuffer: 65_536,
      env: { ...process.env, LC_ALL: "C" },
    }));
  async function run(file: string, args: readonly string[]) {
    if (signal.aborted) throw new Error("verification-aborted");
    let removeAbort: () => void = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", abort, { once: true });
      function abort() { reject(new Error("verification-aborted")); }
      removeAbort = () => signal.removeEventListener("abort", abort);
    });
    try {
      const result = await Promise.race([
        execute(file, args, signal), interrupted,
      ]);
      if (signal.aborted || typeof result?.stdout !== "string" ||
          typeof result.stderr !== "string" ||
          Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)
            > 65_536)
        throw new Error("invalid-verification-response");
      return result;
    } finally { removeAbort(); }
  }
  let phase: VerificationReason = "bundle";
  try {
    const path = resolve(options.bundlePath);
    if (await realpath(path) !== path || !(await lstat(path)).isDirectory())
      return fail("bundle");
    const plist = join(path, "Contents/Info.plist");
    if (await realpath(plist) !== plist || !(await lstat(plist)).isFile())
      return fail("bundle");
    phase = "metadata";
    let minimumMacos = identity.minimumMacos;
    const expected = {
      CFBundleIdentifier: identity.bundleId,
      CFBundlePackageType: "APPL",
      CFBundleExecutable: "Blooket API",
      CFBundleShortVersionString: identity.version,
      CFBundleVersion: appleBuildVersion(identity.version),
      ...(minimumMacos === undefined ? {} : {
        LSMinimumSystemVersion: minimumMacos,
      }),
    };
    for (const [key, value] of Object.entries(expected)) {
      const observed = await run("/usr/bin/plutil", [
        "-extract", key, "raw", "-o", "-", plist,
      ]);
      if (observed.stdout !== value && observed.stdout !== value + "\n")
        return fail("metadata");
    }
    if (minimumMacos === undefined) {
      const observed = await run("/usr/bin/plutil", [
        "-extract", "LSMinimumSystemVersion", "raw", "-o", "-", plist,
      ]);
      const value = observed.stdout.endsWith("\n")
        ? observed.stdout.slice(0, -1) : observed.stdout;
      if (!isAdmittedMinimumMacos(value)) return fail("metadata");
      minimumMacos = value;
    }
    phase = "incompatible-os";
    const system = (await run("/usr/bin/sw_vers", ["-productVersion"]))
      .stdout.trim();
    const component = "(?:0|[1-9][0-9]{0,2})";
    const systemPattern = new RegExp(
      "^" + component + "\\." + component + "(?:\\." + component + ")?$", "u",
    );
    if (!systemPattern.test(system))
      return fail("incompatible-os");
    const minimum = minimumMacos.split(".").map(Number);
    const actual = system.split(".").map(Number);
    let compatible = true;
    for (let index = 0; index < 3; index++) {
      const difference = (actual[index] ?? 0) - (minimum[index] ?? 0);
      if (difference !== 0) { compatible = difference > 0; break; }
    }
    if (!compatible) return fail("incompatible-os");
    phase = "architecture";
    const runtime = join(path, "Contents/Resources/runtime/node");
    if (await realpath(runtime) !== runtime ||
        !(await lstat(runtime)).isFile()) return fail("architecture");
    // Read only Apple's fixed 32-byte mach_header_64. The shipped Node target
    // is a thin little-endian ARM64 executable, not a universal container.
    // This is an architecture check, not full Mach-O or signature validation.
    const binary = await open(
      runtime, constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const header = Buffer.alloc(32);
    try {
      const { bytesRead } = await binary.read(header, 0, header.length, 0);
      if (bytesRead !== header.length ||
          header.readUInt32LE(0) !== 0xfeedfacf || // MH_MAGIC_64
          header.readUInt32LE(4) !== 0x0100000c || // CPU_TYPE_ARM64
          header.readUInt32LE(8) !== 0 || // CPU_SUBTYPE_ARM64_ALL
          header.readUInt32LE(12) !== 2) // MH_EXECUTE
        return fail("architecture");
    } finally { await binary.close(); }
    phase = "signature";
    const requirement = 'anchor apple generic and identifier "' +
      identity.bundleId + '" and certificate leaf[subject.OU] = "' +
      options.publisherTeamId + '" and certificate leaf[' +
      'field.1.2.840.113635.100.6.1.13] exists';
    await run("/usr/bin/codesign", [
      "--verify", "--deep", "--strict", "-R", requirement, path,
    ]);
    phase = "gatekeeper";
    const assessed = await run("/usr/sbin/spctl", [
      "--assess", "--type", "execute", "--verbose=4", path,
    ]);
    // A local override or ordinary Developer ID acceptance does not prove
    // notarization. Do not disable Gatekeeper or remove quarantine to proceed.
    const sources = (assessed.stdout + "\n" + assessed.stderr).split(/\r?\n/u)
      .filter(line => line.startsWith("source="));
    if (sources.length !== 1 || sources[0] !== "source=Notarized Developer ID")
      return fail("gatekeeper");
    return {
      status: "verified", version: identity.version,
      requiresTransactionalInstallation: true,
    };
  } catch {
    return fail(signal.aborted
      ? options.signal?.aborted ? "cancelled" : "timeout" : phase);
  } finally {
    clearTimeout(timer);
  }
}
