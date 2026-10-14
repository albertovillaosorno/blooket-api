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
//   - Signed extraction, native placement and durable preparation regressions.
// - Must-Not:
//   - Install user software, use real accounts, or infer native Apple trust.
// - Allows:
//   - Inputs: Ephemeral signed ZIPs, owned bundles and Apple command doubles.
//   - Outputs: Preserved old data, prepared intent or retained failure.
//   - Side effects: Automatic fixtures, native compilation and local I/O.
// - Split-When:
//   - Independent installer processes provide product restart acceptance.
// - Merge-When:
//   - Production update acceptance exercises this complete preparation path.
// - Summary:
//   - Runs real byte verification, extraction, exclusive placement and journal.
// - Description:
//   - Apple responses are explicit doubles; no Mac execution is claimed.
// - Usage:
//   - Run before composing preparation into the teacher-facing updater.
// - Defaults:
//   - Every fixture removes only its generated test roots.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { prepareSignedUpdateInstallation, type UpdatePreparationOptions } from
  "../../../../src/api/application-updates/application/prepare.ts";
import { openUpdateInstallationStore } from
  "../../../../src/platforms/update-journals/adapter-outbound/store.ts";
import { directoryIdentity } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/identity.ts";
import { exchangeBundles } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/exchange.ts";
import { removeCreatedStage } from
  "../../../../src/platforms/update-extraction/adapter-outbound/files.ts";
import { fixture as archiveFixture, baseEntries } from
  "../../../platforms/update-extraction/adapter-outbound/fixtures.ts";
import { fixture as bundleFixture } from
  "../../../platforms/bundle-exchange/adapter-outbound/fixtures.ts";
import { appleBuildVersion } from
  "../../../../src/ir/product-version/contract/version.ts";
import { UPDATE_BUNDLE_ID } from
  "../../../../src/ir/update-manifests/contract/manifest.ts";

async function fixture() {
  const files = await bundleFixture(), archive = await archiveFixture();
  const installedPath = files.options.installedPath;
  const runtime = join(installedPath, "Contents/Resources/runtime");
  await mkdir(runtime, { recursive: true });
  await writeFile(join(runtime, "node"), baseEntries()[2]!.data!);
  await writeFile(join(installedPath, "Contents/Info.plist"), "old test plist");
  await writeFile(join(files.root, "teacher-data"), "preserved teacher state");
  const calls: string[] = [];
  const options: UpdatePreparationOptions = {
    installedPath, installedVersion: "26.4.0", publisherTeamId: "ABCDEF1234",
    archivePath: archive.options.archivePath,
    verification: archive.options.verification, host: archive.options.host,
    extract: archive.options.execute,
    placement: { helperPath: files.options.helperPath },
    assess: async (file, args) => {
      calls.push(file);
      if (file === "/usr/bin/plutil") {
        const old = args.at(-1) === join(installedPath, "Contents/Info.plist");
        const version = old ? "26.4.0" : "26.4.1";
        const values: Record<string, string> = {
          CFBundleIdentifier: UPDATE_BUNDLE_ID, CFBundlePackageType: "APPL",
          CFBundleExecutable: "Blooket API",
          CFBundleShortVersionString: version,
          CFBundleVersion: appleBuildVersion(version),
          LSMinimumSystemVersion: "13.5",
        };
        return { stdout: values[args[1]!]! + "\n", stderr: "" };
      }
      if (file === "/usr/bin/sw_vers")
        return { stdout: "26.0\n", stderr: "" };
      if (file === "/usr/bin/codesign") {
        assert.ok(args[4]!.includes('subject.OU] = "ABCDEF1234"'));
        return { stdout: "", stderr: "" };
      }
      assert.equal(file, "/usr/sbin/spctl");
      return { stdout: "", stderr: "source=Notarized Developer ID\n" };
    },
  };
  return { files, archive, options, calls,
    async preserved() {
      assert.equal(await readFile(join(installedPath, "marker"), "utf8"),
        "old version");
      assert.equal(await readFile(join(files.root, "teacher-data"), "utf8"),
        "preserved teacher state");
    },
    async cleanup() {
      await archive.cleanup(); await removeCreatedStage(files.root);
    },
  };
}
test("real preparation freezes a sibling and journals captured identities",
  async () => {
    const f = await fixture();
    try {
      const result = await prepareSignedUpdateInstallation(f.options);
      assert.equal(result.status, "prepared");
      if (result.status !== "prepared") return;
      try {
        assert.equal(result.authority.phase, "prepared");
        assert.deepEqual(result.authority.installedIdentity,
          await directoryIdentity(f.options.installedPath));
        assert.deepEqual(result.authority.candidateIdentity,
          await directoryIdentity(result.authority.candidatePath));
        assert.equal(dirname(dirname(result.authority.candidatePath)),
          dirname(f.options.installedPath));
        assert.equal((await lstat(result.authority.candidatePath)).mode & 0o777,
          0o555);
        assert.deepEqual(await result.store.read(), result.authority);
        assert.deepEqual(await openUpdateInstallationStore(
          dirname(result.authority.candidatePath)),
        { ok: false, reason: "busy" });
        await f.preserved();
      } finally { await result.store.close(); }
    } finally { await f.cleanup(); }
  });
test("a frozen prepared bundle exchanges and restores the retained old app",
  async () => {
    const f = await fixture();
    try {
      const result = await prepareSignedUpdateInstallation(f.options);
      assert.equal(result.status, "prepared");
      if (result.status !== "prepared") return;
      try {
        const oldMode = (await lstat(f.options.installedPath)).mode & 0o777;
        const { authority } = result;
        const options = { installedPath: authority.installedPath,
          candidatePath: authority.candidatePath,
          installedIdentity: authority.installedIdentity,
          candidateIdentity: authority.candidateIdentity,
          helperPath: f.files.options.helperPath,
          host: f.files.options.host };
        assert.deepEqual(await exchangeBundles(options), {
          status: "exchanged", orientation: "exchanged", durable: true,
        });
        assert.deepEqual(await directoryIdentity(authority.installedPath),
          authority.candidateIdentity);
        assert.equal((await lstat(authority.installedPath)).mode & 0o777,
          0o555);
        assert.equal((await lstat(authority.candidatePath)).mode & 0o777,
          oldMode);
        assert.deepEqual(await exchangeBundles({ ...options,
          installedIdentity: authority.candidateIdentity,
          candidateIdentity: authority.installedIdentity }), {
          status: "exchanged", orientation: "exchanged", durable: true,
        });
        assert.deepEqual(await directoryIdentity(authority.installedPath),
          authority.installedIdentity);
        assert.equal((await lstat(authority.installedPath)).mode & 0o777,
          oldMode);
        assert.equal((await lstat(authority.candidatePath)).mode & 0o777,
          0o555);
        await f.preserved();
      } finally { await result.store.close(); }
    } finally { await f.cleanup(); }
  });

test("untrusted and non-new releases stop before filesystem preparation",
  async () => {
    const f = await fixture();
    try {
      const before = await readdir(f.files.root);
      assert.deepEqual(await prepareSignedUpdateInstallation({ ...f.options,
        verification: { ...f.options.verification, trustedKeys: [] } }),
      { status: "preparation-failed", reason: "manifest" });
      assert.deepEqual(await prepareSignedUpdateInstallation({ ...f.options,
        installedVersion: "26.4.1" }),
      { status: "preparation-failed", reason: "version" });
      assert.equal(f.calls.length, 0);
      assert.deepEqual(await readdir(f.files.root), before);
      await f.preserved();
    } finally { await f.cleanup(); }
  });
test("failed extraction removes only its new private preparation directory",
  async () => {
    const f = await fixture();
    try {
      const before = await readdir(f.files.root);
      const result = await prepareSignedUpdateInstallation({ ...f.options,
        availableBytes: async () => 0n });
      assert.deepEqual(result, { status: "preparation-failed",
        reason: "extraction" });
      assert.deepEqual(await readdir(f.files.root), before);
      await f.preserved();
    } finally { await f.cleanup(); }
  });
test("failed candidate assessment retains placement without installing it",
  async () => {
    const f = await fixture();
    try {
      const result = await prepareSignedUpdateInstallation({ ...f.options,
        assess: async (file, args, signal) => {
          if (file === "/usr/bin/codesign" &&
              args.at(-1) !== f.options.installedPath)
            throw Error("synthetic candidate rejection");
          return await f.options.assess!(file, args, signal);
        },
      });
      assert.equal(result.status, "preparation-failed");
      if (result.status !== "preparation-failed") return;
      assert.equal(result.reason, "candidate-bundle");
      assert.ok(result.retainedInstallationId);
      const directory = join(f.files.root,
        ".blooket-api.update-" + result.retainedInstallationId);
      assert.equal((await lstat(join(directory, "Blooket API.app")))
        .isDirectory(), true);
      await assert.rejects(lstat(join(directory, "installation.json")),
        { code: "ENOENT" });
      await f.preserved();
    } finally { await f.cleanup(); }
  });
