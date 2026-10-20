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
//   - Independent, verified installer program copies before bundle exchange.
// - Must-Not:
//   - Install, launch, consume secrets, or invent publisher trust.
// - Allows:
//   - Inputs: Captured installation authority and admitted Apple publisher.
//   - Outputs: Verified program copy or a bounded preparation failure.
//   - Side effects: Private program copies and owned tree permission changes.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Installer lifetime no longer crosses application replacement.
// - Summary:
//   - Independent, verified installer program copies before bundle exchange.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import assert from "node:assert/strict";
import test from "node:test";
import { cp, lstat, mkdir, readFile, rename, symlink, writeFile } from
  "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { prepareInstallerProgramCopy, type InstallerProgramCopyOptions } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/update-extraction/adapter-outbound/installer-program.ts";
import { directoryIdentity, sameIdentity } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/identity.ts";
import { exchangeBundles } from
  "../../../../src/platforms/bundle-exchange/adapter-outbound/exchange.ts";
import { fixture as bundleFixture } from
  "../../bundle-exchange/adapter-outbound/fixtures.ts";
import { journalFixture } from
  "../../../ir/application-updates/contract/fixtures.ts";
import { appleBuildVersion } from
  "../../../../src/ir/product-version/contract/version.ts";
import { UPDATE_BUNDLE_ID } from
  "../../../../src/ir/update-manifests/contract/manifest.ts";
import { baseEntries } from "./fixtures.ts";

async function fixture(native = false) {
  const files = await bundleFixture(native);
  for (const entry of baseEntries()) {
    const relative = entry.name.slice("Blooket API.app/".length);
    const path = join(files.options.installedPath, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry.data!, { mode: entry.mode ?? 0o600 });
  }
  const authority = { ...journalFixture(),
    installationId: basename(files.prepared)
      .slice(".blooket-api.update-".length),
    installedPath: files.options.installedPath,
    candidatePath: files.options.candidatePath,
    installedIdentity: files.options.installedIdentity,
    candidateIdentity: files.options.candidateIdentity };
  let copies = 0;
  const assessed: string[] = [];
  const options: InstallerProgramCopyOptions = {
    authority, publisherTeamId: "ABCDEF1234", host: files.options.host,
    availableBytes: async () => 20_000_000_000n,
    copy: async (file, args, signal) => {
      copies++;
      assert.equal(file, "/usr/bin/ditto");
      assert.deepEqual(args.slice(0, 3), ["--rsrc", "--extattr", "--acl"]);
      signal.throwIfAborted();
      // Real portable bytes; this does not test native Apple attributes.
      await cp(args[3]!, args[4]!, { recursive: true,
        force: false, errorOnExist: true, verbatimSymlinks: true });
    },
    assess: async (file, args) => {
      if (file === "/usr/bin/plutil") {
        const values: Record<string, string> = {
          CFBundleIdentifier: UPDATE_BUNDLE_ID, CFBundlePackageType: "APPL",
          CFBundleExecutable: "Blooket API",
          CFBundleShortVersionString: authority.installedVersion,
          CFBundleVersion: appleBuildVersion(authority.installedVersion),
          LSMinimumSystemVersion: "13.5",
        };
        return { stdout: values[args[1]!]! + "\n", stderr: "" };
      }
      if (file === "/usr/bin/sw_vers")
        return { stdout: "26.0\n", stderr: "" };
      if (file === "/usr/bin/codesign") {
        assessed.push(args.at(-1)!);
        return { stdout: "", stderr: "" };
      }
      assert.equal(file, "/usr/sbin/spctl");
      return { stdout: "", stderr: "source=Notarized Developer ID\n" };
    },
  };
  return { files, authority, options, assessed, copies: () => copies,
    async preserved() {
      assert.equal(await readFile(join(authority.installedPath, "marker"),
        "utf8"), "old version");
      assert.equal(await readFile(join(authority.candidatePath, "marker"),
        "utf8"), "new version");
    } };
}
async function withFixture(work: (f: Awaited<ReturnType<typeof fixture>>) =>
  Promise<void>, native = false) {
  const f = await fixture(native);
  try { await work(f); }
  finally { await f.files.cleanup(); }
}

test("installer program stays verified and separate through real exchange",
  () => withFixture(async f => {
    await symlink("node", join(f.authority.installedPath,
      "Contents/Resources/runtime/node-alias"));
    const result = await prepareInstallerProgramCopy(f.options);
    assert.equal(result.status, "prepared");
    if (result.status !== "prepared") return;
    assert.equal(f.copies(), 1);
    assert.deepEqual(f.assessed, [f.authority.installedPath,
      result.bundlePath]);
    assert.equal(sameIdentity(result.identity,
      f.authority.installedIdentity), false);
    const marker = join(result.bundlePath, "marker");
    assert.equal((await lstat(marker)).mode & 0o222, 0);
    assert.equal((await lstat(dirname(result.bundlePath))).mode & 0o777, 0o500);
    assert.equal((await exchangeBundles(f.files.options)).status, "exchanged");
    assert.equal(await readFile(marker, "utf8"), "old version");
    assert.deepEqual(await directoryIdentity(result.bundlePath),
      result.identity);
  }, true));

test("installer copy refuses changed bytes and preserves both applications",
  () => withFixture(async f => {
    const result = await prepareInstallerProgramCopy({ ...f.options,
      copy: async (...args) => {
        await f.options.copy!(...args);
        await writeFile(join(args[1][4]!, "marker"), "changed copy");
      } });
    assert.deepEqual(result, { status: "preparation-failed", reason: "bytes" });
    await assert.rejects(lstat(join(f.files.prepared, "installer")),
      { code: "ENOENT" });
    await f.preserved();
  }));

test("installer copy independently reassesses its copied Apple publisher",
  () => withFixture(async f => {
    const result = await prepareInstallerProgramCopy({ ...f.options,
      assess: async (...args) => {
        if (args[0] === "/usr/bin/codesign" &&
            args[1].at(-1) !== f.authority.installedPath)
          throw Error("synthetic copied-signature rejection");
        return f.options.assess!(...args);
      } });
    assert.deepEqual(result, { status: "preparation-failed",
      reason: "copied-bundle" });
    await f.preserved();
  }));

for (const kind of ["external-link", "space", "existing", "host"] as const) {
  test(`installer copy refuses ${kind} without overwriting prior work`,
    () => withFixture(async f => {
      if (kind === "external-link") await symlink("../../foreign",
        join(f.authority.installedPath, "external"));
      const existing = join(f.files.prepared, "installer");
      if (kind === "existing") {
        await mkdir(existing);
        await writeFile(join(existing, "marker"), "prior installer");
      }
      const result = await prepareInstallerProgramCopy({ ...f.options,
        ...(kind === "space" ? { availableBytes: async () => 1n } : {}),
        ...(kind === "host" ? { host: { platform: "linux",
          architecture: "x64" } } : {}),
      });
      assert.equal(result.status, "preparation-failed");
      assert.equal(f.copies(), 0);
      if (kind === "existing") assert.equal(await readFile(
        join(existing, "marker"), "utf8"), "prior installer");
      await f.preserved();
    }));
}

test("cancelled installer copy waits for its actual writer before cleanup",
  () => withFixture(async f => {
    const cancel = new AbortController();
    let finish!: () => void, started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    let settled = false;
    const result = prepareInstallerProgramCopy({ ...f.options,
      signal: cancel.signal, copy: async (_file, args) => {
        started();
        await new Promise<void>(resolve => { finish = resolve; });
        await mkdir(args[4]!, { recursive: true });
        await writeFile(join(args[4]!, "late-writer"), "owned");
      } }).then(value => { settled = true; return value; });
    await began;
    cancel.abort();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    finish();
    assert.deepEqual(await result, { status: "preparation-failed",
      reason: "cancelled" });
    await assert.rejects(lstat(join(f.files.prepared, "installer")),
      { code: "ENOENT" });
    await f.preserved();
  }));

test("candidate replacement during copy cannot produce installer authority",
  () => withFixture(async f => {
    const retained = join(f.files.prepared, "retained-candidate");
    const result = await prepareInstallerProgramCopy({ ...f.options,
      copy: async (...args) => {
        await f.options.copy!(...args);
        await rename(f.authority.candidatePath, retained);
        await mkdir(f.authority.candidatePath);
      } });
    assert.deepEqual(result, { status: "preparation-failed",
      reason: "identity" });
    assert.equal(await readFile(join(retained, "marker"), "utf8"),
      "new version");
  }));

test("installer copy deadline does not release a live native writer",
  () => withFixture(async f => {
    let closed = false;
    const result = await prepareInstallerProgramCopy({ ...f.options,
      timeoutMs: 200, copy: async (_file, _args, signal) => {
        await new Promise<void>(resolve => {
          signal.addEventListener("abort", () => {
            setImmediate(() => { closed = true; resolve(); });
          }, { once: true });
        });
      } });
    assert.equal(closed, true);
    assert.deepEqual(result, { status: "preparation-failed",
      reason: "timeout" });
    await f.preserved();
  }));
