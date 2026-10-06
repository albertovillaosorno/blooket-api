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

test("release invokes the single CI workflow and publishes only last",
  async () => {
  const ci = await workflow("ci");
  const release = await workflow("release");
  assert.deepEqual(
    (await readdir(new URL("../../../../.github/workflows/", import.meta.url)))
      .sort(),
    ["ci.yml", "release.yml"],
  );
  const ciCommands = ci.jobs.repository.steps.flatMap(
    (step: { run?: string }) => (step.run ? [step.run] : []),
  );
  assert.deepEqual(ciCommands, [
    "pnpm install --frozen-lockfile",
    "npm run check",
    "npm test",
  ]);
  assert.equal(release.jobs.ci.uses, "./.github/workflows/ci.yml");
  assert.equal(release.jobs.ci.needs, "tag");
  assert.deepEqual(release.jobs.publish.needs, ["tag", "ci", "packages"]);
  assert.equal(
    release.jobs.publish.if,
    "needs.tag.result == 'success' && needs.ci.result == 'success' && " +
      "needs.packages.result == 'success'",
  );
  assert.equal(release.permissions.contents, "read");
  assert.equal(release.jobs.publish.permissions.contents, "write");
  assert.deepEqual(
    release.jobs.packages.strategy.matrix.include
      .map((item: { target: string }) => item.target)
      .sort(),
    ["darwin-arm64", "darwin-x64", "linux-x64"],
  );
  assert.deepEqual(
    release.jobs.packages.strategy.matrix.include.map(
      (item: { runner: string }) => item.runner,
    ),
    ["macos-latest", "macos-26-intel", "ubuntu-latest"],
  );
  const commands = release.jobs.packages.steps.flatMap(
    (step: { run?: string }) => (step.run ? [step.run] : []),
  );
  assert.ok(commands.includes('npm run package:verify -- "$PACKAGE_TARGET"'));
  assert.ok(
    commands.includes('npm run package:verify -- "$PACKAGE_TARGET" --release'),
  );
  for (const value of [ci, release]) {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      for (const [key, child] of Object.entries(node)) {
        assert.notEqual(key, "continue-on-error");
        if (key === "uses")
          assert.ok(
            typeof child === "string" &&
              (child.startsWith("./") || /@(?:v\d+|main)$/u.test(child)),
          );
        visit(child);
      }
    };
    visit(value);
  }
  const publication = release.jobs.publish.steps.at(-1).run as string;
  assert.ok(!publication.includes("--generate-notes"));
  assert.ok(
    publication.includes('--notes-file "docs/releases/$RELEASE_TAG.md"'),
  );
  assert.ok(
    publication.indexOf("gh release upload") > publication.indexOf("--draft"),
  );
  assert.ok(
    publication.indexOf("--draft=false") >
      publication.indexOf("gh release upload"),
  );
  assert.ok(publication.includes('gh release view "$RELEASE_TAG"'));
  assert.ok(publication.includes("--json isDraft --jq .isDraft"));
  assert.ok(publication.includes('[[ "$draft" == true ]]'));
  assert.ok(publication.includes("SHA256SUMS --clobber"));
  assert.ok(publication.includes("set -euo pipefail"));
});
