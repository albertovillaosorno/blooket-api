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
//   - Quarterly CalVer admission for explicit release tags.
// - Must-Not:
//   - Use production data, credentials, or a live Blooket account.
// - Allows:
//   - Inputs: One admitted native target and explicit release verification.
//   - Outputs: A passing smoke result or a failing process exit.
//   - Side effects: None.
// - Split-When:
//   - Another distribution format needs independent acceptance.
// - Merge-When:
//   - Package verification no longer requires native execution.
// - Summary:
//   - Rejects malformed calendar versions before release execution.
// - Description:
//   - Defines three-month UTC quarters and monotonic release revisions.
// - Usage:
//   - Validate the operator-selected tag before release execution.
// - Defaults:
//   - Failed checks block release and cleanup only the owned fixture.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRoadmap } from
  "../../../../src/platforms/roadmap-files/adapter-outbound/check.ts";

const record = (id = "blooket-01", status = "active", deps: string[] = []) =>
  `---
schema_version: 1
id: ${id}
status: ${status}
priority: p0
horizon: foundations
order: 10
area: settings
task: TODO - A task
legacy_task: TODO 01
depends_on: ${JSON.stringify(deps)}
contracts: []
scope: [docs/]
validation: [npm test]
---
# TODO - A task

## Objective

An objective.

## Acceptance

A real acceptance boundary.

## Evidence

Checks actually performed.
`;
const index = `# TODO

### TODO - A task

Finish the task.

[Record](docs/todo/open/settings/task.mdc)
`;
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blooket-roadmap-"));
  try {
    await mkdir(join(root, "docs/todo/open/settings"), { recursive: true });
    await mkdir(join(root, "docs/todo/completed/settings"), {
      recursive: true,
    });
    await writeFile(join(root, "docs/todo/open/settings/task.mdc"), record());
    await writeFile(join(root, "TODO.md"), index);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("real roadmap has one index entry per unfinished typed record",
async () => {
  assert.ok(
    (await checkRoadmap(new URL("../../../../", import.meta.url).pathname)) > 0,
  );
});
test("completion moves retain evidence and permit an empty index", async () => {
  await fixture(async (root) => {
    assert.equal(await checkRoadmap(root), 1);
    const open = join(root, "docs/todo/open/settings/task.mdc");
    await writeFile(open, record("blooket-01", "completed"));
    await rename(open, join(root, "docs/todo/completed/settings/task.mdc"));
    await assert.rejects(checkRoadmap(root), /index-not-open/u);
    await writeFile(
      join(root, "TODO.md"),
      "# TODO\n\nNo unfinished product work.\n",
    );
    assert.equal(await checkRoadmap(root), 0);
  });
});
test("invalid indexed records fail",
async () => {
  await fixture(async (root) => {
    const file = join(root, "docs/todo/open/settings/task.mdc");
    await writeFile(
      join(root, "TODO.md"),
      index.replace("task.mdc", "missing.mdc"),
    );
    await assert.rejects(checkRoadmap(root), /index-not-open/u);
    await writeFile(
      join(root, "TODO.md"),
      index + index.slice(index.indexOf("###")),
    );
    await assert.rejects(checkRoadmap(root), /index-duplicate/u);
    await writeFile(join(root, "TODO.md"), "# TODO\n");
    await assert.rejects(checkRoadmap(root), /unindexed-open/u);
    await writeFile(join(root, "TODO.md"), index);
    await writeFile(file, record("blooket-01", "completed"));
    await assert.rejects(checkRoadmap(root), /status-path/u);
    await writeFile(
      file,
      record().replace("status: active", "status: active\nstatus: active"),
    );
    await assert.rejects(checkRoadmap(root), /roadmap-yaml/u);
    await writeFile(file, record());
    await writeFile(
      join(root, "docs/todo/completed/settings/duplicate.mdc"),
      record("blooket-01", "completed"),
    );
    await assert.rejects(checkRoadmap(root), /duplicate-id/u);
  });
});
test("dependency cycles and unresolved identities are rejected", async () => {
  await fixture(async (root) => {
    const file = join(root, "docs/todo/open/settings/task.mdc");
    await writeFile(file, record("blooket-01", "active", ["blooket-02"]));
    await assert.rejects(checkRoadmap(root), /missing-dependency/u);
    await writeFile(file, record("blooket-01", "active", ["blooket-01"]));
    await assert.rejects(checkRoadmap(root), /dependency-cycle/u);
  });
});

test("index shape and unresolved owned paths fail closed", async () => {
  await fixture(async root => {
    const file = join(root, "docs/todo/open/settings/task.mdc");
    await writeFile(join(root, "TODO.md"), index.replace(
      "Finish the task.", "Finish the task.\n\nAn implementation diary.",
    ));
    await assert.rejects(checkRoadmap(root), /index-shape/u);
    await writeFile(join(root, "TODO.md"), index);
    await writeFile(file, record().replace("contracts: []",
      "contracts: [docs/missing-contract.md]"));
    await assert.rejects(checkRoadmap(root), /ENOENT/u);
    await writeFile(file, record().replace("scope: [docs/]",
      "scope: [../outside/]"));
    await assert.rejects(checkRoadmap(root), /unsafe-path/u);
  });
});
