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
//   - Signed preparation, native exchange and real service restart regressions.
// - Must-Not:
//   - Install user software, use real accounts, or infer native Apple trust.
// - Allows:
//   - Inputs: Ephemeral signed ZIPs, owned bundles and Apple command doubles.
//   - Outputs: Preserved old data, prepared intent or retained failure.
//   - Side effects: Automatic fixtures, native compilation, I/O and service
//     children.
// - Split-When:
//   - Independent installer processes provide product restart acceptance.
// - Merge-When:
//   - Production update acceptance exercises this complete preparation path.
// - Summary:
//   - Runs real byte verification, placement, journals and private service IPC.
// - Description:
//   - Apple responses and bundle launch locations are explicit substitutions;
//     no Mac execution is claimed.
// - Usage:
//   - Run before composing preparation into the teacher-facing updater.
// - Defaults:
//   - Every fixture removes only its generated test roots.
//
import assert from "node:assert/strict";
import test from "node:test";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
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
import { observeExchange, sameIdentity } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/identity.ts";
import { syncDirectory } from
  "../../../../src/platforms/update-extraction/adapter-outbound/files.ts";
import { createInstallerServiceManager } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/service-lifecycle/adapter-outbound/installer-service.ts";
import { acquireCanonicalDataUpdateBoundary,
  canonicalDataUpdateBoundaryOwned } from
  "../../../../src/platforms/user-storage/adapter-outbound/writer-boundary.ts";
import { loadPreferences, savePreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import { acquireUpdatePublicationBoundary } from
  "../../../../src/api/application-updates/application/publication-boundary.ts";
import { createUpdateInstallationController } from
  "../../../../src/api/application-updates/application/install.ts";
import { verifyAppleInstalledBundle, verifyAppleUpdateBundle } from
  "../../../../src/platforms/update-signatures/adapter-outbound/apple.ts";
import { PRODUCT_VERSION } from
  "../../../../src/ir/product-version/contract/version.ts";
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

async function fixture(oldVersion = "26.4.0", newVersion = "26.4.1") {
  const files = await bundleFixture();
  const serviceEntry = "Contents/Resources/app/src/service/" +
    "background-service/adapter-inbound/main.ts";
  const archive = await archiveFixture([...baseEntries(), {
    name: "Blooket API.app/" + serviceEntry,
    data: Buffer.from("fixture entry; launcher uses real repository service"),
  }], newVersion);
  const installedPath = files.options.installedPath;
  const runtime = join(installedPath, "Contents/Resources/runtime");
  await mkdir(runtime, { recursive: true });
  await writeFile(join(runtime, "node"), baseEntries()[2]!.data!,
    { mode: 0o700 });
  await mkdir(dirname(join(installedPath, serviceEntry)), { recursive: true });
  await writeFile(join(installedPath, serviceEntry), "fixture old entry");
  await writeFile(join(installedPath, "Contents/Info.plist"), "old test plist");
  await writeFile(join(files.root, "teacher-data"), "preserved teacher state");
  const calls: string[] = [];
  const options: UpdatePreparationOptions = {
    installedPath, installedVersion: oldVersion, publisherTeamId: "ABCDEF1234",
    archivePath: archive.options.archivePath,
    verification: archive.options.verification, host: archive.options.host,
    extract: archive.options.execute,
    placement: { helperPath: files.options.helperPath },
    assess: async (file, args) => {
      calls.push(file);
      if (file === "/usr/bin/plutil") {
        const bundle = dirname(dirname(args.at(-1)!));
        const old = sameIdentity(await directoryIdentity(bundle),
          files.options.installedIdentity);
        const version = old ? oldVersion : newVersion;
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

for (const outcome of ["apply", "rollback"] as const) {
  test("signed preparation and real service transaction: " + outcome,
    { timeout: 30_000 }, async () => {
      const [year, quarter, patch] = PRODUCT_VERSION.split(".").map(Number);
      const previous = patch! > 0 ? `${year}.${quarter}.${patch! - 1}`
        : quarter! > 1 ? `${year}.${quarter! - 1}.0` : `${year! - 1}.4.0`;
      const next = `${year}.${quarter}.${patch! + 1}`;
      const f = await fixture(outcome === "apply" ? previous : PRODUCT_VERSION,
        outcome === "apply" ? PRODUCT_VERSION : next);
      const data = join(f.files.root, "teacher-state");
      const preferences = await loadPreferences(data);
      await savePreferences(data, { ...preferences,
        service: { ...preferences.service, portMode: "automatic", port: 1 } });
      await writeFile(join(data, "preserved-lesson"), "preserved lesson bytes");
      const publication = await acquireUpdatePublicationBoundary(data);
      const boundary = await acquireCanonicalDataUpdateBoundary(data);
      const prepared = await prepareSignedUpdateInstallation(f.options);
      const children: ChildProcess[] = [];
      let manager: ReturnType<typeof createInstallerServiceManager> | undefined;
      try {
        assert.ok(publication.ok && boundary.ok);
        assert.equal(prepared.status, "prepared");
        if (!publication.ok || !boundary.ok || prepared.status !== "prepared")
          throw Error("fixture-preparation-failed");
        const serviceManager = createInstallerServiceManager(data, boundary, {
          launch: (_file, args, options) => {
            assert.equal(args[1], "--installer-child");
            const child = fork(new URL(
// jig-ignore-next-line: TypeScript module specifier is indivisible.
              "../../../../src/service/background-service/adapter-inbound/main.ts",
              import.meta.url), ["--installer-child"], options);
            children.push(child);
            return child;
          },
        });
        manager = serviceManager;
        const { authority } = prepared;
        const locations = { installedPath: authority.installedPath,
          candidatePath: authority.candidatePath,
          installedIdentity: authority.installedIdentity,
          candidateIdentity: authority.candidateIdentity };
        const exchanges: string[] = [];
        let writing = false;
        const controller = createUpdateInstallationController(authority, {
          journal: { read: () => prepared.store.read(),
            replace: (expected, next) => prepared.store.replace(expected,
              next) },
          ownership: async () => ({ status:
            await canonicalDataUpdateBoundaryOwned(boundary, data)
              ? "owned" : "lost" }),
          settleNativeWriter: async () => ({ status:
            writing ? "running" : "stopped" }),
          inspect: async () => {
            const orientation = await observeExchange(locations);
            await syncDirectory(dirname(authority.installedPath));
            await syncDirectory(dirname(authority.candidatePath));
            return { orientation, durable: true };
          },
          assess: async target => {
            const native = { bundlePath: target.path,
              publisherTeamId: f.options.publisherTeamId,
              execute: f.options.assess!, host: f.options.host! };
            const result = target.kind === "new"
              ? await verifyAppleUpdateBundle({ ...native,
                verification: f.options.verification })
              : await verifyAppleInstalledBundle({ ...native,
                version: target.version });
            return result.status === "verified"
              ? { status: "verified", version: result.version } : result;
          },
          quiesce: async () => {
            const stop = await serviceManager.stop();
            const proof = stop.status === "pending" ? await stop.completion
              : stop;
            return { status: proof.status === "stopped" ? "quiesced"
              : "unavailable" };
          },
          exchange: async (direction, _record, signal) => {
            writing = true;
            try {
              exchanges.push(direction);
              const result = await exchangeBundles({ ...locations,
                ...(direction === "rollback" ? {
                  installedIdentity: authority.candidateIdentity,
                  candidateIdentity: authority.installedIdentity } : {}),
                helperPath: f.files.options.helperPath,
                host: f.files.options.host, ...(signal ? { signal } : {}) });
              if (result.status !== "exchanged") throw Error("exchange-failed");
            } finally { writing = false; }
          },
          startAndCheck: (target, nonce) => serviceManager.startAndCheck({
            bundlePath: target.path, version: target.version,
            identity: target.identity }, nonce),
        });
        const expected = { status: outcome === "apply" ? "applied"
          : "old-running", installationId: authority.installationId,
          phase: outcome === "apply" ? "new-healthy" : "old-healthy",
          version: PRODUCT_VERSION };
        assert.deepEqual(await controller.run(), expected);
        assert.deepEqual(await controller.run(), expected);
        assert.deepEqual(exchanges, outcome === "apply" ? ["forward"]
          : ["forward", "rollback"]);
        assert.equal(children.length, outcome === "apply" ? 1 : 2);
        assert.equal((await prepared.store.read())!.phase, expected.phase);
        assert.equal(await readFile(join(data, "preserved-lesson"), "utf8"),
          "preserved lesson bytes");
        assert.equal((await loadPreferences(data)).locale, preferences.locale);
        if (outcome === "rollback") await f.preserved();
        else assert.equal(await readFile(join(authority.candidatePath,
          "marker"), "utf8"), "old version");
        await boundary.release();
        const runtime = JSON.parse(await readFile(join(data,
          "service-runtime.json"), "utf8"));
        const bootstrap = await fetch(runtime.origin + "/api/bootstrap");
        assert.equal(bootstrap.status, 200);
        await bootstrap.body?.cancel();
      } finally {
        if (manager) {
          const stop = await manager.stop();
          if (stop.status === "pending") await stop.completion;
        }
        for (const child of children) {
          if (child.exitCode !== null || child.signalCode !== null) continue;
          const closed = once(child, "close");
          child.kill("SIGKILL"); // Failed test's own disposable child only.
          await closed;
        }
        if (prepared.status === "prepared") await prepared.store.close();
        if (boundary.ok) await boundary.release();
        if (publication.ok) await publication.release();
        await f.cleanup();
      }
    });
}
