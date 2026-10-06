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
//   - Behavioral tests for local write-attempt recovery decisions.
// - Must-Not:
//   - Execute remote writes or infer ambiguous remote outcomes.
// - Allows:
//   - Inputs: Temporary checkpoint/journal files and deterministic plans.
//   - Outputs: Ready, recovered, reconciliation, and cleanup verdicts.
//   - Side effects: Temporary durable files removed after each test.
// - Split-When:
//   - Provider-specific reconciliation gains separate test fixtures.
// - Merge-When:
//   - Local attempt recovery is removed.
// - Summary:
//   - Proves only durably confirmed attempts auto-advance progress.
// - Description:
//   - Attempting journals always remain explicit reconciliation states.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Missing journal files leave loaded checkpoint progress ready.
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

import { recoverPersistedBlooketWrite } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/recover-persisted.ts";
import {
  beginWriteAttempt,
  confirmWriteAttempt,
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
  planId: "plan:recovery-test",
  desiredStateSha256: "fixture",
  operations: [{
    operationId: "plan:recovery-test:set",
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
  const directory = await mkdtemp(join(tmpdir(), "blooket-recovery-"));
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

test("missing attempt journals leave initial progress ready", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    const result = await recoverPersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
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
  });
});

test(
  "attempting journals require reconciliation without mutation",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);

    const result = await recoverPersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "reconciliation-required");
      if (result.kind === "reconciliation-required") {
        assert.equal(result.reason, "ambiguous-attempt");
      }
    }
    assert.equal(
      (await loadWriteAttemptFile(value.attempt, plan)).ok,
      true,
    );
    await assert.rejects(readFile(value.checkpoint, "utf8"));
  });
  },
);

test(
  "confirmed journals recover a missing checkpoint advancement",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);
    await confirmWriteAttempt(
      value.attempt,
      plan,
      "plan:recovery-test:set",
      SET_RECEIPT,
    );

    const result = await recoverPersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
    );

    assert.deepEqual(result, {
      ok: true,
      kind: "recovered",
      operationId: "plan:recovery-test:set",
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
  "confirmed journals clean up when checkpoint already advanced",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await writeFile(value.checkpoint, JSON.stringify({
      schemaVersion: 2,
      planId: plan.planId,
      nextOperationIndex: 1,
      remoteSetId: "remote-set-1",
    }));
    await beginWriteAttempt(value.attempt, plan, 0);
    await confirmWriteAttempt(
      value.attempt,
      plan,
      "plan:recovery-test:set",
      SET_RECEIPT,
    );

    const result = await recoverPersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "ready");
    }
    assert.deepEqual(
      await loadWriteAttemptFile(value.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test("confirmed receipt mismatch preserves recovery evidence", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await writeFile(value.checkpoint, JSON.stringify({
      schemaVersion: 2,
      planId: plan.planId,
      nextOperationIndex: 1,
      remoteSetId: "different-remote-set",
    }));
    await beginWriteAttempt(value.attempt, plan, 0);
    await confirmWriteAttempt(
      value.attempt,
      plan,
      "plan:recovery-test:set",
      SET_RECEIPT,
    );

    const result = await recoverPersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "reconciliation-required");
      if (result.kind === "reconciliation-required") {
        assert.equal(result.reason, "inconsistent-attempt-state");
        assert.equal(result.checkpoint.remoteSetId, "different-remote-set");
        assert.deepEqual(result.attempt.receipt, SET_RECEIPT);
      }
    }
    const loaded = await loadWriteAttemptFile(value.attempt, plan);
    assert.equal(loaded.ok, true);
    if (loaded.ok && loaded.kind === "record") {
      assert.equal(loaded.record.phase, "confirmed");
    }
  });
});

test("inconsistent attempt progress requires reconciliation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await writeFile(value.checkpoint, JSON.stringify({
      schemaVersion: 2,
      planId: plan.planId,
      nextOperationIndex: 1,
      remoteSetId: "remote-set-1",
    }));
    await beginWriteAttempt(value.attempt, plan, 0);

    const result = await recoverPersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "reconciliation-required");
      if (result.kind === "reconciliation-required") {
        assert.equal(
          result.reason,
          "inconsistent-attempt-state",
        );
      }
    }
    const loaded = await loadWriteAttemptFile(value.attempt, plan);
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.kind, "record");
    }
  });
});

test("standalone recovery uses the shared execution lock", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    const acquired = await tryAcquireFileLock(
      writeAttemptExecutionLockPath(value.attempt),
    );
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }

    const result = await recoverPersistedBlooketWrite(
      value.checkpoint,
      value.attempt,
      plan,
    );
    assert.deepEqual(result, {
      ok: false,
      stage: "execution-lock",
      code: "write-execution-locked",
    });

    await acquired.lock.release();
    assert.deepEqual(
      await recoverPersistedBlooketWrite(
        value.checkpoint,
        value.attempt,
        plan,
      ),
      {
        ok: true,
        kind: "ready",
        checkpoint: {
          schemaVersion: 2,
          planId: plan.planId,
          nextOperationIndex: 0,
          remoteSetId: null,
        },
      },
    );
  });
});
