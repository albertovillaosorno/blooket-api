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
//   - Filesystem tests for durable Blooket write-attempt journals.
// - Must-Not:
//   - Execute remote writes or delete malformed recovery evidence.
// - Allows:
//   - Inputs: Temporary journal files and deterministic write plans.
//   - Outputs: Begin/confirm/load/clear and refusal verdicts.
//   - Side effects: Temporary filesystem state removed after each test.
// - Split-When:
//   - Parallel attempt journals require independent fixture suites.
// - Merge-When:
//   - Write-ahead journals are removed.
// - Summary:
//   - Proves journals are create-once, plan-bound, and atomically confirmed.
// - Description:
//   - Mirrors the write-attempt-files adapter.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Existing journals block a new attempt.
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
  beginWriteAttempt,
  clearWriteAttempt,
  confirmWriteAttempt,
  loadWriteAttemptFile,
} from
  "../../../../src/platforms/write-attempt-files/adapter-outbound/file.ts";
import type { BlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const plan: BlooketWritePlan = {
  schemaVersion: 1,
  planId: "plan:attempt-test",
  desiredStateSha256: "fixture",
  operations: [{
    operationId: "plan:attempt-test:set",
    kind: "set",
    title: "Fractions",
    description: "Review.",
    visibility: "private",
    coverMediaId: null,
  }],
};

const questionPlan: BlooketWritePlan = {
  ...plan,
  operations: [
    ...plan.operations,
    {
      operationId: "plan:attempt-test:q:0",
      kind: "question",
      localQuestionId: "q1",
      question: {
        type: "typing-answer",
        prompt: "2 + 2",
        timeLimitSeconds: 10,
        imageMediaId: null,
        matchMode: "exact",
        answer: "4",
      },
    },
  ],
};

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-attempt-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("begin creates an attempting journal without overwriting it", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "attempt.json");
    const begun = await beginWriteAttempt(path, plan, 0);

    assert.deepEqual(begun, {
      ok: true,
      record: {
        schemaVersion: 2,
        planId: plan.planId,
        operationId: "plan:attempt-test:set",
        operationIndex: 0,
        phase: "attempting",
        receipt: null,
      },
    });
    assert.deepEqual(await beginWriteAttempt(path, plan, 0), {
      ok: false,
      kind: "conflict",
      code: "write-attempt-exists",
    });
  });
});

test(
  "confirm atomically preserves identity and changes only phase",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "attempt.json");
    await beginWriteAttempt(path, plan, 0);

    const confirmed = await confirmWriteAttempt(
      path,
      plan,
      "plan:attempt-test:set",
      { kind: "set-created", remoteSetId: "remote-set-1" },
    );
    assert.equal(confirmed.ok, true);
    if (confirmed.ok) {
      assert.equal(confirmed.record?.phase, "confirmed");
      assert.deepEqual(confirmed.record?.receipt, {
        kind: "set-created",
        remoteSetId: "remote-set-1",
      });
    }

    const loaded = await loadWriteAttemptFile(path, plan);
    assert.equal(loaded.ok, true);
    if (loaded.ok && loaded.kind === "record") {
      assert.deepEqual(loaded.record, confirmed.record);
    }
  });
  },
);

test("confirmation is idempotent for the same operation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "attempt.json");
    await beginWriteAttempt(path, plan, 0);
    await confirmWriteAttempt(
      path,
      plan,
      "plan:attempt-test:set",
      { kind: "set-created", remoteSetId: "remote-set-1" },
    );

    const repeated = await confirmWriteAttempt(
      path,
      plan,
      "plan:attempt-test:set",
      { kind: "set-created", remoteSetId: "remote-set-1" },
    );
    assert.equal(repeated.ok, true);
    if (repeated.ok) {
      assert.equal(repeated.record?.phase, "confirmed");
    }
  });
});

test("mismatched operations and plan indexes fail closed", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "attempt.json");

    const invalidIndex = await beginWriteAttempt(path, plan, 1);
    assert.equal(invalidIndex.ok, false);
    if (!invalidIndex.ok && invalidIndex.kind === "invalid") {
      assert.equal(
        invalidIndex.issues[0]?.code,
        "invalid-write-attempt-index",
      );
    }

    await beginWriteAttempt(path, plan, 0);
    const mismatch = await confirmWriteAttempt(
      path,
      plan,
      "plan:attempt-test:other",
    );
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok && mismatch.kind === "invalid") {
      assert.equal(
        mismatch.issues[0]?.code,
        "write-attempt-operation-mismatch",
      );
    }
  });
});

test("legacy confirmed set journals fail without a receipt", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "attempt.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      planId: plan.planId,
      operationId: "plan:attempt-test:set",
      operationIndex: 0,
      phase: "confirmed",
    }));

    const loaded = await loadWriteAttemptFile(path, plan);
    assert.equal(loaded.ok, false);
    if (!loaded.ok && loaded.kind === "invalid") {
      assert.equal(
        loaded.issues.some((issue) => issue.code === "missing-set-receipt"),
        true,
      );
    }
  });
});

test("confirmed receipts are idempotent but cannot change", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "attempt.json");
    await beginWriteAttempt(path, plan, 0);
    const receipt = {
      kind: "set-created" as const,
      remoteSetId: "remote-set-1",
    };
    assert.equal(
      (await confirmWriteAttempt(
        path,
        plan,
        "plan:attempt-test:set",
        receipt,
      )).ok,
      true,
    );
    assert.equal(
      (await confirmWriteAttempt(
        path,
        plan,
        "plan:attempt-test:set",
        receipt,
      )).ok,
      true,
    );
    const mismatch = await confirmWriteAttempt(
      path,
      plan,
      "plan:attempt-test:set",
      { kind: "set-created", remoteSetId: "remote-set-2" },
    );
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok && mismatch.kind === "invalid") {
      assert.equal(
        mismatch.issues[0]?.code,
        "write-attempt-receipt-mismatch",
      );
    }
  });
});

test("question confirmation requires a null receipt", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "attempt.json");
    await beginWriteAttempt(path, questionPlan, 1);
    const unexpected = await confirmWriteAttempt(
      path,
      questionPlan,
      "plan:attempt-test:q:0",
      { kind: "set-created", remoteSetId: "remote-set-1" },
    );
    assert.equal(unexpected.ok, false);
    if (!unexpected.ok && unexpected.kind === "invalid") {
      assert.equal(
        unexpected.issues[0]?.code,
        "unexpected-write-receipt",
      );
    }

    const confirmed = await confirmWriteAttempt(
      path,
      questionPlan,
      "plan:attempt-test:q:0",
      null,
    );
    assert.equal(confirmed.ok, true);
    if (confirmed.ok) {
      assert.equal(confirmed.record?.phase, "confirmed");
      assert.equal(confirmed.record?.receipt, null);
    }
  });
});

test("clear deletes only a valid journal", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "attempt.json");
    await beginWriteAttempt(path, plan, 0);
    assert.deepEqual(await clearWriteAttempt(path, plan), {
      ok: true,
    });
    assert.deepEqual(await loadWriteAttemptFile(path, plan), {
      ok: true,
      kind: "missing",
    });

    await writeFile(path, "{");
    const cleared = await clearWriteAttempt(path, plan);
    assert.equal(cleared.ok, false);
    assert.equal(await readFile(path, "utf8"), "{");
  });
});

test("cross-plan and symbolic journals remain recovery evidence", async () => {
  await withTemporaryDirectory(async (directory) => {
    const crossPlan = join(directory, "cross.json");
    await writeFile(crossPlan, JSON.stringify({
      schemaVersion: 1,
      planId: "plan:other",
      operationId: "plan:attempt-test:set",
      operationIndex: 0,
      phase: "attempting",
    }));
    const loaded = await loadWriteAttemptFile(crossPlan, plan);
    assert.equal(loaded.ok, false);
    if (!loaded.ok && loaded.kind === "invalid") {
      assert.equal(
        loaded.issues.some(
          (issue) => issue.code === "write-plan-mismatch",
        ),
        true,
      );
    }

    const outside = join(directory, "outside.json");
    const symbolic = join(directory, "symbolic.json");
    await writeFile(outside, "{}");
    await symlink(outside, symbolic);
    assert.deepEqual(await loadWriteAttemptFile(symbolic, plan), {
      ok: false,
      kind: "io",
      code: "write-attempt-file-unsafe",
    });
  });
});
