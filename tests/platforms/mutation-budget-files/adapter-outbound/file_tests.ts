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
//   - Durable mutation-budget reservation and safety regressions.
// - Must-Not:
//   - Execute provider writes or use product-owned persistence paths.
// - Allows:
//   - Inputs: Temporary files, synthetic plan IDs, policies, and timestamps.
//   - Outputs: Exact persisted states and stable refusal assertions.
//   - Side effects: Temporary directories removed after each test.
// - Split-When:
//   - Multi-account durable budget storage needs separate fixtures.
// - Merge-When:
//   - Mutation-budget file persistence is removed.
// - Summary:
//   - Proves restart counts, exhaustion, plan binding, and unsafe-file refusal.
// - Description:
//   - Reservations persist before success returns and never reset on restart.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Symlink, malformed, oversized, and conflicting files fail closed.
//
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadMutationBudgetFile,
  reserveMutationBudgetStart,
} from
  "../../../../src/platforms/mutation-budget-files/adapter-outbound/file.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";

const POLICY = {
  maximumStarts: 2,
  maximumDurationMs: 60_000,
};

async function temporary(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "mutation-budget-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test(
  "reservations survive restart and exhaust without rewriting state",
  async () => {
  await temporary(async (directory) => {
    const path = join(directory, "budget.json");
    assert.deepEqual(await reserveMutationBudgetStart(
      path,
      "plan:synthetic",
      POLICY,
      10_000,
    ), {
      ok: true,
      state: { version: 1, startedAtMs: 10_000, starts: 1 },
    });

    assert.deepEqual(await loadMutationBudgetFile(path, "plan:synthetic"), {
      ok: true,
      state: { version: 1, startedAtMs: 10_000, starts: 1 },
    });

    assert.deepEqual(await reserveMutationBudgetStart(
      path,
      "plan:synthetic",
      POLICY,
      12_000,
    ), {
      ok: true,
      state: { version: 1, startedAtMs: 10_000, starts: 2 },
    });
    const before = await readFile(path, "utf8");

    assert.deepEqual(await reserveMutationBudgetStart(
      path,
      "plan:synthetic",
      POLICY,
      14_000,
    ), {
      ok: false,
      kind: "budget",
      code: "mutation-task-start-budget-exhausted",
    });
    assert.equal(await readFile(path, "utf8"), before);
  });
  },
);

test(
  "plan mismatch and clock rollback preserve the durable budget",
  async () => {
  await temporary(async (directory) => {
    const path = join(directory, "budget.json");
    await reserveMutationBudgetStart(
      path,
      "plan:one",
      POLICY,
      20_000,
    );
    const before = await readFile(path, "utf8");

    assert.deepEqual(await loadMutationBudgetFile(path, "plan:two"), {
      ok: false,
      kind: "invalid",
      code: "mutation-budget-plan-mismatch",
    });
    assert.deepEqual(await reserveMutationBudgetStart(
      path,
      "plan:one",
      POLICY,
      19_999,
    ), {
      ok: false,
      kind: "budget",
      code: "mutation-task-budget-invalid",
    });
    assert.equal(await readFile(path, "utf8"), before);
  });
  },
);

test("busy budget locks fail before state publication", async () => {
  await temporary(async (directory) => {
    const path = join(directory, "budget.json");
    const acquired = await tryAcquireFileLock(path + ".lock");
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    try {
      assert.deepEqual(
        await reserveMutationBudgetStart(
          path,
          "plan:synthetic",
          POLICY,
          10_000,
        ),
        {
          ok: false,
          kind: "io",
          code: "mutation-budget-file-locked",
        },
      );
      await assert.rejects(readFile(path, "utf8"));
    } finally {
      await acquired.lock.release();
    }
  });
});

test("unsafe malformed and oversized budget files fail closed", async () => {
  await temporary(async (directory) => {
    const path = join(directory, "budget.json");
    const outside = join(directory, "outside.json");
    await writeFile(outside, "{}");
    await symlink(outside, path);
    assert.deepEqual(await loadMutationBudgetFile(path, "plan:test"), {
      ok: false,
      kind: "io",
      code: "mutation-budget-file-unsafe",
    });

    await rm(path);
    await writeFile(path, "{bad");
    assert.deepEqual(await loadMutationBudgetFile(path, "plan:test"), {
      ok: false,
      kind: "invalid",
      code: "mutation-budget-file-invalid",
    });

    await writeFile(path, "x".repeat(4_097));
    assert.deepEqual(await loadMutationBudgetFile(path, "plan:test"), {
      ok: false,
      kind: "io",
      code: "mutation-budget-file-unsafe",
    });
  });
});
