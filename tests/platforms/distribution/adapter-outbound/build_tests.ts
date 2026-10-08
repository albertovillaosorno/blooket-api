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
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  MAC_LOGIN_AGENT_EXECUTABLE,
  MAC_LOGIN_AGENT_LABEL,
  MAC_LOGIN_AGENT_PLIST,
  macLoginAgentPlist,
  distributionDirectory,
} from "../../../../src/platforms/distribution/adapter-outbound/build.ts";
import { join } from "node:path";

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
  assert.equal(ci.on.workflow_call, null);

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
  assert.equal(download.uses, "actions/download-artifact@v8");
  assert.equal(download.with.name, "package-darwin-arm64");
  assert.equal(download.with.pattern, undefined);
  assert.equal(download.with["merge-multiple"], undefined);
  const publication = release.jobs.publish.steps.at(-1).run as string;
  assert.ok(publication.includes("darwin-arm64.zip"));
  assert.equal((publication.match(/\.zip/gu) ?? []).length, 1);
  assert.ok(publication.includes('gh release create "$RELEASE_TAG"'));
  assert.ok(!publication.includes("linux-x64.tar.gz"));
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
              (child.startsWith("./") || /@v\d+$/u.test(child)),
          );
        visit(child);
      }
    };
    visit(value);
  }
});
