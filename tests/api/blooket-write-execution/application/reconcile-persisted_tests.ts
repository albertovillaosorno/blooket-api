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
//   - Filesystem tests for explicit ambiguous-attempt reconciliation.
// - Must-Not:
//   - Contact Blooket, infer outcomes, or use production persistence paths.
// - Allows:
//   - Inputs: Temporary journals, checkpoints, plans, and fixed resolutions.
//   - Outputs: Deterministic resolution and evidence-preservation verdicts.
//   - Side effects: Temporary durable files removed after each test.
// - Split-When:
//   - Provider-specific reconciliation adds independent evidence fixtures.
// - Merge-When:
//   - Explicit persisted reconciliation is removed.
// - Summary:
//   - Proves ambiguous attempts change only from explicit verified outcomes.
// - Description:
//   - Confirmed receipts recover progress; non-confirmation permits safe retry.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Mismatched evidence leaves the journal untouched.
//
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reconcilePersistedBlooketWrite } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/reconcile-persisted.ts";
import {
  beginWriteAttempt,
  loadWriteAttemptFile,
  writeAttemptExecutionLockPath,
} from
  "../../../../src/platforms/write-attempt-files/adapter-outbound/file.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import type { BlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const plan: BlooketWritePlan = {
  schemaVersion: 1,
  planId: "plan:reconcile-test",
  desiredStateSha256: "fixture",
  operations: [{
    operationId: "plan:reconcile-test:set",
    kind: "set",
    title: "Fractions",
    description: "Review.",
    visibility: "private",
    coverMediaId: null,
  }],
};

const SET_RECEIPT = {
  kind: "set-created" as const,
  remoteSetId: "remote-set-1",
};

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-reconcile-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function paths(directory: string) {
  return {
    checkpoint: join(directory, "checkpoint.json"),
    attempt: join(directory, "attempt.json"),
  };
}

test(
  "confirmed reconciliation persists the exact remote set receipt",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);

    const result = await reconcilePersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
      {
        operationId: "plan:reconcile-test:set",
        outcome: "confirmed",
        receipt: SET_RECEIPT,
      },
    );

    assert.deepEqual(result, {
      ok: true,
      kind: "recovered",
      operationId: "plan:reconcile-test:set",
      checkpoint: {
        schemaVersion: 2,
        planId: plan.planId,
        nextOperationIndex: 1,
        remoteSetId: "remote-set-1",
      },
    });
    assert.deepEqual(
      JSON.parse(await readFile(value.checkpoint, "utf8")),
      result.ok && result.kind === "recovered"
        ? result.checkpoint
        : null,
    );
    assert.deepEqual(
      await loadWriteAttemptFile(value.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test(
  "not-confirmed reconciliation clears only the ambiguous attempt",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);

    const result = await reconcilePersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
      {
        operationId: "plan:reconcile-test:set",
        outcome: "not-confirmed",
      },
    );

    assert.deepEqual(result, {
      ok: true,
      kind: "ready",
      checkpoint: {
        schemaVersion: 2,
        planId: plan.planId,
        nextOperationIndex: 0,
        remoteSetId: null,
      },
    });
    await assert.rejects(readFile(value.checkpoint, "utf8"));
    assert.deepEqual(
      await loadWriteAttemptFile(value.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test("operation mismatches preserve the ambiguous attempt", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);

    assert.deepEqual(
      await reconcilePersistedBlooketWrite(
        value.checkpoint,
        value.attempt,
        plan,
        {
          operationId: "plan:reconcile-test:other",
          outcome: "not-confirmed",
        },
      ),
      {
        ok: false,
        stage: "reconciliation",
        code: "reconciliation-operation-mismatch",
      },
    );
    const loaded = await loadWriteAttemptFile(value.attempt, plan);
    assert.equal(loaded.ok, true);
    if (loaded.ok && loaded.kind === "record") {
      assert.equal(loaded.record.phase, "attempting");
    }
  });
});

test("invalid confirmed receipts preserve the ambiguous attempt", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);

    const result = await reconcilePersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
      {
        operationId: "plan:reconcile-test:set",
        outcome: "confirmed",
        receipt: null,
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "reconciliation-confirm");
    }
    const loaded = await loadWriteAttemptFile(value.attempt, plan);
    assert.equal(loaded.ok, true);
    if (loaded.ok && loaded.kind === "record") {
      assert.equal(loaded.record.phase, "attempting");
    }
  });
});

test("inconsistent progress cannot be externally resolved", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await writeFile(value.checkpoint, JSON.stringify({
      schemaVersion: 2,
      planId: plan.planId,
      nextOperationIndex: 1,
      remoteSetId: "remote-set-1",
    }));
    await beginWriteAttempt(value.attempt, plan, 0);

    assert.deepEqual(
      await reconcilePersistedBlooketWrite(
        value.checkpoint,
        value.attempt,
        plan,
        {
          operationId: "plan:reconcile-test:set",
          outcome: "not-confirmed",
        },
      ),
      {
        ok: false,
        stage: "reconciliation",
        code: "reconciliation-state-inconsistent",
      },
    );
    const loaded = await loadWriteAttemptFile(value.attempt, plan);
    assert.equal(loaded.ok, true);
    if (loaded.ok && loaded.kind === "record") {
      assert.equal(loaded.record.phase, "attempting");
    }
  });
});

test("reconciliation uses the shared execution lock", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);
    const acquired = await tryAcquireFileLock(
      writeAttemptExecutionLockPath(value.attempt),
    );
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }

    assert.deepEqual(
      await reconcilePersistedBlooketWrite(
        value.checkpoint,
        value.attempt,
        plan,
        {
          operationId: "plan:reconcile-test:set",
          outcome: "not-confirmed",
        },
      ),
      {
        ok: false,
        stage: "execution-lock",
        code: "write-execution-locked",
      },
    );
    await acquired.lock.release();
  });
});

test("malformed negative reconciliation never clears the journal", async () => {
  const cases: unknown[] = [
    { operationId: "plan:reconcile-test:set", outcome: "not-confirmed",
      receipt: null },
    { operationId: "plan:reconcile-test:set", outcome: "not-confirmed",
      extra: true },
    { operationId: "plan:reconcile-test:set", outcome: "unknown" },
    { operationId: 42, outcome: "not-confirmed" },
    null,
  ];
  for (const candidate of cases) await withTemporaryDirectory(
    async directory => {
      const value = paths(directory);
      await beginWriteAttempt(value.attempt, plan, 0);
      const result = await reconcilePersistedBlooketWrite(
        value.checkpoint, value.attempt, plan,
        candidate as Parameters<typeof reconcilePersistedBlooketWrite>[3],
      );
      assert.deepEqual(result, { ok: false, stage: "reconciliation",
        code: "reconciliation-state-inconsistent" });
      const loaded = await loadWriteAttemptFile(value.attempt, plan);
      assert.equal(loaded.ok && loaded.kind === "record" &&
        loaded.record.phase, "attempting");
    },
  );
});
