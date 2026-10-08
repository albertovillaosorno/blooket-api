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
//   - Portable regressions for native update assessment admission.
// - Must-Not:
//   - Claim real Apple trust, install software, or provision publisher keys.
// - Allows:
//   - Inputs: Ephemeral keys, owned test bundles, and native command doubles.
//   - Outputs: Assertions about bounded command sequencing and failures.
//   - Side effects: Test-owned temporary files removed after each fixture.
// - Split-When:
//   - A real signed Mac release fixture becomes available.
// - Merge-When:
//   - Native installation acceptance owns this complete contract.
// - Summary:
//   - Pins identity and fail-closed assessment without requiring Mac tools.
// - Description:
//   - A synthetic command success is not native distribution evidence.
// - Usage:
//   - Run with the Node test runner beside manifest verification tests.
// - Defaults:
//   - No external traffic, actual Apple commands, or installation.
//
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  mkdir, mkdtemp, realpath, rm, symlink, writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  verifyAppleUpdateBundle,
  type AppleAssessmentCommand,
  type AppleBundleVerificationOptions,
} from "../../../../src/platforms/update-signatures/adapter-outbound/apple.ts";
import { publisherFingerprint, manifestSigningBytes } from
  "../../../../src/platforms/update-signatures/adapter-outbound/verify.ts";
import { UPDATE_BUNDLE_ID, type UpdateManifest } from
  "../../../../src/ir/update-manifests/contract/manifest.ts";
import { RELEASE_REPOSITORY, releaseAssetUrl } from
  "../../../../src/ir/application-updates/contract/releases.ts";
import { appleBuildVersion } from
  "../../../../src/ir/product-version/contract/version.ts";

async function fixture() {
  const directory = await realpath(await mkdtemp(
    join(tmpdir(), "blooket-apple-assessment-"),
  ));
  const bundlePath = join(directory, "Blooket API.app");
  const resources = join(bundlePath, "Contents/Resources/runtime");
  await mkdir(resources, { recursive: true });
  await writeFile(join(bundlePath, "Contents/Info.plist"), "test-owned plist");
  const runtime = join(resources, "node");
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(2, 12);
  await writeFile(runtime, header);
  const keys = generateKeyPairSync("ed25519");
  const bytes = Buffer.from("synthetic archive");
  const manifest: UpdateManifest = {
    schemaVersion: 1, repository: RELEASE_REPOSITORY,
    version: "26.4.1", tag: "v26.4.1", sourceCommit: "a".repeat(40),
    bundleId: UPDATE_BUNDLE_ID, minimumMacos: "13.5",
    assets: [{
      target: "darwin-arm64", name: "darwin-arm64.zip",
      url: releaseAssetUrl("v26.4.1", "darwin-arm64.zip"),
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }],
  };
  const document = {
    schemaVersion: 1, algorithm: "ed25519",
    keyId: publisherFingerprint(keys.publicKey), manifest,
    signature: sign(null, manifestSigningBytes(manifest), keys.privateKey)
      .toString("base64url"),
  };
  const values: Record<string, string> = {
    CFBundleIdentifier: UPDATE_BUNDLE_ID,
    CFBundlePackageType: "APPL", CFBundleExecutable: "Blooket API",
    CFBundleShortVersionString: manifest.version,
    CFBundleVersion: appleBuildVersion(manifest.version),
    LSMinimumSystemVersion: manifest.minimumMacos,
    system: "13.5.1",
    assessment: "source=Notarized Developer ID",
  };
  const calls: { executable: string; args: readonly string[] }[] = [];
  const execute: AppleAssessmentCommand = async (executable, args, signal) => {
    assert.equal(signal.aborted, false);
    calls.push({ executable, args });
    if (executable === "/usr/bin/plutil") {
      assert.equal(args[0], "-extract");
      assert.deepEqual(args.slice(2, 5), ["raw", "-o", "-"]);
      assert.equal(args[5], join(bundlePath, "Contents/Info.plist"));
      return { stdout: values[args[1]!]! + "\n", stderr: "" };
    }
    if (executable === "/usr/bin/sw_vers")
      return { stdout: values["system"]! + "\n", stderr: "" };
    if (executable === "/usr/bin/codesign") {
      assert.deepEqual(args.slice(0, 4), [
        "--verify", "--deep", "--strict", "-R",
      ]);
      assert.equal(args[4], 'anchor apple generic and identifier "' +
        UPDATE_BUNDLE_ID + '" and certificate leaf[subject.OU] = ' +
        '"ABCDEF1234" and certificate leaf[' +
        'field.1.2.840.113635.100.6.1.13] exists');
      assert.equal(args[5], bundlePath);
      return { stdout: "", stderr: "" };
    }
    assert.equal(executable, "/usr/sbin/spctl");
    assert.deepEqual(args, [
      "--assess", "--type", "execute", "--verbose=4", bundlePath,
    ]);
    return { stdout: "", stderr: bundlePath + ": accepted\n" +
      values["assessment"] + "\n" };
  };
  const options: AppleBundleVerificationOptions = {
    bundlePath, publisherTeamId: "ABCDEF1234",
    host: { platform: "darwin", architecture: "arm64" }, execute,
    verification: {
      document, trustedKeys: [keys.publicKey],
      release: {
        version: manifest.version, tag: manifest.tag, target: "darwin-arm64",
        asset: { id: 1, ...manifest.assets[0]!, state: "uploaded" },
      },
    },
  };
  return {
    options, values, calls, directory, runtime, header,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("native assessment binds signed metadata, Apple identity, and OS trust",
  async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await verifyAppleUpdateBundle(f.options), {
      status: "verified", version: "26.4.1",
      requiresTransactionalInstallation: true,
    });
    assert.equal(f.calls.length, 9);
    assert.equal(f.calls.at(-1)?.executable, "/usr/sbin/spctl");
  } finally { await f.cleanup(); }
});

test("missing publisher trust and unsupported hosts run no native command",
  async () => {
  const f = await fixture();
  try {
    for (const [overrides, reason] of [
      [{ publisherTeamId: "" }, "publisher"],
      [{ publisherTeamId: 'ABC";other' }, "publisher"],
      [{ host: { platform: "linux", architecture: "arm64" } },
        "unsupported-host"],
      [{ host: { platform: "darwin", architecture: "x64" } },
        "unsupported-host"],
      [{ verification: { ...f.options.verification, trustedKeys: [] } },
        "manifest"],
    ] as const) {
      assert.deepEqual(await verifyAppleUpdateBundle({
        ...f.options, ...overrides,
      }), { status: "verification-failed", reason });
    }
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

test("foreign bundle metadata stops before signature and Gatekeeper",
  async () => {
  const f = await fixture();
  try {
    for (const key of ["CFBundleIdentifier", "CFBundlePackageType",
      "CFBundleExecutable", "CFBundleShortVersionString", "CFBundleVersion",
      "LSMinimumSystemVersion"]) {
      const previous = f.values[key]!;
      f.values[key] = "foreign";
      f.calls.length = 0;
      assert.deepEqual(await verifyAppleUpdateBundle(f.options), {
        status: "verification-failed", reason: "metadata",
      });
      assert.ok(f.calls.every(call => call.executable === "/usr/bin/plutil"));
      f.values[key] = previous;
    }
    f.values["CFBundleIdentifier"] = " " + UPDATE_BUNDLE_ID;
    assert.deepEqual(await verifyAppleUpdateBundle(f.options), {
      status: "verification-failed", reason: "metadata",
    });
  } finally { await f.cleanup(); }
});

test("OS and runtime architecture must match the signed ARM64 target",
  async () => {
  const f = await fixture();
  try {
    for (const system of ["13.4.9", "12.99", "13", "13.05", "unknown"]) {
      f.values["system"] = system;
      assert.deepEqual(await verifyAppleUpdateBundle(f.options), {
        status: "verification-failed", reason: "incompatible-os",
      });
    }
    for (const system of ["13.5", "13.5.0", "14.0", "26.0.1"]) {
      f.values["system"] = system;
      assert.equal(
        (await verifyAppleUpdateBundle(f.options)).status, "verified",
      );
    }
    for (const [offset, value] of [
      [0, 0xcafebabe], [0, 0xcffaedfe], [4, 0x01000007],
      [8, 2], [12, 1],
    ] as const) {
      const bad = Buffer.from(f.header);
      bad.writeUInt32LE(value, offset);
      await writeFile(f.runtime, bad);
      assert.deepEqual(await verifyAppleUpdateBundle(f.options), {
        status: "verification-failed", reason: "architecture",
      });
    }
    await writeFile(f.runtime, f.header.subarray(0, 31));
    assert.deepEqual(await verifyAppleUpdateBundle(f.options), {
      status: "verification-failed", reason: "architecture",
    });
  } finally { await f.cleanup(); }
});

test("Gatekeeper overrides and ambiguous sources cannot prove notarization",
  async () => {
  const f = await fixture();
  try {
    for (const assessment of [
      "source=Developer ID", "source=no usable signature",
      "source=accepted (override security disabled)", "",
      "source=Notarized Developer ID\nsource=Developer ID"]) {
      f.values["assessment"] = assessment;
      assert.deepEqual(await verifyAppleUpdateBundle(f.options), {
        status: "verification-failed", reason: "gatekeeper",
      });
    }
    const failure: AppleAssessmentCommand = async () => {
      throw new Error("private native diagnostic must not escape");
    };
    for (const failedCommand of ["/usr/bin/codesign", "/usr/sbin/spctl"]) {
      assert.deepEqual(await verifyAppleUpdateBundle({
        ...f.options,
        execute: async (file, args, signal) => file === failedCommand
          ? failure(file, args, signal)
          : f.options.execute!(file, args, signal),
      }), {
        status: "verification-failed",
        reason: failedCommand.endsWith("codesign") ? "signature" : "gatekeeper",
      });
    }
  } finally { await f.cleanup(); }
});

test("symlinked staging, foreign names, and malformed paths are refused",
  async () => {
  const f = await fixture();
  try {
    const alias = join(f.directory, "alias");
    await symlink(f.directory, alias);
    for (const bundlePath of ["Blooket API.app", f.options.bundlePath + "\n",
      join(f.directory, "Other.app"), join(alias, "Blooket API.app")]) {
      assert.deepEqual(await verifyAppleUpdateBundle({
        ...f.options, bundlePath,
      }),
        { status: "verification-failed", reason: "bundle" });
    }
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

test("native timeout and cancellation stop even an uncooperative command",
  async () => {
  const f = await fixture();
  try {
    let signal: AbortSignal | undefined;
    const execute: AppleAssessmentCommand = async (_file, _args, supplied) => {
      signal = supplied;
      return new Promise(() => {});
    };
    assert.deepEqual(await verifyAppleUpdateBundle({
      ...f.options, execute, timeoutMs: 10,
    }), { status: "verification-failed", reason: "timeout" });
    assert.equal(signal?.aborted, true);
    const controller = new AbortController();
    const result = verifyAppleUpdateBundle({
      ...f.options, execute: async (file, args, supplied) => {
        controller.abort();
        return execute(file, args, supplied);
      }, signal: controller.signal,
    });
    assert.deepEqual(await result, {
      status: "verification-failed", reason: "cancelled",
    });
    assert.equal(signal?.aborted, true);
  } finally { await f.cleanup(); }
});

test("oversized native diagnostics and a pre-cancelled check fail closed",
  async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await verifyAppleUpdateBundle({
      ...f.options, execute: async () => ({
        stdout: "x".repeat(65_537), stderr: "",
      }),
    }), { status: "verification-failed", reason: "metadata" });
    const controller = new AbortController();
    controller.abort();
    assert.deepEqual(await verifyAppleUpdateBundle({
      ...f.options, signal: controller.signal,
    }), { status: "verification-failed", reason: "cancelled" });
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});
