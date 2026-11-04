// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - LicenseRef-Proprietary
// Confidential:
//   - true
// License-File:
//   - LICENSE
//
// Boundary-Contract:
// - Owns:
//   - Regression coverage for mandatory release workflow dependencies.
// - Must-Not:
//   - Use production data, credentials, or a live Blooket account.
// - Allows:
//   - Inputs: One admitted native target and explicit release verification.
//   - Outputs: A passing smoke result or a failing process exit.
//   - Side effects: Temporary extraction and a synthetic local service.
// - Split-When:
//   - Another distribution format needs independent acceptance.
// - Merge-When:
//   - Package verification no longer requires native execution.
// - Summary:
//   - Tests the archive that would be delivered rather than repository imports.
// - Description:
//   - Exercises launch, native media, canonical CLI, and owned shutdown.
// - Usage:
//   - Run on the matching native host after assembly.
// - Defaults:
//   - Failed checks block release and cleanup only the owned fixture.
//
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm, symlink, open } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import {
  MAC_LOGIN_AGENT_EXECUTABLE,
  MAC_LOGIN_AGENT_LABEL,
  MAC_LOGIN_AGENT_PLIST,
  macLoginAgentPlist,
  distributionDirectory,
  createLinuxArchive,
  downloadDistributionFile,
  readDistributionCacheFile,
  writeDistributionCacheFile,
  extractDistributionTar,
  syncDistributionArchive,
  syncDistributionFolder,
} from "../../../../src/platforms/distribution/adapter-outbound/build.ts";
import { join } from "node:path";

test("distribution downloads require a complete bounded HTTP representation",
  async () => {
    const original = globalThis.fetch;
    const fetchReply = async (response: Response, maxBytes = 100):
      Promise<Buffer> => {
      globalThis.fetch = (async () => response) as typeof fetch;
      return downloadDistributionFile("https://example.com/asset", maxBytes);
    };
    try {
      for (const response of [
        new Response("partial", { status: 206 }),
        new Response("redirect", { status: 302 }),
        new Response("partial", { status: 200,
          headers: { "Content-Range": "bytes 0-6/100" } }),
        new Response("short", { status: 200,
          headers: { "Content-Length": "8" } }),
        new Response("bytes", { status: 200,
          headers: { "Content-Length": "garbage" } }),
        new Response("bytes", { status: 200,
          headers: { "Content-Length": "101" } }),
        new Response(null, { status: 200 }),
        new Response("", { status: 200 }),
      ]) await assert.rejects(fetchReply(response),
        /distribution-download-failed|distribution-download-too-large/u);
      await assert.rejects(fetchReply(new Response("too much", {
        status: 200,
      }), 5), /distribution-download-too-large/u);
      assert.deepEqual(await fetchReply(new Response("complete", {
        status: 200, headers: { "Content-Length": "8" },
      })), Buffer.from("complete"));
      assert.deepEqual(await fetchReply(new Response("complete", {
        status: 200,
      })), Buffer.from("complete"));
    } finally {
      globalThis.fetch = original;
    }
  });

test("distribution cache reads admit only stable bounded regular files",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "package-cache-"));
    try {
      const path = join(root, "archive");
      assert.equal(await readDistributionCacheFile(path), null);
      const bytes = Buffer.from("cached verified bytes");
      await writeDistributionCacheFile(path, bytes);
      assert.deepEqual(await readDistributionCacheFile(path), bytes);
      await assert.rejects(writeDistributionCacheFile(path,
        Buffer.from("replacement")), { code: "EEXIST" });
      assert.deepEqual(await readFile(path), bytes);
      await rm(path);
      await symlink(join(root, "target"), path);
      await assert.rejects(readDistributionCacheFile(path),
        /distribution-cache-invalid/u);
      await rm(path);
      const large = await open(path, "wx");
      try { await large.truncate(160_000_001); }
      finally { await large.close(); }
      await assert.rejects(readDistributionCacheFile(path),
        /distribution-cache-invalid/u);
      await rm(path);
      await writeFile(path, Buffer.alloc(0));
      await assert.rejects(readDistributionCacheFile(path),
        /distribution-cache-invalid/u);
      await assert.rejects(writeDistributionCacheFile(join(root, "empty"),
        Buffer.alloc(0)), /distribution-cache-invalid/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("distribution cache refuses FIFO entries and exclusive FIFO writes",
  { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "package-cache-fifo-"));
    try {
      const path = join(root, "archive");
      await promisify(execFile)("mkfifo", [path]);
      const entrypoint = new URL(
        "../../../../src/platforms/distribution/adapter-outbound/build.ts",
        import.meta.url,
      ).href;
      const script = `import { readDistributionCacheFile,
        writeDistributionCacheFile } from ${JSON.stringify(entrypoint)};
        const path = process.argv[1];
        await readDistributionCacheFile(path).then(
          () => { throw Error("accepted-FIFO-cache"); },
          error => {
            if (!/distribution-cache-invalid/u.test(String(error)))
              throw error;
          },
        );
        await writeDistributionCacheFile(path, Buffer.from("x")).then(
          () => { throw Error("overwrote-FIFO-cache"); },
          error => {
            if (error.code !== "EEXIST") throw error;
          },
        );`;
      await promisify(execFile)(process.execPath,
        ["--input-type=module", "-e", script, path],
        { timeout: 10_000, killSignal: "SIGKILL" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("distribution tar extraction uses verified bytes, not cache path",
  { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "package-tar-input-"));
    try {
      const source = join(root, "source");
      const output = join(root, "output");
      await mkdir(source);
      await mkdir(output);
      await writeFile(join(source, "keep.txt"), "validated archive bytes");
      const archive = join(root, "cache.tar.gz");
      await promisify(execFile)("tar", ["-czf", archive,
        "-C", source, "."]);
      const bytes = await readFile(archive);
      await rm(archive);
      // Extraction succeeds after the original cache entry disappears.
      await extractDistributionTar(bytes, output);
      assert.equal(await readFile(join(output, "keep.txt"), "utf8"),
        "validated archive bytes");
      // Node packaging selects just two members and strips a directory.
      const prefix = join(source, "node-v24");
      await mkdir(join(prefix, "bin"), { recursive: true });
      await writeFile(join(prefix, "bin/node"), "synthetic runtime");
      await writeFile(join(prefix, "LICENSE"), "synthetic license");
      await promisify(execFile)("tar", ["-czf", archive,
        "-C", source, "node-v24"]);
      const nodeBytes = await readFile(archive);
      await rm(archive);
      const selected = join(root, "selected");
      await mkdir(selected);
      await extractDistributionTar(nodeBytes, selected,
        ["node-v24/bin/node", "node-v24/LICENSE"], 1);
      assert.equal(await readFile(join(selected, "bin/node"), "utf8"),
        "synthetic runtime");
      assert.equal(await readFile(join(selected, "LICENSE"), "utf8"),
        "synthetic license");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

test("Linux archives exclude their reserved partial and keep a stable root",
  { skip: process.platform !== "linux" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "package-tar-"));
    const execute = promisify(execFile);
    try {
      const output = join(root, "package");
      await mkdir(output);
      await writeFile(join(output, "keep.txt"), "synthetic package data");
      const partial = join(output, ".archive.partial.tar.gz");
      await createLinuxArchive(output, partial);
      const listing = await execute("tar", ["-tzf", partial]);
      assert.ok(listing.stdout.includes("./keep.txt"));
      assert.ok(!listing.stdout.includes(".archive.partial"));
      const extracted = await execute("tar", ["-xOzf", partial, "./keep.txt"]);
      assert.equal(extracted.stdout, "synthetic package data");
      await assert.rejects(createLinuxArchive(output, partial),
        { code: "EEXIST" });
    } finally { await rm(root, { recursive: true }); }
  });

test("package durability sync admits only matching regular files and folders",
  { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "package-durable-"));
    try {
      const file = join(root, "archive.tar.gz");
      await writeFile(file, "archive bytes");
      const directory = join(root, "staging");
      await mkdir(directory);
      await syncDistributionArchive(file);
      await syncDistributionFolder(directory);
      await assert.rejects(syncDistributionArchive(directory));
      await assert.rejects(syncDistributionFolder(file));
      const archiveLink = join(root, "archive-link");
      const directoryLink = join(root, "folder-link");
      await symlink(file, archiveLink);
      await symlink(directory, directoryLink);
      await assert.rejects(syncDistributionArchive(archiveLink));
      await assert.rejects(syncDistributionFolder(directoryLink));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test("package durability sync rejects FIFO substitutions without hanging",
  { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "package-durable-fifo-"));
    try {
      const fifo = join(root, "replacement");
      await promisify(execFile)("mkfifo", [fifo]);
      const moduleUrl = new URL(
        "../../../../src/platforms/distribution/adapter-outbound/build.ts",
        import.meta.url,
      ).href;
      for (const method of ["syncDistributionArchive",
        "syncDistributionFolder"]) {
        const script = `import { ${method} } from ` +
          `${JSON.stringify(moduleUrl)};` +
          `await ${method}(process.argv[1]).then(` +
          `() => { throw Error("accepted-FIFO"); }, () => undefined);`;
        await promisify(execFile)(process.execPath,
          ["--input-type=module", "-e", script, fifo],
          { timeout: 3_000, killSignal: "SIGKILL" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test("package output names remain repository-owned and cannot select paths",
  () => {
    assert.equal(distributionDirectory("/synthetic/repo"),
      "/synthetic/repo/.temp/distributions");
    assert.equal(distributionDirectory("/synthetic/repo", "acceptance"),
      "/synthetic/repo/.temp/distributions/acceptance");
    for (const name of ["", "../foreign", "/outside", "a/b", "A", "a\\b",
      "a\n", "a".repeat(49)])
      assert.throws(() => distributionDirectory("/synthetic/repo", name));
    assert.equal(join(distributionDirectory("/synthetic/repo", "acceptance"),
      "linux-x64.tar.gz"),
    "/synthetic/repo/.temp/distributions/acceptance/linux-x64.tar.gz");
  });

const yaml = await import(
  new URL(
    "../../../../.dependencies/pnpm/node_modules/yaml/dist/index.js",
    import.meta.url,
  ).href
);
const workflow = async (name: string) =>
  yaml.parse(
    await readFile(
      new URL(
        "../../../../.github/workflows/" + name + ".yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );

test("Mac package defines a bounded non-keepalive login agent", async () => {
  assert.equal(
    MAC_LOGIN_AGENT_LABEL,
    "com.albertovilla.blooket-api.background",
  );
  assert.equal(
    MAC_LOGIN_AGENT_PLIST,
    "com.albertovilla.blooket-api.background.plist",
  );
  assert.equal(MAC_LOGIN_AGENT_EXECUTABLE, "Blooket API Background");
  const plist = macLoginAgentPlist();
  assert.ok(plist.includes("<key>BundleProgram</key>"));
  assert.ok(plist.includes(
    "Contents/Resources/ServiceManagement/Blooket API Background",
  ));
  assert.ok(plist.includes("<key>RunAtLoad</key>"));
  assert.ok(!plist.includes("KeepAlive"));
  assert.ok(!plist.includes("ProgramArguments"));

  const helper = await readFile(
    new URL(
      "../../../../src/platforms/service-lifecycle/adapter-outbound/" +
        "login-agent.swift",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(helper.includes("Resources/runtime/node"));
  assert.ok(helper.includes("adapter-inbound/launcher.ts"));
  assert.ok(helper.includes('[launcher.path, "--no-open"]'));
  assert.ok(!helper.includes("SMAppService"));
  assert.ok(!helper.includes("http"));
  const native = await readFile(new URL(
    "../../../../src/service/desktop-launcher/adapter-inbound/" +
      "macos-launcher.swift", import.meta.url,
  ), "utf8");
  assert.ok(native.includes("SMAppService.agent("));
  assert.ok(native.includes('"--login-status"'));
  assert.ok(native.includes('"--login-enable"'));
  assert.ok(native.includes('"--login-disable"'));
  assert.ok(native.includes("try service.unregister()"));
  assert.ok(native.includes("case .requiresApproval:"));
  assert.ok(native.includes("FileHandle.nullDevice"));
  assert.ok(!native.includes("osascript"));
});

test("CI validates before ARM Safari and release only publishes", async () => {
  const ci = await workflow("ci");
  const release = await workflow("release");
  assert.deepEqual(
    (
      await readdir(new URL("../../../../.github/workflows/", import.meta.url))
    ).sort(),
    ["ci.yml", "release.yml"],
  );

  assert.deepEqual(ci.on.push.tags, ["ci-*"]);
  assert.equal(ci.on.push.branches, undefined);
  assert.equal(ci.on.pull_request, undefined);
  assert.equal(ci.on.workflow_dispatch, undefined);
  assert.equal(ci.on.workflow_call.secrets, undefined);

  assert.equal(ci.jobs.validate["runs-on"], "ubuntu-latest");
  const setupNode = ci.jobs.validate.steps.find(
    (step: { uses?: string }) => step.uses === "actions/setup-node@v7",
  );
  assert.equal(setupNode.with.cache, "pnpm");
  assert.equal(setupNode.with["cache-dependency-path"], "pnpm-lock.yaml");
  const validateCommands = ci.jobs.validate.steps.flatMap(
    (step: { run?: string }) => step.run ? [step.run] : [],
  );
  for (const command of [
    "pnpm install --frozen-lockfile",
    "npm run check",
    "npm run roadmap:check",
    "npm test",
  ])
    assert.ok(validateCommands.includes(command));
  const validateText = validateCommands.join("\n");
  assert.ok(validateText.includes("npm run package -- linux-x64"));
  assert.ok(validateText.includes("npm run package:verify -- linux-x64"));

  const mac = ci.jobs["macos-arm"];
  assert.equal(mac.needs, "validate");
  assert.equal(mac.if, "github.event_name == 'push'");
  assert.equal(mac["runs-on"], "macos-26");
  const macText = mac.steps
    .flatMap((step: { run?: string }) => step.run ? [step.run] : [])
    .join("\n");
  for (const fragment of [
    '[[ "$(uname -m)" == arm64 ]]',
    "npm run package -- darwin-arm64",
    "npm run package:verify -- darwin-arm64",
    "safari-web-extension-packager",
    "CODE_SIGNING_ALLOWED=NO",
    "Blooket API Safari.app",
    "extension-id.txt",
    "open-extension",
    "safaridriver --enable",
    "npm run macos:safari-smoke",
  ])
    assert.ok(macText.includes(fragment));

  assert.deepEqual(release.on.push.tags, ["v[0-9][0-9].[1-4].*"]);
  assert.equal(release.jobs.ci.uses, "./.github/workflows/ci.yml");
  assert.equal(release.jobs.ci.permissions.contents, "read");
  assert.equal(release.jobs.gate.needs, "ci");
  const gate = release.jobs.gate.steps.at(-1);
  assert.equal(gate.env.RELEASE_ENABLED, "$" + "{{ vars.RELEASE_ENABLED }}");
  assert.ok(gate.run.includes('[[ "$RELEASE_ENABLED" == true ]]'));
  assert.ok(gate.run.includes("release-tag.ts"));

  assert.equal(release.jobs.publish.needs, "gate");
  const download = release.jobs.publish.steps[0];
  assert.equal(download.uses,
    "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333");
  assert.equal(download.with.name, "package-linux-x64");
  assert.equal(download.with.pattern, undefined);
  assert.equal(download.with["merge-multiple"], undefined);
  const publication = release.jobs.publish.steps.at(-1).run as string;
  assert.ok(publication.includes("linux-x64.tar.gz"));
  assert.ok(!publication.includes("darwin-arm64.zip"));
  assert.ok(publication.includes('gh release create "$RELEASE_TAG"'));
  assert.ok(!publication.includes("npm "));
  assert.ok(!publication.includes("package:"));

  for (const value of [ci, release]) {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      for (const [key, child] of Object.entries(node)) {
        assert.notEqual(key, "continue-on-error");
        if (key === "uses")
          assert.ok(
            typeof child === "string" &&
              (child.startsWith("./") ||
                /@(?:v\d+|[0-9a-f]{40})$/u.test(child)),
          );
        visit(child);
      }
    };
    visit(value);
  }
});

test("Linux public release uploads verified artifact without macOS job",
  async () => {
  const ci = await workflow("ci");
  const release = await workflow("release");
  const validate = ci.jobs.validate.steps;
  const verification = validate.findIndex((step: { run?: string }) =>
    step.run?.includes("npm run package:verify -- linux-x64"));
  const releaseVerification = validate.findIndex((step: { run?: string }) =>
    step.run?.includes("npm run package:verify -- linux-x64 --release"));
  const upload = validate.findIndex((step: { uses?: string }) =>
    step.uses ===
      "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9");
  assert.ok(verification >= 0 && releaseVerification > verification &&
    upload > releaseVerification);
  assert.equal(validate[releaseVerification].if,
    "startsWith(github.ref, 'refs/tags/v')");
  assert.equal(validate[upload].with.name, "package-linux-x64");
  assert.ok(validate[upload].with.path.includes("linux-x64.tar.gz"));
  assert.equal(ci.jobs["macos-arm"].if, "github.event_name == 'push'");
  assert.equal(release.jobs.ci.secrets, undefined);
  assert.equal(ci.on.workflow_call.secrets, undefined);
  const publish = release.jobs.publish.steps.at(-1).run as string;
  assert.ok(publish.includes('test -s "$app"'));
  assert.ok(!publish.includes('"$manifest"'));
  assert.ok(publish.includes('gh release create "$RELEASE_TAG"'));
});
