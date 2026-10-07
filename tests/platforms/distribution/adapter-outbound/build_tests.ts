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

test("CI is opt-in and release consumes its verified artifacts", async () => {
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
  assert.equal(ci.on.workflow_call.inputs.release.default, false);

  assert.deepEqual(
    ci.jobs.packages.strategy.matrix.include
      .map((item: { target: string }) => item.target)
      .sort(),
    ["darwin-arm64", "darwin-x64", "linux-x64"],
  );
  assert.deepEqual(
    ci.jobs.packages.strategy.matrix.include.map(
      (item: { runner: string }) => item.runner,
    ),
    ["macos-latest", "macos-26-intel", "ubuntu-latest"],
  );

  const ciCommands = ci.jobs.packages.steps.flatMap((step: { run?: string }) =>
    step.run ? [step.run] : [],
  );
  for (const command of [
    "pnpm install --frozen-lockfile",
    "npm run check",
    "npm run roadmap:check",
    "npm test",
    'npm run package -- "$PACKAGE_TARGET"',
  ]) {
    assert.ok(ciCommands.includes(command));
  }
  const packageVerify = ciCommands.find((command: string) =>
    command.includes("npm run package:verify"),
  );
  assert.equal(
    ciCommands.filter((command: string) => command.includes("package:verify"))
      .length,
    1,
  );
  assert.ok(
    packageVerify?.includes('npm run package:verify -- "$PACKAGE_TARGET"'),
  );
  assert.ok(
    packageVerify?.includes(
      'npm run package:verify -- "$PACKAGE_TARGET" --release',
    ),
  );
  assert.ok(packageVerify?.includes('"$PACKAGE_TARGET" == darwin-*'));
  assert.ok(packageVerify?.includes('"$RELEASE_MODE" == true'));

  assert.deepEqual(release.on.push.tags, ["v[0-9][0-9].[1-4].*"]);
  assert.equal(
    release.jobs.gate.steps.at(-1).env.RELEASE_ENABLED,
    "${{ vars.RELEASE_ENABLED }}",
  );
  const gate = release.jobs.gate.steps.at(-1).run as string;
  assert.ok(gate.indexOf('[[ "$RELEASE_ENABLED" == true ]]') >= 0);
  assert.ok(gate.indexOf("release-tag.ts") > gate.indexOf("RELEASE_ENABLED"));

  assert.equal(release.jobs.ci.uses, "./.github/workflows/ci.yml");
  assert.equal(release.jobs.ci.needs, "gate");
  assert.equal(release.jobs.ci.with.release, true);
  assert.deepEqual(release.jobs.publish.needs, ["gate", "ci"]);
  assert.equal(
    release.jobs.publish.if,
    "needs.gate.result == 'success' && needs.ci.result == 'success'",
  );
  assert.equal(release.jobs.packages, undefined);

  const download = release.jobs.publish.steps[0];
  assert.equal(download.uses, "actions/download-artifact@v8");
  assert.equal(download.with.pattern, "package-*");
  const publication = release.jobs.publish.steps.at(-1).run as string;
  assert.ok(publication.includes('gh release create "$RELEASE_TAG"'));
  assert.ok(publication.includes("--verify-tag"));
  assert.ok(publication.includes('--notes ""'));
  assert.ok(!publication.includes("--generate-notes"));
  assert.ok(!publication.includes("--notes-file"));
  assert.ok(!publication.includes("SHA256SUMS"));
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
