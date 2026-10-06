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
import { readFile } from "node:fs/promises";
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

test("release requires the same full verifier and publishes only last",
  async () => {
  const ci = await workflow("ci");
  const release = await workflow("release");
  const verification = await workflow("verify");
  assert.equal(ci.jobs.verify.uses, release.jobs.verify.uses);
  assert.equal(release.jobs.verify.with.release, true);
  assert.equal(release.jobs.verify.needs, "tag");
  assert.deepEqual(release.jobs.publish.needs, ["tag", "verify"]);
  assert.equal(
    release.jobs.publish.if,
    "needs.tag.result == 'success' && needs.verify.result == 'success'",
  );
  assert.equal(release.permissions.contents, "read");
  assert.equal(release.jobs.publish.permissions.contents, "write");
  assert.deepEqual(
    verification.jobs.packages.strategy.matrix.include
      .map((item: { target: string }) => item.target)
      .sort(),
    ["darwin-arm64", "darwin-x64", "linux-x64"],
  );
  const commands = verification.jobs.packages.steps.flatMap(
    (step: { run?: string }) => (step.run ? [step.run] : []),
  );
  assert.ok(commands.includes('npm run package:verify -- "$PACKAGE_TARGET"'));
  assert.ok(
    commands.includes('npm run package:verify -- "$PACKAGE_TARGET" --release'),
  );
  assert.ok(
    verification.jobs.repository.steps.some(
      (step: { run?: string }) =>
        step.run === ".temp/ci-tools/jig validate --root .",
    ),
  );
  for (const value of [ci, release, verification]) {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      for (const [key, child] of Object.entries(node)) {
        assert.notEqual(key, "continue-on-error");
        if (key === "uses")
          assert.ok(
            typeof child === "string" &&
              (child.startsWith("./") || /@[a-f0-9]{40}$/u.test(child)),
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
